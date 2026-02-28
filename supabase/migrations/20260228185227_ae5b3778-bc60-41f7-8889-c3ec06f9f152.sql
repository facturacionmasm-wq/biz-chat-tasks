-- Fix: Allow super_admin to manage roles too
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL
  TO authenticated
  USING (
    has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
    OR has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR has_tenant_role(auth.uid(), tenant_id, 'super_admin'::app_role)
  );