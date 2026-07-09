
-- ALERTA 1: profiles.pin_hash column-level revoke
REVOKE SELECT (pin_hash) ON public.profiles FROM authenticated, anon;
GRANT SELECT (pin_hash) ON public.profiles TO service_role;

-- ALERTA 2: calcom_integrations SELECT restricted to admin/owner/super_admin
DROP POLICY IF EXISTS "Tenant members can view calcom integration" ON public.calcom_integrations;
CREATE POLICY "Tenant admins can view calcom integration"
ON public.calcom_integrations
FOR SELECT
TO authenticated
USING (
  has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
  OR has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- ALERTA 3: shared_credentials SELECT restricted to staff/admin/owner/super_admin
DROP POLICY IF EXISTS "Tenant users can view credentials" ON public.shared_credentials;
CREATE POLICY "Elevated roles can view credentials"
ON public.shared_credentials
FOR SELECT
TO authenticated
USING (
  tenant_id = get_user_tenant_id(auth.uid())
  AND (
    has_tenant_role(auth.uid(), tenant_id, 'staff'::app_role)
    OR has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
    OR has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
);
