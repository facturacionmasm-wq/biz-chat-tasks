DROP POLICY IF EXISTS "Owners can update tenant" ON public.tenants;
CREATE POLICY "Owners can update tenant" ON public.tenants
  FOR UPDATE
  USING (
    has_tenant_role(auth.uid(), id, 'owner'::app_role)
    OR has_tenant_role(auth.uid(), id, 'super_admin'::app_role)
    OR has_tenant_role(auth.uid(), id, 'admin'::app_role)
  );