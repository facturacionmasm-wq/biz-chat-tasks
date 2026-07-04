
-- Restrict SELECT of sensitive columns to service_role only via column-level privileges.

-- profiles.pin_hash
REVOKE SELECT ON public.profiles FROM authenticated;
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (id, user_id, tenant_id, name, email, phone, whatsapp_number, avatar_url, status, created_at, updated_at, onboarding_completed) ON public.profiles TO authenticated;

-- google_calendar_tokens.access_token, refresh_token
REVOKE SELECT ON public.google_calendar_tokens FROM authenticated;
REVOKE SELECT ON public.google_calendar_tokens FROM anon;
GRANT SELECT (id, user_id, tenant_id, token_expires_at, calendar_id, email, scopes, status, created_at, updated_at) ON public.google_calendar_tokens TO authenticated;

-- shared_credentials.password_encrypted
REVOKE SELECT ON public.shared_credentials FROM authenticated;
REVOKE SELECT ON public.shared_credentials FROM anon;
GRANT SELECT (id, tenant_id, platform_name, username, notes, created_by, created_at, updated_at) ON public.shared_credentials TO authenticated;
