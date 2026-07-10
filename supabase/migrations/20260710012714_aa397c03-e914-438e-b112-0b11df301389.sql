
-- ALERTA A: message_read_receipts tenant-scoped
DROP POLICY IF EXISTS "Users can manage own receipts" ON public.message_read_receipts;

CREATE POLICY "Users read own receipts in tenant"
ON public.message_read_receipts
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.chat_messages m
    JOIN public.user_roles ur
      ON ur.tenant_id = m.tenant_id AND ur.user_id = auth.uid()
    WHERE m.id = message_read_receipts.message_id
  )
);

CREATE POLICY "Users insert own receipts in tenant"
ON public.message_read_receipts
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.chat_messages m
    JOIN public.user_roles ur
      ON ur.tenant_id = m.tenant_id AND ur.user_id = auth.uid()
    WHERE m.id = message_read_receipts.message_id
  )
);

CREATE POLICY "Users delete own receipts"
ON public.message_read_receipts
FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- ALERTA B: google_calendar_tokens explicit restrictive policies
CREATE POLICY "Users read own calendar tokens"
ON public.google_calendar_tokens
FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Service role manages calendar tokens"
ON public.google_calendar_tokens
FOR ALL TO service_role
USING (true) WITH CHECK (true);

REVOKE INSERT, UPDATE ON public.google_calendar_tokens FROM authenticated;
GRANT SELECT, DELETE ON public.google_calendar_tokens TO authenticated;
GRANT ALL ON public.google_calendar_tokens TO service_role;
