
CREATE TABLE public.absence_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  call_record_id uuid NULL REFERENCES public.call_records(id) ON DELETE SET NULL,
  call_sid text NULL,
  target_user_id uuid NULL,
  target_name text NULL,
  target_phone text NULL,
  caller_phone text NULL,
  caller_name text NULL,
  contact_id uuid NULL REFERENCES public.contacts(id) ON DELETE SET NULL,
  message text NOT NULL,
  callback_requested boolean NOT NULL DEFAULT true,
  handled_at timestamptz NULL,
  handled_by uuid NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

GRANT SELECT, UPDATE ON public.absence_messages TO authenticated;
GRANT ALL ON public.absence_messages TO service_role;

ALTER TABLE public.absence_messages ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped read: any member of the tenant can see the messages.
CREATE POLICY "absence_messages_select_tenant"
ON public.absence_messages FOR SELECT
TO authenticated
USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- Tenant-scoped update: allows "mark handled" and soft-delete (deleted_at).
-- INSERT / hard-DELETE remain closed to authenticated (no policy = blocked).
CREATE POLICY "absence_messages_update_tenant"
ON public.absence_messages FOR UPDATE
TO authenticated
USING (tenant_id = public.get_user_tenant_id(auth.uid()))
WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

-- updated_at trigger (reuses existing helper)
DROP TRIGGER IF EXISTS trg_absence_messages_updated_at ON public.absence_messages;
CREATE TRIGGER trg_absence_messages_updated_at
BEFORE UPDATE ON public.absence_messages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_absence_messages_tenant_created
  ON public.absence_messages (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_absence_messages_tenant_target_handled
  ON public.absence_messages (tenant_id, target_user_id, handled_at);
CREATE INDEX IF NOT EXISTS idx_absence_messages_expires
  ON public.absence_messages (expires_at);

-- Hourly purge of expired absence messages (pure SQL cron, no pg_net needed).
DO $$
BEGIN
  PERFORM cron.unschedule('purge-absence-messages');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'purge-absence-messages',
  '0 * * * *',
  $$ DELETE FROM public.absence_messages WHERE expires_at < now(); $$
);
