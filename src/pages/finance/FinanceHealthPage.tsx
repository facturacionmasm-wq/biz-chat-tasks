import { useHealthScore } from '@/hooks/useFinance';
import { Activity } from 'lucide-react';

function Bar({ label, value, max = 25 }: { label: string; value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = pct >= 70 ? 'var(--rx-emerald)' : pct >= 40 ? 'var(--rx-amber)' : 'var(--rx-rose)';
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{value}/{max}</span>
      </div>
      <div className="h-2 rounded-full bg-[var(--rx-s2)] overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export default function FinanceHealthPage() {
  const q = useHealthScore();
  const h = q.data;
  const score = h?.score ?? 0;
  const color = score >= 75 ? 'var(--rx-emerald)' : score >= 50 ? 'var(--rx-amber)' : 'var(--rx-rose)';

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-card border border-border p-6 shadow-soft text-center">
        <div className="flex items-center justify-center gap-2 text-muted-foreground mb-3">
          <Activity size={16} />
          <span className="text-xs uppercase tracking-wide font-medium">Financial Health Score</span>
        </div>
        <div className="text-6xl font-bold" style={{ color }}>{score}</div>
        <div className="text-xs text-muted-foreground mt-1">de 100</div>
      </div>

      <div className="rounded-2xl bg-card border border-border p-5 shadow-soft space-y-4">
        <Bar label="Liquidez" value={h?.liquidity_score ?? 0} />
        <Bar label="Flujo de caja" value={h?.cashflow_score ?? 0} />
        <Bar label="Morosidad" value={h?.delinquency_score ?? 0} />
        <Bar label="Cumplimiento de presupuesto" value={h?.budget_score ?? 0} />
      </div>

      {h?.breakdown && (
        <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
          <h3 className="text-sm font-semibold mb-2">Detalle</h3>
          <pre className="text-[11px] text-muted-foreground overflow-x-auto">
{JSON.stringify(h.breakdown, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
