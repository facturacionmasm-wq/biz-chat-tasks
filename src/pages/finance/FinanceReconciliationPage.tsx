import { useMemo, useState } from 'react';
import { useReconciliationSuggestions, useConfirmMatch, useRejectMatch, useMarkDuplicate } from '@/hooks/useFinance';
import type { MatchSuggestion } from '@/lib/finance/reconciliation';
import { GitCompare, CheckCircle2, XCircle, Copy, Sparkles, Loader2 } from 'lucide-react';
import ReportExportMenu from '@/components/finance/ReportExportMenu';

const fmt = (n: number, currency = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);

function ScorePill({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = score >= 0.85 ? 'bg-emerald-500/15 text-emerald-500'
    : score >= 0.6 ? 'bg-sky-500/15 text-sky-500'
    : 'bg-amber-500/15 text-amber-500';
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${color}`}>{pct}%</span>;
}

export default function FinanceReconciliationPage() {
  const [lookback, setLookback] = useState<30 | 60 | 90>(60);
  const q = useReconciliationSuggestions(lookback);
  const confirmMut = useConfirmMatch();
  const rejectMut = useRejectMatch();
  const dupMut = useMarkDuplicate();

  const suggestions = (q.data ?? []) as MatchSuggestion[];

  const grouped = useMemo(() => {
    const auto: MatchSuggestion[] = [];
    const manual: MatchSuggestion[] = [];
    const unmatched: MatchSuggestion[] = [];
    for (const s of suggestions) {
      if (s.suggested_status === 'auto_matched') auto.push(s);
      else if (s.suggested_status === 'suggested') manual.push(s);
      else unmatched.push(s);
    }
    return { auto, manual, unmatched };
  }, [suggestions]);

  const buildExport = () => {
    const rows = suggestions.map((s) => ({
      transaccion_id: s.transaction_id,
      gasto_id: s.expense_id ?? '',
      fecha_tx: s.tx_date,
      descripcion_tx: s.tx_description ?? '',
      monto_tx: s.tx_amount,
      fecha_gasto: s.exp_date ?? '',
      descripcion_gasto: s.exp_description ?? '',
      monto_gasto: s.exp_amount ?? 0,
      delta_monto: s.amount_delta,
      delta_dias: s.day_delta,
      similitud_desc: s.desc_similarity,
      score: s.score,
      estado: s.suggested_status,
    }));
    return {
      title: 'Reporte de conciliación',
      period: `Últimos ${lookback} días`,
      currency: 'MXN',
      csvFilename: `conciliacion-${new Date().toISOString().slice(0, 10)}.csv`,
      pdfFilename: `conciliacion-${new Date().toISOString().slice(0, 10)}.pdf`,
      csvRows: rows,
      sections: [{
        title: `Sugerencias (${suggestions.length})`,
        columns: ['Fecha Tx', 'Descripción Tx', 'Monto Tx', 'Fecha Gasto', 'Monto Gasto', 'Score', 'Estado'],
        rows: suggestions.map((s) => [
          s.tx_date,
          (s.tx_description ?? '').slice(0, 30),
          fmt(s.tx_amount),
          s.exp_date ?? '—',
          fmt(s.exp_amount ?? 0),
          `${Math.round(s.score * 100)}%`,
          s.suggested_status,
        ]),
        summary: [
          { label: 'Auto-conciliadas', value: String(grouped.auto.length) },
          { label: 'Sugeridas', value: String(grouped.manual.length) },
          { label: 'Sin coincidencia', value: String(grouped.unmatched.length) },
        ],
      }],
    };
  };

  const Row = ({ s, allowActions = true }: { s: MatchSuggestion; allowActions?: boolean }) => (
    <li className="rounded-xl border border-border bg-[var(--rx-s2)]/30 p-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Transacción bancaria</div>
          <div className="text-sm font-semibold">{fmt(s.tx_amount)}</div>
          <div className="text-xs text-muted-foreground">{s.tx_date}</div>
          <div className="text-xs mt-1">{s.tx_description ?? '—'}</div>
        </div>
        {s.expense_id ? (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-2">
              Gasto candidato <ScorePill score={s.score} />
            </div>
            <div className="text-sm font-semibold">{fmt(s.exp_amount)}</div>
            <div className="text-xs text-muted-foreground">
              {s.exp_date} · Δ ${s.amount_delta.toFixed(2)} · {s.day_delta}d · sim {(s.desc_similarity * 100).toFixed(0)}%
            </div>
            <div className="text-xs mt-1">{s.exp_description ?? '—'}</div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic self-center">Sin candidato en gastos</div>
        )}
      </div>
      {allowActions && s.expense_id && (
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            onClick={() => confirmMut.mutate({ ...s, mode: 'manual_matched' })}
            disabled={confirmMut.isPending}
            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 font-medium"
          >
            <CheckCircle2 size={12} /> Confirmar
          </button>
          <button
            onClick={() => rejectMut.mutate(s.transaction_id)}
            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-500 hover:bg-rose-500/25 font-medium"
          >
            <XCircle size={12} /> Rechazar
          </button>
          <button
            onClick={() => dupMut.mutate(s.transaction_id)}
            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 font-medium"
          >
            <Copy size={12} /> Duplicada
          </button>
        </div>
      )}
    </li>
  );

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <GitCompare size={16} /> Conciliación de transacciones vs gastos
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Sugerencias automáticas por monto, fecha y descripción. Score ≥ 85% → auto-conciliadas.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={lookback}
              onChange={(e) => setLookback(Number(e.target.value) as 30 | 60 | 90)}
              className="text-xs px-2.5 py-1.5 rounded-xl bg-[var(--rx-s2)] border border-border"
            >
              <option value={30}>30 días</option>
              <option value={60}>60 días</option>
              <option value={90}>90 días</option>
            </select>
            <ReportExportMenu build={buildExport} />
          </div>
        </div>
      </div>

      {q.isLoading ? (
        <div className="text-center py-6 text-xs text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Analizando…
        </div>
      ) : suggestions.length === 0 ? (
        <div className="rounded-2xl bg-card border border-border p-8 text-center shadow-soft">
          <Sparkles size={28} className="mx-auto text-muted-foreground mb-2" />
          <div className="text-sm">Todo conciliado en este periodo.</div>
        </div>
      ) : (
        <>
          {grouped.auto.length > 0 && (
            <section>
              <div className="text-xs font-semibold text-emerald-500 mb-2">
                Auto-conciliadas ({grouped.auto.length}) · score ≥ 85%
              </div>
              <ul className="space-y-2">{grouped.auto.map((s) => <Row key={s.transaction_id} s={s} />)}</ul>
            </section>
          )}
          {grouped.manual.length > 0 && (
            <section>
              <div className="text-xs font-semibold text-sky-500 mb-2 mt-3">
                Requieren revisión ({grouped.manual.length})
              </div>
              <ul className="space-y-2">{grouped.manual.map((s) => <Row key={s.transaction_id} s={s} />)}</ul>
            </section>
          )}
          {grouped.unmatched.length > 0 && (
            <section>
              <div className="text-xs font-semibold text-muted-foreground mb-2 mt-3">
                Sin coincidencia ({grouped.unmatched.length})
              </div>
              <ul className="space-y-2">{grouped.unmatched.map((s) => <Row key={s.transaction_id} s={s} allowActions={false} />)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
