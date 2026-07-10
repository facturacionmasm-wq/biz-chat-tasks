DROP POLICY IF EXISTS "Users read own calendar tokens" ON public.google_calendar_tokens;
REVOKE SELECT ON public.google_calendar_tokens FROM authenticated;
REVOKE SELECT ON public.google_calendar_tokens FROM anon;