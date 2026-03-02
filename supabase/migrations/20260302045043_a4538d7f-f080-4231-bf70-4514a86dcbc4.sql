
-- OTP challenges only needs service-role access (edge functions use SERVICE_ROLE_KEY)
-- But we need at least one policy to avoid the linter warning
-- OTP is internal-only, no user should directly query it
CREATE POLICY "Deny all direct access to OTP" ON public.otp_challenges
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false);
