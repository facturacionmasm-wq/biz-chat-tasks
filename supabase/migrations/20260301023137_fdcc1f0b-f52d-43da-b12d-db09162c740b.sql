-- Recreate profiles_safe with security_invoker so base table RLS applies
DROP VIEW IF EXISTS public.profiles_safe;

CREATE VIEW public.profiles_safe
WITH (security_invoker = on) AS
  SELECT id, user_id, tenant_id, name, email, phone, whatsapp_number,
         avatar_url, status, created_at, updated_at
  FROM public.profiles;

-- Add tenant-scoped SELECT policy for team lookups (excludes pin_hash via view)
CREATE POLICY "Tenant users can view team profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));