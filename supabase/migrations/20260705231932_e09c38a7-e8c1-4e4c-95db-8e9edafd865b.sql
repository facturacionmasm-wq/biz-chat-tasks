
-- (A) Explicit service_role access on otp_challenges
CREATE POLICY "Service role full access to OTP"
ON public.otp_challenges
AS PERMISSIVE
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- (B) Restrict call_events select policy to authenticated role
DROP POLICY IF EXISTS "Tenant users can view call events" ON public.call_events;
CREATE POLICY "Tenant users can view call events"
ON public.call_events
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (tenant_id = get_user_tenant_id(auth.uid()));
