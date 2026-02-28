
CREATE POLICY "Admins can update team profiles"
  ON public.profiles
  FOR UPDATE
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    AND (
      has_tenant_role(auth.uid(), tenant_id, 'super_admin'::app_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
    )
  );
