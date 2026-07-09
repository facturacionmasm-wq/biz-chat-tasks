ALTER TABLE public.call_sessions
  ADD COLUMN IF NOT EXISTS ended_intentionally boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz;