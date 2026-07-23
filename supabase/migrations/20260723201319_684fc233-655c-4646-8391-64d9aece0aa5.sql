CREATE OR REPLACE FUNCTION public.admin_finance_overview()
 RETURNS TABLE(tenant_id uuid, tenant_name text, currency text, health_score integer, total_balance numeric, net_flow_30d numeric, receivables numeric, payables numeric, active_alerts_count integer, critical_alerts_count integer, last_activity_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    (SELECT MAX(ft.posted_at) FROM public.financial_transactions ft WHERE ft.tenant_id = t.id)
  FROM public.tenants t
  ORDER BY t.name;
END;
$function$;