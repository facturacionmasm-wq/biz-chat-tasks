CREATE INDEX IF NOT EXISTS idx_call_jobs_queue_created
  ON public.call_jobs (run_after, created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_appointments_sync_attempt
  ON public.appointments (last_sync_attempt NULLS FIRST)
  WHERE calendar_sync_status IN ('PENDING_SYNC','FAILED_SYNC') AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_tenant_lastmsg
  ON public.whatsapp_conversations (tenant_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_date
  ON public.expenses (tenant_id, expense_date DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_user_status
  ON public.expenses (user_id, status);

CREATE INDEX IF NOT EXISTS idx_wa_usage_events_tenant_created
  ON public.whatsapp_usage_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reminders_tenant_user_remind
  ON public.reminders (tenant_id, user_id, remind_at);