
CREATE TABLE public.call_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_record_id uuid NOT NULL REFERENCES public.call_records(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  event_type text NOT NULL,
  event_data jsonb DEFAULT '{}'::jsonb,
  twilio_call_sid text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_call_events_call_record ON public.call_events(call_record_id);
CREATE INDEX idx_call_events_tenant ON public.call_events(tenant_id);
CREATE INDEX idx_call_events_twilio_sid ON public.call_events(twilio_call_sid);

ALTER TABLE public.call_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view call events"
  ON public.call_events FOR SELECT
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Service role writes call events"
  ON public.call_events FOR INSERT
  WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.call_events;
