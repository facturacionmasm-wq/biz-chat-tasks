import { useCashflowForecast } from '@/hooks/useFinance';
import { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { SCENARIO_PRESETS, type ScenarioKey } from '@/lib/finance/cashflow';
import ReportExportMenu from '@/components/finance/ReportExportMenu';
import { Sliders } from 'lucide-react';

const fmt = (n: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n);

export default function FinanceCashflowPage() {
  const [horizon, setHorizon] = useState<7 | 30 | 60 | 90>(30);
  const [scenario, setScenario] = useState<ScenarioKey>('base');
  const [customRev, setCustomRev] = useState(0);
  const [customExp, setCustomExp] = useState(0);
  const [customDelay, setCustomDelay] = useState(0);

  const assumptions = useMemo(() => {
    if (scenario === 'custom') {
      return {
        revenueDelta: customRev / 100,
        expenseDelta: customExp / 100,
        collectionDelayDays: customDelay,
      };
    }
    return SCENARIO_PRESETS[scenario];
  }, [scenario, customRev, customExp, customDelay]);

  const base = useCashflowForecast(horizon, SCENARIO_PRESETS.base);
  const conservative = useCashflowForecast(horizon, SCENARIO_PRESETS.conservative);
  const optimistic = useCashflowForecast(horizon, SCENARIO_PRESETS.optimistic);
  const active = useCashflowForecast(horizon, assumptions);

  const chartData = useMemo(() => {
    const b = base.data ?? [];
    return b.map((point, i) => ({
      date: point.date,
      base: point.projectedBalance,
      conservador: conservative.data?.[i]?.projectedBalance ?? null,
      optimista: optimistic.data?.[i]?.projectedBalance ?? null,
      escenario: scenario === 'custom' ? active.data?.[i]?.projectedBalance ?? null : null,
    }));
  }, [base.data, conservative.data, optimistic.data, active.data, scenario]);

  const buildExport = () => {
    const rows = (active.data ?? []).map((p) => ({
      fecha: p.date,
      ingreso_diario: p.inflow,
      egreso_diario: p.outflow,
      saldo_proyectado: p.projectedBalance,
    }));
    return {
      title: `Pronóstico de flujo de efectivo (${horizon}d, escenario: ${scenario})`,
      period: `${horizon} días`,
      currency: 'MXN',
      csvFilename: `cashflow-${scenario}-${horizon}d.csv`,
      pdfFilename: `cashflow-${scenario}-${horizon}d.pdf`,
      csvRows: rows,
      sections: [{
        title: `Escenario ${scenario}`,
        columns: ['Fecha', 'Ingreso diario', 'Egreso diario', 'Saldo proyectado'],
        rows: rows.map((r) => [r.fecha, fmt(r.ingreso_diario), fmt(r.egreso_diario), fmt(r.saldo_proyectado)]),
        summary: [
          { label: 'Ajuste ingresos', value: `${((assumptions.revenueDelta ?? 0) * 100).toFixed(0)}%` },
          { label: 'Ajuste egresos', value: `${((assumptions.expenseDelta ?? 0) * 100).toFixed(0)}%` },
          { label: 'Retraso cobranza', value: `${assumptions.collectionDelayDays ?? 0} días` },
        ],
      }],
    };
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-card border border-border p-3 shadow-soft flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground mr-2">Horizonte:</span>
          {([7, 30, 60, 90] as const).map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={`text-xs px-3 py-1.5 rounded-xl font-medium ${
                horizon === h ? 'bg-[var(--rx-brand)] text-[var(--rx-brand-foreground,white)]' : 'bg-[var(--rx-s2)] text-[var(--rx-t2)]'
              }`}
            >
              {h}d
            </button>
          ))}
        </div>
        <ReportExportMenu build={buildExport} />
      </div>

      <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
        <div className="flex items-center gap-2 mb-3">
          <Sliders size={14} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold">Escenarios What-If</h3>
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {(['conservative', 'base', 'optimistic', 'custom'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setScenario(k)}
              className={`text-xs px-3 py-1.5 rounded-xl font-medium capitalize ${
                scenario === k ? 'bg-[var(--rx-brand)] text-[var(--rx-brand-foreground,white)]' : 'bg-[var(--rx-s2)] text-[var(--rx-t2)]'
              }`}
            >
              {k === 'conservative' ? 'Conservador' : k === 'optimistic' ? 'Optimista' : k === 'base' ? 'Base' : 'Personalizado'}
            </button>
          ))}
        </div>

        {scenario === 'custom' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2 p-3 rounded-xl bg-[var(--rx-s2)]/40">
            <div>
              <label className="text-[11px] text-muted-foreground flex items-center justify-between">
                <span>Ingresos</span>
                <span className="font-semibold text-foreground">{customRev >= 0 ? '+' : ''}{customRev}%</span>
              </label>
              <input type="range" min={-50} max={50} step={5} value={customRev}
                onChange={(e) => setCustomRev(Number(e.target.value))} className="w-full mt-1 accent-[var(--rx-brand)]" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground flex items-center justify-between">
                <span>Egresos</span>
                <span className="font-semibold text-foreground">{customExp >= 0 ? '+' : ''}{customExp}%</span>
              </label>
              <input type="range" min={-50} max={50} step={5} value={customExp}
                onChange={(e) => setCustomExp(Number(e.target.value))} className="w-full mt-1 accent-[var(--rx-brand)]" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground flex items-center justify-between">
                <span>Retraso cobranza</span>
                <span className="font-semibold text-foreground">{customDelay}d</span>
              </label>
              <input type="range" min={-15} max={30} step={1} value={customDelay}
                onChange={(e) => setCustomDelay(Number(e.target.value))} className="w-full mt-1 accent-[var(--rx-brand)]" />
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
        <h3 className="text-sm font-semibold mb-3">Saldo proyectado — comparativo</h3>
        <div style={{ width: '100%', height: 340 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--rx-b1)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--rx-t3)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--rx-t3)' }} />
              <Tooltip contentStyle={{ background: 'var(--rx-s1)', border: '1px solid var(--rx-b2)', borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="conservador" stroke="var(--rx-rose)" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="base" stroke="var(--rx-brand)" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="optimista" stroke="var(--rx-emerald)" strokeWidth={1.5} dot={false} />
              {scenario === 'custom' && (
                <Line type="monotone" dataKey="escenario" stroke="var(--rx-amber)" strokeWidth={2.5} strokeDasharray="5 3" dot={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Los escenarios ajustan los promedios de ingresos/egresos y el retraso de cobranza sobre las cuentas por cobrar programadas.
        </p>
      </div>
    </div>
  );
}
