
-- Table to track appointment confirmations and scheduled reminders
CREATE TABLE public.appointment_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  target_phone TEXT,
  target_user_id UUID,
  notification_type TEXT NOT NULL, -- 'confirmation', 'reminder_1h', 'reminder_15m', 'confirmation_status'
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, sent, failed, no_phone
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  response TEXT, -- 'confirmed', 'rejected'
  responded_at TIMESTAMPTZ,
  message_body TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.appointment_notifications ENABLE ROW LEVEL SECURITY;

-- RLS: tenant users can view their notifications
CREATE POLICY "Tenant users can view appointment notifications"
ON public.appointment_notifications
FOR SELECT
USING (tenant_id = get_user_tenant_id(auth.uid()));

-- Index for the cron job to find due notifications efficiently
CREATE INDEX idx_appt_notif_due ON public.appointment_notifications (status, scheduled_at)
WHERE status IN ('pending', 'failed');

-- Index for looking up by appointment
CREATE INDEX idx_appt_notif_appointment ON public.appointment_notifications (appointment_id);
