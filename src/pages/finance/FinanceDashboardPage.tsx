import { useFinancialSummary, useHealthScore, useFinancialAlerts } from '@/hooks/useFinance';
import { AlertTriangle, Wallet, TrendingUp, TrendingDown, Activity, Clock } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useCashflowForecast } from '@/hooks/useFinance';
import ReportExportMenu from '@/components/finance/ReportExportMenu';

const fmt = (n: number | string | null | undefined, currency = 'MXN') =>
  n == null ? 'N/D' : new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(n));

function Card({ icon: Icon, label, value, sub, color = 'var(--rx-brand)' }: { icon: React.ElementType; label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}18` }}>
          <Icon size={16} style={{ color }} />
        </div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="text-xl font-bold text-foreground">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export default function FinanceDashboardPage() {
  const summary = useFinancialSummary(30);
  const health = useHealthScore();
  const alerts = useFinancialAlerts();
  const cashflow = useCashflowForecast(30);

  const s = (summary.data ?? {}) as Record<string, number | string | null>;
  const currency = (s.currency as string) ?? 'MXN';

  const buildExport = () => {
    const rows = [
      { concepto: 'Saldo consolidado', valor: Number(s.total_balance ?? 0) },
      { concepto: 'Ingresos 30d', valor: Number(s.inflows ?? 0) },
      { concepto: 'Egresos 30d', valor: Number(s.outflows ?? 0) },
      { concepto: 'Flujo neto 30d', valor: Number(s.net_flow ?? 0) },
      { concepto: 'Cuentas por cobrar', valor: Number(s.receivables ?? 0) },
      { concepto: 'Cuentas por pagar', valor: Number(s.payables ?? 0) },
      { concepto: 'Runway (días)', valor: Number(s.runway_days ?? 0) },
      { concepto: 'Health Score', valor: health.data?.score ?? 0 },
    ];
    return {
      title: 'Resumen financiero',
      period: 'Últimos 30 días',
      currency,
      csvFilename: `resumen-financiero-${new Date().toISOString().slice(0, 10)}.csv`,
      pdfFilename: `resumen-financiero-${new Date().toISOString().slice(0, 10)}.pdf`,
      csvRows: rows,
      sections: [{
        title: 'Indicadores clave',
        columns: ['Concepto', 'Valor'],
        rows: rows.map((r) => [r.concepto, fmt(r.valor, currency)]),
      }, {
        title: 'Alertas activas',
        columns: ['Tipo', 'Severidad', 'Mensaje'],
        rows: ((alerts.data ?? []) as { alert_type: string; severity: string; message: string }[])
          .map((a) => [a.alert_type, a.severity, a.message]),
      }],
    };
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end -mt-2">
        <ReportExportMenu build={buildExport} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card icon={Wallet} label="Saldo consolidado" value={fmt(s.total_balance, currency)} />
        <Card icon={TrendingUp} label="Ingresos 30d" value={fmt(s.inflows, currency)} color="var(--rx-emerald)" />
        <Card icon={TrendingDown} label="Egresos 30d" value={fmt(s.outflows, currency)} color="var(--rx-rose)" />
        <Card icon={Activity} label="Flujo neto 30d" value={fmt(s.net_flow, currency)} color="var(--rx-sky)" />
        <Card icon={Clock} label="Cuentas por cobrar" value={fmt(s.receivables, currency)} color="var(--rx-amber)" />
        <Card icon={Clock} label="Cuentas por pagar" value={fmt(s.payables, currency)} color="var(--rx-violet)" />
        <Card icon={Activity} label="Runway estimado" value={s.runway_days != null ? `${s.runway_days} días` : 'N/D'} color="var(--rx-sky)" />
        <Card
          icon={Activity}
          label="Health Score"
          value={health.data ? `${health.data.score}/100` : '—'}
          sub={health.data ? `Liq ${health.data.liquidity_score} · Flujo ${health.data.cashflow_score}` : undefined}
          color="var(--rx-emerald)"
        />
      </div>

      <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Pronóstico de flujo 30 días</h3>
          <span className="text-[11px] text-muted-foreground">Simulación basada en promedio histórico</span>
        </div>
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <LineChart data={cashflow.data ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--rx-b1)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--rx-t3)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--rx-t3)' }} />
              <Tooltip contentStyle={{ background: 'var(--rx-s1)', border: '1px solid var(--rx-b2)', borderRadius: 8, fontSize: 12 }} />
              <Line type="monotone" dataKey="projectedBalance" stroke="var(--rx-brand)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
        <h3 className="text-sm font-semibold mb-3">Alertas activas</h3>
        {alerts.isLoading ? (
          <div className="text-xs text-muted-foreground">Cargando…</div>
        ) : (alerts.data ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground">Sin alertas activas.</div>
        ) : (
          <ul className="space-y-2">
            {(alerts.data ?? []).map((a: { id: string; alert_type: string; severity: string; message: string }) => (
              <li key={a.id} className="flex items-start gap-2 text-xs">
                <AlertTriangle size={14} className="text-[var(--rx-amber)] mt-0.5" />
                <div>
                  <div className="font-medium">{a.message}</div>
                  <div className="text-muted-foreground">{a.alert_type} · {a.severity}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
