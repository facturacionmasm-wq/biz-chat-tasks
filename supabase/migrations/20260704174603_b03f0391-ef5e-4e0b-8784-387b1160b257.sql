
-- 1. Extend tenant_phone_numbers with billing columns
ALTER TABLE public.tenant_phone_numbers
  ADD COLUMN IF NOT EXISTS monthly_fee numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS stripe_subscription_item_id text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'twilio_purchase',
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_billing_at timestamptz;

-- 2. phone_number_pricing catalog (super_admin managed)
CREATE TABLE IF NOT EXISTS public.phone_number_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL,
  number_type text NOT NULL DEFAULT 'local',
  source text NOT NULL DEFAULT 'twilio_purchase',
  monthly_fee numeric(10,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_code, number_type, source)
);

GRANT SELECT ON public.phone_number_pricing TO authenticated;
GRANT ALL ON public.phone_number_pricing TO service_role;

ALTER TABLE public.phone_number_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Any authenticated can read pricing"
  ON public.phone_number_pricing FOR SELECT
  TO authenticated
  USING (active = true OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Only super_admin can write pricing"
  ON public.phone_number_pricing FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_pricing_updated_at
  BEFORE UPDATE ON public.phone_number_pricing
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. phone_number_invoices history
CREATE TABLE IF NOT EXISTS public.phone_number_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  phone_number_id uuid REFERENCES public.tenant_phone_numbers(id) ON DELETE SET NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  stripe_invoice_id text,
  invoice_url text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.phone_number_invoices TO authenticated;
GRANT ALL ON public.phone_number_invoices TO service_role;

ALTER TABLE public.phone_number_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read their invoices"
  ON public.phone_number_invoices FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE INDEX IF NOT EXISTS idx_phone_invoices_tenant ON public.phone_number_invoices(tenant_id, period_start DESC);

-- 4. Seed default pricing (MX, US, CA)
INSERT INTO public.phone_number_pricing (country_code, number_type, source, monthly_fee, currency)
VALUES
  ('US', 'local',    'twilio_purchase', 1.15,  'USD'),
  ('US', 'tollfree', 'twilio_purchase', 2.00,  'USD'),
  ('US', 'mobile',   'twilio_purchase', 1.15,  'USD'),
  ('CA', 'local',    'twilio_purchase', 1.00,  'USD'),
  ('CA', 'tollfree', 'twilio_purchase', 2.00,  'USD'),
  ('MX', 'local',    'twilio_purchase', 5.75,  'USD'),
  ('MX', 'mobile',   'twilio_purchase', 5.75,  'USD'),
  ('US', 'local',    'byon_hosted',     3.00,  'USD'),
  ('US', 'local',    'byon_portin',     3.00,  'USD'),
  ('CA', 'local',    'byon_hosted',     3.00,  'USD'),
  ('CA', 'local',    'byon_portin',     3.00,  'USD'),
  ('MX', 'local',    'byon_hosted',     6.00,  'USD'),
  ('MX', 'local',    'byon_portin',     6.00,  'USD'),
  ('US', 'local',    'byon_verified_id',0.00,  'USD'),
  ('CA', 'local',    'byon_verified_id',0.00,  'USD'),
  ('MX', 'local',    'byon_verified_id',0.00,  'USD')
ON CONFLICT (country_code, number_type, source) DO NOTHING;

-- 5. Extend admin_manage_tenant_subscription with change_plan action
CREATE OR REPLACE FUNCTION public.admin_manage_tenant_subscription(
  _tenant_id uuid,
  _action text,
  _extend_days integer DEFAULT NULL,
  _new_plan_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _basic_plan_id uuid;
  _existing_plan uuid;
  _new_trial_ends timestamptz;
  _new_status text;
  _target_plan_id uuid;
  _old_plan_id uuid;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _caller AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Only super_admin can manage tenant subscriptions' USING ERRCODE = '42501';
  END IF;

  IF _tenant_id = '00000000-0000-0000-0000-000000000001'::uuid AND _action IN ('block','set_past_due') THEN
    RAISE EXCEPTION 'Master tenant cannot be blocked' USING ERRCODE = '42501';
  END IF;

  SELECT plan_id INTO _existing_plan FROM public.tenant_subscriptions WHERE tenant_id = _tenant_id LIMIT 1;
  IF _existing_plan IS NULL THEN
    SELECT id INTO _basic_plan_id FROM public.subscription_plans WHERE slug = 'basic' LIMIT 1;
    IF _basic_plan_id IS NULL THEN
      SELECT id INTO _basic_plan_id FROM public.subscription_plans ORDER BY price_monthly ASC NULLS LAST LIMIT 1;
    END IF;
    _existing_plan := _basic_plan_id;
  END IF;

  IF _action = 'extend_trial' THEN
    IF _extend_days IS NULL OR _extend_days <= 0 OR _extend_days > 365 THEN
      RAISE EXCEPTION 'extend_days must be between 1 and 365';
    END IF;
    _new_trial_ends := now() + (_extend_days || ' days')::interval;
    _new_status := 'trialing';

    INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, trial_ends_at)
    VALUES (_tenant_id, _existing_plan, _new_status, _new_trial_ends)
    ON CONFLICT (tenant_id) DO UPDATE
      SET status = EXCLUDED.status,
          trial_ends_at = EXCLUDED.trial_ends_at,
          updated_at = now();

  ELSIF _action = 'change_plan' THEN
    IF _new_plan_slug IS NULL THEN
      RAISE EXCEPTION 'new_plan_slug is required for change_plan';
    END IF;
    SELECT id INTO _target_plan_id FROM public.subscription_plans WHERE slug = _new_plan_slug LIMIT 1;
    IF _target_plan_id IS NULL THEN
      RAISE EXCEPTION 'Plan not found: %', _new_plan_slug;
    END IF;
    _old_plan_id := _existing_plan;

    INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status)
    VALUES (_tenant_id, _target_plan_id, 'active')
    ON CONFLICT (tenant_id) DO UPDATE
      SET plan_id = EXCLUDED.plan_id,
          updated_at = now();

    BEGIN
      INSERT INTO public.plan_change_history (tenant_id, from_plan_id, to_plan_id, changed_by, reason)
      VALUES (_tenant_id, _old_plan_id, _target_plan_id, _caller, 'admin_change_plan');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    _new_status := 'active';

  ELSIF _action IN ('activate','set_trialing','set_past_due','block') THEN
    _new_status := CASE _action
      WHEN 'activate' THEN 'active'
      WHEN 'set_trialing' THEN 'trialing'
      WHEN 'set_past_due' THEN 'past_due'
      WHEN 'block' THEN 'blocked'
    END;

    INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status)
    VALUES (_tenant_id, _existing_plan, _new_status)
    ON CONFLICT (tenant_id) DO UPDATE
      SET status = EXCLUDED.status,
          updated_at = now();
  ELSE
    RAISE EXCEPTION 'Unknown action: %', _action;
  END IF;

  INSERT INTO public.audit_events (tenant_id, event_type, actor_id, resource_type, resource_id, payload)
  VALUES (_tenant_id, 'admin_subscription_action', _caller, 'tenant_subscriptions', _tenant_id::text,
    jsonb_build_object('action', _action, 'extend_days', _extend_days, 'new_status', _new_status, 'new_plan_slug', _new_plan_slug));

  RETURN jsonb_build_object('ok', true, 'action', _action, 'status', _new_status);
END;
$function$;
