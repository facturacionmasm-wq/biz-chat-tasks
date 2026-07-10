
-- Fix A: publish sms_inbound_messages on supabase_realtime (idempotent)
-- Rollback: ALTER PUBLICATION supabase_realtime DROP TABLE public.sms_inbound_messages;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sms_inbound_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.sms_inbound_messages';
  END IF;
END $$;

ALTER TABLE public.sms_inbound_messages REPLICA IDENTITY FULL;
