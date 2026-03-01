
-- =============================================
-- VOICE AGENT: call_jobs + storage bucket
-- =============================================

-- 1. Async Job Queue for call pipeline
CREATE TABLE IF NOT EXISTS public.call_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  call_id uuid NOT NULL REFERENCES public.call_records(id) ON DELETE CASCADE,
  job_type text NOT NULL, -- fetch_recording, transcribe_call, summarize_call, extract_appointment
  status text NOT NULL DEFAULT 'queued', -- queued, running, success, error, blocked
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_after timestamptz NOT NULL DEFAULT now(),
  last_error text,
  result_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_call_job UNIQUE (call_id, job_type)
);

-- Indexes for worker efficiency
CREATE INDEX idx_call_jobs_queue ON public.call_jobs (status, run_after) WHERE status = 'queued';
CREATE INDEX idx_call_jobs_tenant ON public.call_jobs (tenant_id);
CREATE INDEX idx_call_jobs_call ON public.call_jobs (call_id);

-- RLS
ALTER TABLE public.call_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages jobs"
  ON public.call_jobs FOR ALL
  USING (true);

CREATE POLICY "Admins can view jobs"
  ON public.call_jobs FOR SELECT
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    AND (
      has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'super_admin'::app_role)
    )
  );

-- Trigger for updated_at
CREATE TRIGGER update_call_jobs_updated_at
  BEFORE UPDATE ON public.call_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 2. Storage bucket for call recordings
INSERT INTO storage.buckets (id, name, public)
VALUES ('call-recordings', 'call-recordings', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: tenant isolation
CREATE POLICY "Tenant users can read own recordings"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'call-recordings'
    AND (storage.foldername(name))[1] = (get_user_tenant_id(auth.uid()))::text
  );

CREATE POLICY "Service role manages recordings"
  ON storage.objects FOR ALL
  USING (bucket_id = 'call-recordings');

-- 3. Enable realtime on call_jobs for monitoring
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_jobs;
