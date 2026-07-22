
CREATE TABLE IF NOT EXISTS public.cfo_ai_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  summary text NOT NULL,
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, week_start)
);
GRANT SELECT ON public.cfo_ai_briefings TO authenticated;
GRANT ALL ON public.cfo_ai_briefings TO service_role;
ALTER TABLE public.cfo_ai_briefings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant members read briefings" ON public.cfo_ai_briefings;
CREATE POLICY "tenant members read briefings" ON public.cfo_ai_briefings
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.admin_finance_overview()
RETURNS TABLE (
  tenant_id uuid,
  tenant_name text,
  currency text,
  health_score int,
  total_balance numeric,
  net_flow_30d numeric,
  receivables numeric,
  payables numeric,
  active_alerts_count int,
  critical_alerts_count int,
  last_activity_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Only super_admin can read finance overview' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.name,
    'MXN'::text,
    COALESCE((public.compute_tenant_health_score(t.id)->>'score')::int, 0),
    COALESCE((public.compute_tenant_financial_summary(t.id)->>'total_balance')::numeric, 0),
    COALESCE((public.compute_tenant_financial_summary(t.id)->>'net_flow')::numeric, 0),
    COALESCE((public.compute_tenant_financial_summary(t.id)->>'receivables')::numeric, 0),
    COALESCE((public.compute_tenant_financial_summary(t.id)->>'payables')::numeric, 0),
    (SELECT COUNT(*)::int FROM public.financial_alerts fa WHERE fa.tenant_id = t.id AND fa.status='active'),
    (SELECT COUNT(*)::int FROM public.financial_alerts fa WHERE fa.tenant_id = t.id AND fa.status='active' AND fa.severity='critical'),
    (SELECT MAX(posted_at) FROM public.financial_transactions WHERE tenant_id = t.id)
  FROM public.tenants t
  ORDER BY t.name;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_finance_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_finance_overview() TO authenticated;
