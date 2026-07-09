
-- Generic background jobs queue (mirrors the proven call_jobs pattern, but decoupled).
-- call_jobs and its worker are intentionally left untouched.

CREATE TABLE IF NOT EXISTS public.background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  job_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','success','error')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  run_after timestamptz NOT NULL DEFAULT now(),
  result jsonb NULL,
  error text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.background_jobs TO authenticated;
GRANT ALL ON public.background_jobs TO service_role;

CREATE INDEX IF NOT EXISTS idx_background_jobs_status_run_after
  ON public.background_jobs (status, run_after);

CREATE INDEX IF NOT EXISTS idx_background_jobs_tenant_created
  ON public.background_jobs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_background_jobs_type
  ON public.background_jobs (job_type);

ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;

-- Users can view jobs for their own tenant; super_admin sees everything.
-- No INSERT/UPDATE/DELETE policies → mutations only through service_role edge functions.
CREATE POLICY "Users can view their tenant's background jobs"
  ON public.background_jobs
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (tenant_id IS NOT NULL AND tenant_id = public.get_user_tenant_id(auth.uid()))
  );

-- Reuse the existing public.update_updated_at_column() trigger function.
DROP TRIGGER IF EXISTS trg_background_jobs_updated_at ON public.background_jobs;
CREATE TRIGGER trg_background_jobs_updated_at
  BEFORE UPDATE ON public.background_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
