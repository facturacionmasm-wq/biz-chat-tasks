
-- Structured logging table for Voice Agent observability
CREATE TABLE public.voice_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sid text NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  stage text NOT NULL,
  error_code text,
  error_message text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookup by call_sid
CREATE INDEX idx_voice_call_logs_call_sid ON public.voice_call_logs(call_sid);
CREATE INDEX idx_voice_call_logs_tenant_stage ON public.voice_call_logs(tenant_id, stage);
CREATE INDEX idx_voice_call_logs_created ON public.voice_call_logs(created_at DESC);

-- Enable RLS
ALTER TABLE public.voice_call_logs ENABLE ROW LEVEL SECURITY;

-- Only service_role can write (from edge functions)
CREATE POLICY "Service role full access on voice_call_logs"
  ON public.voice_call_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read their tenant's logs
CREATE POLICY "Tenant members can read voice_call_logs"
  ON public.voice_call_logs
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid()
    )
  );
