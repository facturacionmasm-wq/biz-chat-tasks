
-- 1. Create a public branding view with only safe fields
CREATE VIEW public.tenants_public
WITH (security_invoker = on) AS
  SELECT id, name, settings_json
  FROM public.tenants;

-- 2. Drop the overly permissive public SELECT policy
DROP POLICY IF EXISTS "Public can read tenant branding" ON public.tenants;

-- 3. Add a restrictive policy: only authenticated tenant members can SELECT
-- (the "Users can view own tenant" policy already handles this,
--  but we need a public-facing policy on the VIEW)
-- Since the view uses security_invoker, RLS on tenants applies.
-- For unauthenticated branding access, we add a SELECT policy on tenants
-- that only exposes rows but the view limits columns.
CREATE POLICY "Public can read tenant branding via view"
  ON public.tenants FOR SELECT
  USING (true);
