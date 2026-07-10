
CREATE TABLE public.sms_inbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  message_sid text NOT NULL UNIQUE,
  from_e164 text NOT NULL,
  to_e164 text NOT NULL,
  body text,
  num_media int NOT NULL DEFAULT 0,
  raw jsonb,
  read_at timestamptz,
  deleted_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_inbound_messages TO authenticated;
GRANT ALL ON public.sms_inbound_messages TO service_role;

ALTER TABLE public.sms_inbound_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_inbound_select_tenant"
  ON public.sms_inbound_messages
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "sms_inbound_update_tenant"
  ON public.sms_inbound_messages
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE INDEX sms_inbound_tenant_received_idx
  ON public.sms_inbound_messages (tenant_id, received_at DESC);

CREATE INDEX sms_inbound_unread_idx
  ON public.sms_inbound_messages (tenant_id)
  WHERE read_at IS NULL AND deleted_at IS NULL;

CREATE TRIGGER sms_inbound_set_updated_at
  BEFORE UPDATE ON public.sms_inbound_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
