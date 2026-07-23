-- ============ 1) search_path mutable ============
CREATE OR REPLACE FUNCTION public.storage_path_project_id(_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path = public
AS $function$
DECLARE
  parts text[];
  candidate text;
  result uuid;
BEGIN
  parts := storage.foldername(_name);
  candidate := parts[2];
  BEGIN
    result := candidate::uuid;
    RETURN result;
  EXCEPTION WHEN others THEN
    NULL;
  END;
  candidate := parts[3];
  BEGIN
    result := candidate::uuid;
    RETURN result;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$function$;

-- ============ 2) Trigger functions: revoke EXECUTE from all roles (triggers no requieren grants) ============
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'schedule_appointment_reminders()',
    'audit_product_changes()',
    'cleanup_google_tokens_on_profile_delete()',
    'handle_new_user()',
    'enforce_founder_super_admin()',
    'recompute_budget_total_planned()',
    'audit_role_changes()',
    'prevent_profile_tenant_change()',
    'block_expired_trials()',
    'audit_cfdi_changes()',
    'audit_expense_changes()',
    'audit_financial_account_status()',
    'audit_fiscal_profile_changes()',
    'cleanup_expired_nonces()'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;

-- ============ 3) Business SECURITY DEFINER functions: revoke from PUBLIC + anon; keep authenticated + service_role ============
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'search_document_chunks(uuid, text, integer, text)',
    'get_tenant_branding(uuid)',
    'can_access_project(uuid, uuid)',
    'activate_trial_for_current_user(uuid)',
    'get_tenant_subscription_status(uuid)',
    'compute_tenant_health_score(uuid)',
    'admin_manage_tenant_subscription(uuid, text, integer, text)',
    'admin_manage_tenant_subscription(uuid, text, integer)',
    'upsert_budget(uuid, text, date, date, text, text, jsonb)',
    'compute_tenant_financial_summary(uuid, date, date, text)',
    'suggest_transaction_matches(uuid, integer)',
    'compute_budget_actuals(uuid)',
    'get_user_tenant_id(uuid)',
    'has_role(uuid, app_role)',
    'can_assign_role(uuid, uuid, app_role)',
    'delete_budget(uuid)',
    'has_tenant_role(uuid, uuid, app_role)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skip missing function %', fn;
    END;
  END LOOP;
END $$;

-- ============ 4) document_jobs: agregar policy service_role-only ============
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='document_jobs') THEN
    CREATE POLICY "service_role manages document_jobs"
      ON public.document_jobs
      FOR ALL
      TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON public.document_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.document_jobs TO service_role;