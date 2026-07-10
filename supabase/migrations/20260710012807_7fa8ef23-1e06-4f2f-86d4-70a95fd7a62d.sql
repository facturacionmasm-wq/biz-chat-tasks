
DROP POLICY IF EXISTS "Users read own receipts in tenant" ON public.message_read_receipts;
DROP POLICY IF EXISTS "Users insert own receipts in tenant" ON public.message_read_receipts;

CREATE POLICY "Users read own receipts in tenant"
ON public.message_read_receipts
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.internal_messages im
    JOIN public.user_roles ur
      ON ur.tenant_id = im.tenant_id AND ur.user_id = auth.uid()
    WHERE im.id = message_read_receipts.message_id
  )
);

CREATE POLICY "Users insert own receipts in tenant"
ON public.message_read_receipts
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.internal_messages im
    JOIN public.user_roles ur
      ON ur.tenant_id = im.tenant_id AND ur.user_id = auth.uid()
    WHERE im.id = message_read_receipts.message_id
  )
);
