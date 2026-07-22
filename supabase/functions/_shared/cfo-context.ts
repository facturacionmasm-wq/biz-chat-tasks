// Shared CFO AI context builder (extracted so both cfo-ai and the weekly briefing
// use the same aggregated, tenant-scoped snapshot).
// deno-lint-ignore-file no-explicit-any

export async function buildFinancialContext(admin: any, tenantId: string) {
  const [summary, health, accountsRes, alertsRes, budgetsRes, topExpensesRes] = await Promise.all([
    admin.rpc('compute_tenant_financial_summary', { _tenant_id: tenantId }),
    admin.rpc('compute_tenant_health_score', { _tenant_id: tenantId }),
    admin.from('financial_accounts')
      .select('name, currency, current_balance, status')
      .eq('tenant_id', tenantId).eq('is_hidden', false).limit(20),
    admin.from('financial_alerts')
      .select('alert_type, severity, message')
      .eq('tenant_id', tenantId).eq('status', 'active').limit(10),
    admin.from('financial_budgets')
      .select('name, period_start, period_end, total_planned, currency')
      .eq('tenant_id', tenantId).limit(10),
    admin.from('expenses')
      .select('description, amount, expense_date, category_id')
      .eq('tenant_id', tenantId)
      .gte('expense_date', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10))
      .order('amount', { ascending: false })
      .limit(5),
  ]);
  return {
    summary: summary.data ?? {},
    health: health.data ?? {},
    accounts: accountsRes.data ?? [],
    active_alerts: alertsRes.data ?? [],
    budgets: budgetsRes.data ?? [],
    top_expenses_week: topExpensesRes.data ?? [],
  };
}
