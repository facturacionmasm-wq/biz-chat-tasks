
-- Allow authenticated users to enqueue their own background jobs.
-- Restrict to a safe allow-list of job_types. Mutations (running/success/error)
-- remain service_role-only (no UPDATE policy exists).
DROP POLICY IF EXISTS "Users can enqueue their own background jobs" ON public.background_jobs;
CREATE POLICY "Users can enqueue their own background jobs"
  ON public.background_jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND status = 'queued'
    AND attempts = 0
    AND job_type IN (
      'send_email',
      'generate_report',
      'kb_sync_all',
      'calendar_sync',
      'delete_tenant',
      'cleanup'
    )
    AND (
      -- Super admin can enqueue tenant-scoped or global jobs
      public.has_role(auth.uid(), 'super_admin')
      -- Regular users may only enqueue jobs scoped to their own tenant
      OR (tenant_id IS NOT NULL AND tenant_id = public.get_user_tenant_id(auth.uid()))
    )
  );

GRANT INSERT ON public.background_jobs TO authenticated;

-- Drain the background jobs queue every minute via pg_cron + pg_net.
-- Idempotent unschedule to allow re-running the migration.
DO $$
BEGIN
  PERFORM cron.unschedule('drain-background-jobs');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'drain-background-jobs',
  '* * * * *',
  $$
  SELECT net.http_post(
    url:='https://shcgtvthadhvlxrltmib.supabase.co/functions/v1/background-job-worker',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNoY2d0dnRoYWRodmx4cmx0bWliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjA5NTIsImV4cCI6MjA4Nzc5Njk1Mn0.X08nGU3Wb55Orgg536bDs57td6Ctk8fX310zVB9nDlU"}'::jsonb,
    body:='{"time": "now"}'::jsonb
  ) AS request_id;
  $$
);
