-- P0: reminders due queue (cron send-reminders, 46k calls, seq scan)
CREATE INDEX IF NOT EXISTS idx_reminders_due
  ON public.reminders (remind_at)
  WHERE status IN ('pending','failed');

-- P0: whatsapp_messages by conversation ordered by time (inbox)
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conv_created
  ON public.whatsapp_messages (conversation_id, created_at DESC);

-- P0: whatsapp_messages metadata containment queries (@>)
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_metadata_gin
  ON public.whatsapp_messages USING GIN (metadata);