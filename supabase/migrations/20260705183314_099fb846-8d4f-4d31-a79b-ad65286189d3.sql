-- Security-definer helper: guarantees the current user has a tenant + profile + owner role + trial.
CREATE OR REPLACE FUNCTION public.ensure_tenant_for_current_user()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _email text;
  _name text;
  _tenant uuid;
  _basic uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT tenant_id INTO _tenant FROM public.profiles WHERE user_id = _uid LIMIT 1;

  IF _tenant IS NULL THEN
    SELECT email, COALESCE(raw_user_meta_data->>'name', raw_user_meta_data->>'full_name', split_part(email,'@',1))
      INTO _email, _name
    FROM auth.users WHERE id = _uid LIMIT 1;

    INSERT INTO public.tenants (name)
    VALUES (COALESCE(NULLIF(_name, ''), 'Mi Empresa'))
    RETURNING id INTO _tenant;

    INSERT INTO public.user_roles (user_id, tenant_id, role)
    VALUES (_uid, _tenant, 'owner')
    ON CONFLICT (user_id, tenant_id, role) DO NOTHING;

    INSERT INTO public.profiles (user_id, tenant_id, name, email, onboarding_completed)
    VALUES (_uid, _tenant, _name, _email, false)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  -- Ensure trial exists
  IF NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE tenant_id = _tenant) THEN
    SELECT id INTO _basic FROM public.subscription_plans WHERE slug = 'basic' LIMIT 1;
    IF _basic IS NULL THEN
      SELECT id INTO _basic FROM public.subscription_plans ORDER BY price_monthly ASC NULLS LAST LIMIT 1;
    END IF;
    IF _basic IS NOT NULL THEN
      INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, trial_ends_at)
      VALUES (_tenant, _basic, 'trialing', now() + interval '15 days')
      ON CONFLICT (tenant_id) DO NOTHING;
    END IF;
  END IF;

  RETURN jsonb_build_object('tenant_id', _tenant, 'ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_tenant_for_current_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_tenant_for_current_user() TO authenticated;

-- Backfill: repair orphaned auth users (no profile) so they can complete onboarding.
DO $$
DECLARE
  r record;
  _tenant uuid;
  _basic uuid;
  _name text;
BEGIN
  SELECT id INTO _basic FROM public.subscription_plans WHERE slug = 'basic' LIMIT 1;

  FOR r IN
    SELECT u.id, u.email, u.raw_user_meta_data
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.user_id = u.id
    WHERE p.user_id IS NULL
  LOOP
    _name := COALESCE(r.raw_user_meta_data->>'name', r.raw_user_meta_data->>'full_name', split_part(r.email,'@',1));

    INSERT INTO public.tenants (name)
    VALUES (COALESCE(NULLIF(_name, ''), 'Mi Empresa'))
    RETURNING id INTO _tenant;

    INSERT INTO public.user_roles (user_id, tenant_id, role)
    VALUES (r.id, _tenant, 'owner')
    ON CONFLICT (user_id, tenant_id, role) DO NOTHING;

    INSERT INTO public.profiles (user_id, tenant_id, name, email, onboarding_completed)
    VALUES (r.id, _tenant, _name, r.email, false)
    ON CONFLICT (user_id) DO NOTHING;

    IF _basic IS NOT NULL THEN
      INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, trial_ends_at)
      VALUES (_tenant, _basic, 'trialing', now() + interval '15 days')
      ON CONFLICT (tenant_id) DO NOTHING;
    END IF;
  END LOOP;
END $$;