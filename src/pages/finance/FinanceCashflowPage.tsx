import { useCashflowForecast } from '@/hooks/useFinance';
import { useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

export default function FinanceCashflowPage() {
  const [horizon, setHorizon] = useState<7 | 30 | 60 | 90>(30);
  const q = useCashflowForecast(horizon);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-card border border-border p-3 shadow-soft flex items-center gap-2">
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

      <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
        <h3 className="text-sm font-semibold mb-3">Saldo proyectado</h3>
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <AreaChart data={q.data ?? []}>
              <defs>
                <linearGradient id="cfArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--rx-brand)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--rx-brand)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--rx-b1)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--rx-t3)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--rx-t3)' }} />
              <Tooltip contentStyle={{ background: 'var(--rx-s1)', border: '1px solid var(--rx-b2)', borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="projectedBalance" stroke="var(--rx-brand)" strokeWidth={2} fill="url(#cfArea)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Cálculo simple Fase 1: saldo actual + promedio diario de ingresos/egresos históricos. Escenarios what-if llegan en fase futura.
        </p>
      </div>
    </div>
  );
}
