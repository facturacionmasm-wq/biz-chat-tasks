
-- =========================================================
-- Fix 1: google_calendar_tokens — remove client read/write of OAuth tokens
-- =========================================================
DROP POLICY IF EXISTS "Users can view own calendar connection status" ON public.google_calendar_tokens;
DROP POLICY IF EXISTS "Users manage own calendar tokens"             ON public.google_calendar_tokens;

CREATE POLICY "Users can disconnect own calendar tokens"
  ON public.google_calendar_tokens
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Ensure service_role retains full access (edge functions).
GRANT ALL ON public.google_calendar_tokens TO service_role;

-- =========================================================
-- Fix 2: profiles.pin_hash — column-level grants exclude pin_hash for authenticated
-- Keeps existing RLS policies intact (including "Tenant users can view team profiles").
-- =========================================================
REVOKE SELECT, INSERT, UPDATE ON public.profiles FROM authenticated;

GRANT SELECT (id, user_id, tenant_id, name, email, phone, whatsapp_number,
              avatar_url, status, created_at, updated_at,
              onboarding_completed, department)
  ON public.profiles TO authenticated;

GRANT INSERT (id, user_id, tenant_id, name, email, phone, whatsapp_number,
              avatar_url, status, onboarding_completed, department)
  ON public.profiles TO authenticated;

GRANT UPDATE (name, email, phone, whatsapp_number, avatar_url, status,
              onboarding_completed, department)
  ON public.profiles TO authenticated;

-- DELETE keeps its existing table-level grant governed by the "Admins can delete profiles" policy.
GRANT ALL ON public.profiles TO service_role;
