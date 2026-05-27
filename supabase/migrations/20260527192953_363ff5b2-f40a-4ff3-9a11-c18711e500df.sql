-- 1. Restrict google_calendar_tokens SELECT to service_role only
DROP POLICY IF EXISTS "Users can view own google tokens" ON public.google_calendar_tokens;
DROP POLICY IF EXISTS "Users can view their own google tokens" ON public.google_calendar_tokens;
DROP POLICY IF EXISTS "Users view own google tokens" ON public.google_calendar_tokens;
DROP POLICY IF EXISTS "Users can read own google tokens" ON public.google_calendar_tokens;
DROP POLICY IF EXISTS "Users can select own google tokens" ON public.google_calendar_tokens;

REVOKE SELECT ON public.google_calendar_tokens FROM authenticated, anon;
GRANT ALL ON public.google_calendar_tokens TO service_role;

-- Allow client to check connection status without exposing tokens via a view
CREATE OR REPLACE VIEW public.google_calendar_connection_status AS
SELECT
  user_id,
  tenant_id,
  status,
  calendar_id,
  token_expires_at,
  created_at,
  updated_at
FROM public.google_calendar_tokens;

GRANT SELECT ON public.google_calendar_connection_status TO authenticated;

-- 2. Enforce NOT NULL on voice_call_logs.tenant_id to prevent ambiguous rows
DELETE FROM public.voice_call_logs WHERE tenant_id IS NULL;
ALTER TABLE public.voice_call_logs ALTER COLUMN tenant_id SET NOT NULL;