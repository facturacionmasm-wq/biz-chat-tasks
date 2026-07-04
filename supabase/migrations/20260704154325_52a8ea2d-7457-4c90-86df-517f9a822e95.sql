
CREATE OR REPLACE FUNCTION public.admin_manage_tenant_subscription(
  _tenant_id uuid,
  _action text,
  _extend_days int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _basic_plan_id uuid;
  _existing_plan uuid;
  _new_trial_ends timestamptz;
  _new_status text;
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
    jsonb_build_object('action', _action, 'extend_days', _extend_days, 'new_status', _new_status));

  RETURN jsonb_build_object('ok', true, 'action', _action, 'status', _new_status);
END;
$$;

-- Ensure ON CONFLICT works on tenant_id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tenant_subscriptions'::regclass
      AND contype IN ('u','p')
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.tenant_subscriptions'::regclass AND attname = 'tenant_id')]
  ) THEN
    ALTER TABLE public.tenant_subscriptions ADD CONSTRAINT tenant_subscriptions_tenant_id_key UNIQUE (tenant_id);
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.admin_manage_tenant_subscription(uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_manage_tenant_subscription(uuid, text, int) TO authenticated;

-- Admin listing RPC: returns all tenants with their subscription info
CREATE OR REPLACE FUNCTION public.admin_list_tenants_with_subscription()
RETURNS TABLE(
  tenant_id uuid,
  tenant_name text,
  status text,
  plan_slug text,
  plan_name text,
  trial_ends_at timestamptz,
  days_remaining int,
  is_blocked boolean,
  is_master boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Only super_admin can list tenants' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    t.id AS tenant_id,
    t.name AS tenant_name,
    COALESCE(ts.status, 'no_subscription') AS status,
    sp.slug AS plan_slug,
    sp.name AS plan_name,
    ts.trial_ends_at,
    CASE
      WHEN ts.status = 'trialing' AND ts.trial_ends_at > now()
        THEN EXTRACT(DAY FROM ts.trial_ends_at - now())::int
      ELSE 0
    END AS days_remaining,
    CASE
      WHEN t.id = '00000000-0000-0000-0000-000000000001'::uuid THEN false
      WHEN ts.id IS NULL THEN true
      WHEN ts.status IN ('blocked','canceled') THEN true
      WHEN ts.status = 'trialing' AND ts.trial_ends_at < now() THEN true
      ELSE false
    END AS is_blocked,
    (t.id = '00000000-0000-0000-0000-000000000001'::uuid) AS is_master
  FROM public.tenants t
  LEFT JOIN public.tenant_subscriptions ts ON ts.tenant_id = t.id
  LEFT JOIN public.subscription_plans sp ON sp.id = ts.plan_id
  ORDER BY (t.id = '00000000-0000-0000-0000-000000000001'::uuid) DESC, t.name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_tenants_with_subscription() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_tenants_with_subscription() TO authenticated;
