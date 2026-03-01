-- Restrict direct tenant SELECT to admins/owners only
-- Regular users access safe data via get_tenant_branding RPC (SECURITY DEFINER)
DROP POLICY IF EXISTS "Users can view own tenant" ON public.tenants;

CREATE POLICY "Admins can view own tenant"
  ON public.tenants FOR SELECT
  USING (
    (id = get_user_tenant_id(auth.uid()))
    AND (
      has_tenant_role(auth.uid(), id, 'admin')
      OR has_tenant_role(auth.uid(), id, 'owner')
      OR has_tenant_role(auth.uid(), id, 'super_admin')
    )
  );