
-- Drop the view and recreate without security_invoker so it can serve anon users
DROP VIEW IF EXISTS public.tenants_public;

-- Recreate as a SECURITY DEFINER view (default) so anon can read branding
-- Only safe columns exposed
CREATE VIEW public.tenants_public AS
  SELECT id, name, settings_json
  FROM public.tenants;

-- Grant SELECT on the view to anon and authenticated roles
GRANT SELECT ON public.tenants_public TO anon, authenticated;

-- Now remove the public SELECT policy from the base table
DROP POLICY IF EXISTS "Public can read tenant branding via view" ON public.tenants;
