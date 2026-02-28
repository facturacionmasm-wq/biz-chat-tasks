-- Allow admins/super_admin to delete profiles
CREATE POLICY "Admins can delete profiles" ON public.profiles
  FOR DELETE
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    AND (
      has_tenant_role(auth.uid(), tenant_id, 'super_admin'::app_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    )
    AND user_id != auth.uid()
  );

-- Allow admins/super_admin to delete user_roles
CREATE POLICY "Super admin can delete roles" ON public.user_roles
  FOR DELETE
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    AND (
      has_tenant_role(auth.uid(), tenant_id, 'super_admin'::app_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    )
    AND user_id != auth.uid()
  );