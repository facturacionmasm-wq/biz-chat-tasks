
-- Add calendar sync columns to appointments
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS calendar_sync_status TEXT NOT NULL DEFAULT 'CREATED_LOCAL',
  ADD COLUMN IF NOT EXISTS calendar_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS sync_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sync_attempt TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Unique index for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_idempotency_key
  ON public.appointments (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Index for sync worker
CREATE INDEX IF NOT EXISTS idx_appointments_sync_status
  ON public.appointments (calendar_sync_status) WHERE calendar_sync_status IN ('PENDING_SYNC', 'FAILED_SYNC');

-- Google Calendar tokens per user
CREATE TABLE IF NOT EXISTS public.google_calendar_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  calendar_id TEXT DEFAULT 'primary',
  email TEXT,
  scopes TEXT[] DEFAULT ARRAY['https://www.googleapis.com/auth/calendar'],
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, tenant_id)
);

ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY;

-- Only the user can view their own tokens
CREATE POLICY "Users can view own calendar tokens"
  ON public.google_calendar_tokens FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can manage own calendar tokens"
  ON public.google_calendar_tokens FOR ALL
  USING (user_id = auth.uid());

-- Service role can manage all tokens (for edge functions)
CREATE POLICY "Service role manages calendar tokens"
  ON public.google_calendar_tokens FOR ALL
  USING (true);
