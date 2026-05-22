
-- 1) Drop redundant "Service role full access" policies on document tables.
-- These targeted role 'public' with USING(true)/WITH CHECK(true), which exposed
-- documents and OCR'd PII to anonymous users. service_role bypasses RLS anyway.
DROP POLICY IF EXISTS "Service role full access on documents" ON public.documents;
DROP POLICY IF EXISTS "Service role full access on document_chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Service role full access on document_memory" ON public.document_memory;
DROP POLICY IF EXISTS "Service role full access on document_alerts" ON public.document_alerts;
DROP POLICY IF EXISTS "Service role full access on document_workflow_log" ON public.document_workflow_log;
DROP POLICY IF EXISTS "Service role full access on document_workflow_rules" ON public.document_workflow_rules;
DROP POLICY IF EXISTS "Service role full access on document_jobs" ON public.document_jobs;

-- 2) Tighten role on tenant view policies from public -> authenticated
DROP POLICY IF EXISTS "Tenant members view chunks" ON public.document_chunks;
CREATE POLICY "Tenant members view chunks"
  ON public.document_chunks FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "Tenant members view memory" ON public.document_memory;
CREATE POLICY "Tenant members view memory"
  ON public.document_memory FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "Tenant members view workflow log" ON public.document_workflow_log;
CREATE POLICY "Tenant members view workflow log"
  ON public.document_workflow_log FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "Tenant admins manage workflow rules" ON public.document_workflow_rules;
CREATE POLICY "Tenant admins manage workflow rules"
  ON public.document_workflow_rules FOR ALL TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'admin'::public.app_role)
      OR public.has_tenant_role(auth.uid(), tenant_id, 'owner'::public.app_role)
    )
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'admin'::public.app_role)
      OR public.has_tenant_role(auth.uid(), tenant_id, 'owner'::public.app_role)
    )
  );

-- 3) Expenses: restrict to owner + admin/owner override
DROP POLICY IF EXISTS "Users can view own expenses" ON public.expenses;
DROP POLICY IF EXISTS "Users can insert own expenses" ON public.expenses;
DROP POLICY IF EXISTS "Users can update own expenses" ON public.expenses;

CREATE POLICY "Users view own expenses"
  ON public.expenses FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Tenant admins view all expenses"
  ON public.expenses FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'admin'::public.app_role)
      OR public.has_tenant_role(auth.uid(), tenant_id, 'owner'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    )
  );

CREATE POLICY "Users insert own expenses"
  ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = public.get_user_tenant_id(auth.uid())
  );

CREATE POLICY "Users update own expenses"
  ON public.expenses FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 4) Google calendar tokens: restrict to authenticated
DROP POLICY IF EXISTS "Users can manage own calendar tokens" ON public.google_calendar_tokens;
DROP POLICY IF EXISTS "Users can view own calendar tokens" ON public.google_calendar_tokens;

CREATE POLICY "Users manage own calendar tokens"
  ON public.google_calendar_tokens FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 5) Storage: call-recordings — remove public ALL policy
DROP POLICY IF EXISTS "Service role manages recordings" ON storage.objects;
CREATE POLICY "Service role manages recordings"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'call-recordings')
  WITH CHECK (bucket_id = 'call-recordings');

-- restrict the read policy role too
DROP POLICY IF EXISTS "Tenant users can read own recordings" ON storage.objects;
CREATE POLICY "Tenant users can read own recordings"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'call-recordings'
    AND (storage.foldername(name))[1] = (public.get_user_tenant_id(auth.uid()))::text
  );

-- 6) Revoke EXECUTE on background/admin helpers from anon
REVOKE EXECUTE ON FUNCTION public.block_expired_trials() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_nonces() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calculate_next_retry(integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_document_chunks(uuid, text, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
