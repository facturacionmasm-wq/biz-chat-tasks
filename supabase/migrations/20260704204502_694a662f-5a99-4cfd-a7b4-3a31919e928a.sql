
-- Lock secret columns from authenticated role via column-level privileges
-- google_calendar_tokens: hide access_token, refresh_token, scopes
REVOKE SELECT ON public.google_calendar_tokens FROM authenticated;
GRANT SELECT (
  id, user_id, tenant_id, email, status, calendar_id,
  token_expires_at, last_pull_at, created_at, updated_at
) ON public.google_calendar_tokens TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.google_calendar_tokens TO authenticated;

-- profiles: hide pin_hash
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (
  id, user_id, tenant_id, name, email, phone, whatsapp_number,
  avatar_url, status, onboarding_completed, created_at, updated_at
) ON public.profiles TO authenticated;
GRANT INSERT, DELETE ON public.profiles TO authenticated;
GRANT UPDATE (
  name, email, phone, whatsapp_number, avatar_url, status,
  onboarding_completed, updated_at
) ON public.profiles TO authenticated;

-- Convenience view for calendar connection status (non-secret columns only)
CREATE OR REPLACE VIEW public.calendar_connections_v
WITH (security_invoker = true) AS
SELECT id, user_id, tenant_id, email, status, calendar_id,
       token_expires_at, last_pull_at, created_at, updated_at
FROM public.google_calendar_tokens;

GRANT SELECT ON public.calendar_connections_v TO authenticated;
