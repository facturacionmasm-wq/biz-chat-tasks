
-- Create a default tenant for the organization
INSERT INTO public.tenants (id, name, timezone)
VALUES ('00000000-0000-0000-0000-000000000001', 'Rybix Holding', 'America/Mexico_City')
ON CONFLICT (id) DO NOTHING;

-- Create a function that auto-creates profile + role on new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id uuid := '00000000-0000-0000-0000-000000000001';
  _role app_role;
  _has_super boolean;
BEGIN
  -- Check if super_admin already exists
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE role = 'super_admin'
  ) INTO _has_super;

  -- Assign super_admin only to the designated email and only if none exists yet
  IF NEW.email = 'admin@rybixholding.com' AND NOT _has_super THEN
    _role := 'super_admin';
  ELSE
    _role := 'staff';
  END IF;

  -- Create profile
  INSERT INTO public.profiles (user_id, tenant_id, name, email)
  VALUES (NEW.id, _tenant_id, COALESCE(NEW.raw_user_meta_data->>'name', ''), NEW.email)
  ON CONFLICT (user_id) DO NOTHING;

  -- Create role
  INSERT INTO public.user_roles (user_id, tenant_id, role)
  VALUES (NEW.id, _tenant_id, _role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Create trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
