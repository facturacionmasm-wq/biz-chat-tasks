
ALTER TABLE public.appointment_notifications
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS admin_notified_at timestamptz;
