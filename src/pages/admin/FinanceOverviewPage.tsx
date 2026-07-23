import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, ShieldAlert, TrendingUp, TrendingDown, AlertTriangle, Activity } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { useIsDesktop } from '@/hooks/useMediaQuery';


interface Row {
  tenant_id: string;
  tenant_name: string;
  currency: string;
  health_score: number;
  total_balance: number;
  net_flow_30d: number;
  receivables: number;
  payables: number;
  active_alerts_count: number;
  critical_alerts_count: number;
  last_activity_at: string | null;
}

const fmt = (n: number, ccy = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: ccy, maximumFractionDigits: 0 }).format(Number(n) || 0);

export default function FinanceOverviewPage() {
  const isDesktop = useIsDesktop();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.rpc as any)('admin_finance_overview');
        if (aborted) return;
        if (error) throw error;
        setRows((data ?? []) as Row[]);
      } catch (e) {
        if (!aborted) setError((e as Error).message);
      }
    })();
    return () => { aborted = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => r.tenant_name?.toLowerCase().includes(needle));
  }, [rows, q]);

  const totals = useMemo(() => {
    const source = filtered ?? [];
    return source.reduce(
      (acc, r) => ({
        balance: acc.balance + Number(r.total_balance || 0),
        net: acc.net + Number(r.net_flow_30d || 0),
        rec: acc.rec + Number(r.receivables || 0),
        pay: acc.pay + Number(r.payables || 0),
        alerts: acc.alerts + Number(r.active_alerts_count || 0),
        critical: acc.critical + Number(r.critical_alerts_count || 0),
      }),
      { balance: 0, net: 0, rec: 0, pay: 0, alerts: 0, critical: 0 },
    );
  }, [filtered]);

  return (
    <div className="min-h-screen pb-24 px-4 pt-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldAlert className="text-[var(--rx-brand)]" size={22} /> Vista financiera consolidada
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Métricas agregadas por tenant. Nunca se muestra detalle transaccional cruzado. Solo super_admin.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 text-destructive text-xs p-3">
          {error}
        </div>
      )}

      {!rows && !error && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Cargando…
        </div>
      )}

      {rows && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <KpiCard label="Saldo total" value={fmt(totals.balance)} icon={<Activity size={14} />} />
            <KpiCard label="Flujo neto 30d" value={fmt(totals.net)} icon={<TrendingUp size={14} />} />
            <KpiCard label="Por cobrar" value={fmt(totals.rec)} icon={<TrendingUp size={14} />} />
            <KpiCard label="Por pagar" value={fmt(totals.pay)} icon={<TrendingDown size={14} />} />
            <KpiCard label="Alertas activas" value={String(totals.alerts)} icon={<AlertTriangle size={14} />} />
            <KpiCard label="Críticas" value={String(totals.critical)} icon={<AlertTriangle size={14} className="text-destructive" />} />
          </div>

          <Input
            placeholder="Buscar tenant…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs"
          />

          {isDesktop ? (
            <div className="rounded-2xl border border-border bg-card overflow-x-auto shadow-soft">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="p-2 font-semibold">Tenant</th>
                    <th className="p-2 font-semibold text-right">Health</th>
                    <th className="p-2 font-semibold text-right">Saldo</th>
                    <th className="p-2 font-semibold text-right">Flujo 30d</th>
                    <th className="p-2 font-semibold text-right">Por cobrar</th>
                    <th className="p-2 font-semibold text-right">Por pagar</th>
                    <th className="p-2 font-semibold text-center">Alertas</th>
                    <th className="p-2 font-semibold">Última actividad</th>
                  </tr>
                </thead>
                <tbody>
                  {(filtered ?? []).map((r) => (
                    <tr key={r.tenant_id} className="border-t border-border">
                      <td className="p-2 font-medium">{r.tenant_name}</td>
                      <td className="p-2 text-right">
                        <span className={`inline-block px-1.5 py-0.5 rounded-md ${scoreClass(r.health_score)}`}>
                          {r.health_score}
                        </span>
                      </td>
                      <td className="p-2 text-right">{fmt(r.total_balance, r.currency)}</td>
                      <td className={`p-2 text-right ${r.net_flow_30d < 0 ? 'text-destructive' : ''}`}>
                        {fmt(r.net_flow_30d, r.currency)}
                      </td>
                      <td className="p-2 text-right">{fmt(r.receivables, r.currency)}</td>
                      <td className="p-2 text-right">{fmt(r.payables, r.currency)}</td>
                      <td className="p-2 text-center">
                        {r.active_alerts_count > 0 && (
                          <span className={`inline-block px-1.5 py-0.5 rounded-md text-[10px] ${r.critical_alerts_count > 0 ? 'bg-destructive/20 text-destructive' : 'bg-amber-500/20 text-amber-700 dark:text-amber-400'}`}>
                            {r.active_alerts_count} {r.critical_alerts_count > 0 && `(${r.critical_alerts_count} crit)`}
                          </span>
                        )}
                        {r.active_alerts_count === 0 && <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {r.last_activity_at
                          ? formatDistanceToNow(new Date(r.last_activity_at), { addSuffix: true, locale: es })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                  {(filtered ?? []).length === 0 && (
                    <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Sin datos</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-2">
              {(filtered ?? []).length === 0 ? (
                <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-soft">Sin datos</div>
              ) : (
                (filtered ?? []).map((r) => (
                  <div key={r.tenant_id} className="rounded-2xl border border-border bg-card p-3 shadow-soft space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate">{r.tenant_name}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {r.last_activity_at
                            ? formatDistanceToNow(new Date(r.last_activity_at), { addSuffix: true, locale: es })
                            : 'Sin actividad'}
                        </div>
                      </div>
                      <span className={`shrink-0 text-xs px-2 py-0.5 rounded-md ${scoreClass(r.health_score)}`}>
                        Health {r.health_score}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-border">
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">Saldo</div>
                        <div className="font-semibold">{fmt(r.total_balance, r.currency)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">Flujo 30d</div>
                        <div className={`font-semibold ${r.net_flow_30d < 0 ? 'text-destructive' : ''}`}>{fmt(r.net_flow_30d, r.currency)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">Por cobrar</div>
                        <div className="font-semibold">{fmt(r.receivables, r.currency)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">Por pagar</div>
                        <div className="font-semibold">{fmt(r.payables, r.currency)}</div>
                      </div>
                    </div>
                    {r.active_alerts_count > 0 && (
                      <div className={`text-[11px] rounded-md px-2 py-1 ${r.critical_alerts_count > 0 ? 'bg-destructive/15 text-destructive' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'}`}>
                        <AlertTriangle size={12} className="inline mr-1" />
                        {r.active_alerts_count} alerta(s){r.critical_alerts_count > 0 ? ` · ${r.critical_alerts_count} crítica(s)` : ''}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-card border border-border p-3 shadow-soft">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {icon} {label}
      </div>
      <div className="text-sm font-semibold mt-1 truncate">{value}</div>
    </div>
  );
}

function scoreClass(score: number): string {
  if (score >= 75) return 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400';
  if (score >= 50) return 'bg-amber-500/20 text-amber-700 dark:text-amber-400';
  return 'bg-destructive/20 text-destructive';
}
