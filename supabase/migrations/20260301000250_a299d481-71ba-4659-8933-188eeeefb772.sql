
-- 1. Add onboarding flag to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false;

-- 2. Mark existing profiles as onboarded
UPDATE public.profiles SET onboarding_completed = true WHERE onboarding_completed = false;

-- 3. Subscription plans table
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  price_monthly numeric NOT NULL DEFAULT 0,
  price_yearly numeric,
  features jsonb DEFAULT '{}',
  limits jsonb DEFAULT '{}',
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active plans" ON public.subscription_plans
  FOR SELECT TO authenticated
  USING (active = true);

CREATE TRIGGER update_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. Tenant subscriptions table
CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id),
  status text NOT NULL DEFAULT 'trialing',
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  canceled_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view subscription" ON public.tenant_subscriptions
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Owners can update subscription" ON public.tenant_subscriptions
  FOR UPDATE TO authenticated
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    AND (
      has_tenant_role(auth.uid(), tenant_id, 'owner')
      OR has_tenant_role(auth.uid(), tenant_id, 'super_admin')
    )
  );

CREATE POLICY "Service role manages subscriptions" ON public.tenant_subscriptions
  FOR ALL TO service_role
  USING (true);

CREATE TRIGGER update_tenant_subscriptions_updated_at
  BEFORE UPDATE ON public.tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. Seed subscription plans
INSERT INTO public.subscription_plans (name, slug, price_monthly, price_yearly, features, limits, sort_order) VALUES
  ('Basic', 'basic', 29, 290,
   '{"whatsapp": true, "voice_agent": false, "knowledge_base": true, "api_access": false}',
   '{"max_users": 3, "max_calls": 100, "max_knowledge_items": 50}', 1),
  ('Pro', 'pro', 79, 790,
   '{"whatsapp": true, "voice_agent": true, "knowledge_base": true, "api_access": true}',
   '{"max_users": 10, "max_calls": 500, "max_knowledge_items": 200}', 2),
  ('Enterprise', 'enterprise', 199, 1990,
   '{"whatsapp": true, "voice_agent": true, "knowledge_base": true, "api_access": true, "custom_integrations": true, "priority_support": true}',
   '{"max_users": -1, "max_calls": -1, "max_knowledge_items": -1}', 3);

-- 6. Update handle_new_user to create dynamic tenants
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id uuid;
  _role app_role;
  _has_super boolean;
  _admin_email text;
  _user_name text;
BEGIN
  -- Get admin email from vault
  BEGIN
    SELECT decrypted_secret INTO _admin_email
    FROM vault.decrypted_secrets
    WHERE name = 'admin_email'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    _admin_email := NULL;
  END;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE role = 'super_admin'
  ) INTO _has_super;

  _user_name := COALESCE(
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1)
  );

  IF _admin_email IS NOT NULL AND NEW.email = _admin_email AND NOT _has_super THEN
    -- Super admin gets the default tenant
    _tenant_id := '00000000-0000-0000-0000-000000000001';
    _role := 'super_admin';

    INSERT INTO public.profiles (user_id, tenant_id, name, email, onboarding_completed)
    VALUES (NEW.id, _tenant_id, _user_name, NEW.email, true)
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    -- Create a new tenant for each new user
    INSERT INTO public.tenants (name)
    VALUES (COALESCE(NULLIF(_user_name, ''), 'Mi Empresa'))
    RETURNING id INTO _tenant_id;

    _role := 'owner';

    INSERT INTO public.profiles (user_id, tenant_id, name, email, onboarding_completed)
    VALUES (NEW.id, _tenant_id, _user_name, NEW.email, false)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  INSERT INTO public.user_roles (user_id, tenant_id, role)
  VALUES (NEW.id, _tenant_id, _role)
  ON CONFLICT (user_id, tenant_id, role) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_new_user error: % %', SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

-- 7. Recreate trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 8. Add realtime for tenant_subscriptions
ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_subscriptions;
