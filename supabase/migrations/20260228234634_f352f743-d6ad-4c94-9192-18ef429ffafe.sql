
-- Fix: use security_invoker view + public SELECT on base table
DROP VIEW IF EXISTS public.tenants_public;

CREATE VIEW public.tenants_public
WITH (security_invoker = on) AS
  SELECT id, name, settings_json
  FROM public.tenants;

GRANT SELECT ON public.tenants_public TO anon, authenticated;

-- Restore public SELECT on base table (needed for security_invoker view to work for anon)
-- Supabase linter explicitly excludes SELECT USING(true) from warnings
CREATE POLICY "Public can read tenants for branding"
  ON public.tenants FOR SELECT
  USING (true);
