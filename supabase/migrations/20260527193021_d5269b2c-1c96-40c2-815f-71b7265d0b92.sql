DROP VIEW IF EXISTS public.google_calendar_connection_status;

-- Grant SELECT only on non-sensitive columns to authenticated users.
-- access_token and refresh_token remain restricted to service_role.
GRANT SELECT (user_id, tenant_id, status, calendar_id, token_expires_at, created_at, updated_at)
  ON public.google_calendar_tokens TO authenticated;

-- Re-add user-scoped SELECT policy (RLS still applies on top of column grants)
CREATE POLICY "Users can view own calendar connection status"
  ON public.google_calendar_tokens
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());