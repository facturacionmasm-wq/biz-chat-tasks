// Fase 4 · Cron scan: genera alertas financieras proactivas por tenant.
// Invocado por pg_cron cada 30 min. Autenticación por header x-cron-secret.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { notifyTenantAdmin } from '../_shared/notify-admin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

type Sev = 'low' | 'medium' | 'high' | 'critical';

interface AlertDraft {
  alert_type: string;
  severity: Sev;
  message: string;
  metadata?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const shared = Deno.env.get('CRON_SHARED_SECRET');
  const provided = req.headers.get('x-cron-secret');
  if (!shared || provided !== shared) {
    return json({ error: 'unauthorized' }, 401);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: tenants, error: tErr } = await admin
    .from('tenants')
    .select('id, name');
  if (tErr) return json({ error: tErr.message }, 500);

  const results: Array<{ tenant_id: string; inserted: number; skipped: number; errors: string[] }> = [];

  for (const t of tenants ?? []) {
    const tenantId = t.id as string;
    const errs: string[] = [];
    const drafts: AlertDraft[] = [];

    try {
      // 1) Runway / summary
      const { data: sum } = await admin.rpc('compute_tenant_financial_summary', { _tenant_id: tenantId });
      const s: any = sum ?? {};
      if (typeof s.runway_days === 'number' && s.runway_days < 30) {
        drafts.push({
          alert_type: 'low_runway',
          severity: 'high',
          message: `Runway estimado: ${s.runway_days} días. Revisa flujo de caja urgente.`,
          metadata: { runway_days: s.runway_days, balance: s.total_balance, monthly_burn: s.monthly_burn },
        });
      }

      // 2) Overdrafts
      const { data: accts } = await admin
        .from('financial_accounts')
        .select('id, name, current_balance, currency')
        .eq('tenant_id', tenantId).eq('is_hidden', false);
      for (const a of accts ?? []) {
        if (typeof a.current_balance === 'number' && a.current_balance < 0) {
          drafts.push({
            alert_type: 'overdraft',
            severity: 'critical',
            message: `Cuenta "${a.name}" en sobregiro: ${a.current_balance} ${a.currency ?? ''}`.trim(),
            metadata: { account_id: a.id, balance: a.current_balance },
          });
        }
      }

      // 3) Budget overrun (>90% consumido)
      const { data: budgets } = await admin
        .from('financial_budgets')
        .select('id, name, total_planned, period_start, period_end')
        .eq('tenant_id', tenantId);
      for (const b of budgets ?? []) {
        if (!b.total_planned || Number(b.total_planned) <= 0) continue;
        const { data: exps } = await admin
          .from('expenses')
          .select('amount')
          .eq('tenant_id', tenantId)
          .gte('expense_date', b.period_start)
          .lte('expense_date', b.period_end);
        const spent = (exps ?? []).reduce((acc: number, r: any) => acc + Number(r.amount ?? 0), 0);
        const ratio = spent / Number(b.total_planned);
        if (ratio > 0.9) {
          drafts.push({
            alert_type: 'budget_overrun',
            severity: ratio > 1 ? 'high' : 'medium',
            message: `Presupuesto "${b.name}" al ${(ratio * 100).toFixed(0)}% (${spent.toFixed(0)} de ${b.total_planned}).`,
            metadata: { budget_id: b.id, spent, planned: b.total_planned, ratio },
          });
        }
      }

      // 4) Overdue payables
      const { data: overdue } = await admin
        .from('expenses')
        .select('id, amount, expense_date')
        .eq('tenant_id', tenantId)
        .is('paid_at', null)
        .lt('expense_date', new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
      if (overdue && overdue.length) {
        const total = overdue.reduce((acc: number, r: any) => acc + Number(r.amount ?? 0), 0);
        drafts.push({
          alert_type: 'overdue_payable',
          severity: 'medium',
          message: `${overdue.length} gasto(s) vencido(s) sin pagar. Total: ${total.toFixed(0)}.`,
          metadata: { count: overdue.length, total },
        });
      }
    } catch (e) {
      errs.push(`compute: ${(e as Error).message}`);
    }

    // Dedupe: si ya existe una activa del mismo tipo en las últimas 24h, saltar.
    let inserted = 0, skipped = 0;
    for (const d of drafts) {
      try {
        const { data: dupe } = await admin
          .from('financial_alerts')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('alert_type', d.alert_type)
          .eq('status', 'active')
          .gte('created_at', new Date(Date.now() - 86400_000).toISOString())
          .limit(1)
          .maybeSingle();
        if (dupe?.id) { skipped++; continue; }
        const { error: insErr } = await admin.from('financial_alerts').insert({
          tenant_id: tenantId,
          alert_type: d.alert_type,
          severity: d.severity,
          message: d.message,
          status: 'active',
          metadata: d.metadata ?? {},
        });
        if (insErr) { errs.push(`insert_${d.alert_type}: ${insErr.message}`); continue; }
        inserted++;

        // Notify admin (best-effort) on critical / high
        if (d.severity === 'critical' || d.severity === 'high') {
          try {
            await notifyTenantAdmin(admin, {
              tenantId,
              subject: `[Alerta financiera] ${d.alert_type} (${d.severity})`,
              body: d.message,
              eventType: 'financial_alert',
            });
          } catch (e) {
            errs.push(`notify_${d.alert_type}: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        errs.push(`draft_${d.alert_type}: ${(e as Error).message}`);
      }
    }

    results.push({ tenant_id: tenantId, inserted, skipped, errors: errs });
  }

  return json({ ok: true, scanned: results.length, results });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
