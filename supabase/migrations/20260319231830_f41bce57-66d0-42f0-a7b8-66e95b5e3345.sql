
-- Table for OAuth nonces to prevent state injection attacks
CREATE TABLE public.oauth_nonces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  app_origin text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

ALTER TABLE public.oauth_nonces ENABLE ROW LEVEL SECURITY;

-- Only service_role can manage nonces
CREATE POLICY "Service role manages nonces"
  ON public.oauth_nonces FOR ALL TO service_role
  USING (true);

-- Auto-cleanup expired nonces
CREATE OR REPLACE FUNCTION public.cleanup_expired_nonces()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  DELETE FROM public.oauth_nonces WHERE expires_at < now();
$$;

-- Add audit logging for super_admin role assignments in handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tenant_id uuid;
  _role app_role;
  _has_super boolean;
  _admin_email text;
  _user_name text;
BEGIN
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
    _tenant_id := '00000000-0000-0000-0000-000000000001';
    _role := 'super_admin';

    INSERT INTO public.profiles (user_id, tenant_id, name, email, onboarding_completed)
    VALUES (NEW.id, _tenant_id, _user_name, NEW.email, true)
    ON CONFLICT (user_id) DO NOTHING;

    -- Audit log: super_admin role assignment
    INSERT INTO public.audit_events (tenant_id, event_type, actor_id, resource_type, resource_id, payload)
    VALUES (_tenant_id, 'super_admin_role_assigned', NEW.id, 'user_roles', NEW.id::text,
      jsonb_build_object('email', NEW.email, 'role', 'super_admin', 'method', 'handle_new_user_trigger'));
  ELSE
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
