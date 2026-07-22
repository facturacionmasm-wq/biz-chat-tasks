import { useBudgets } from '@/hooks/useFinance';
import { PiggyBank } from 'lucide-react';
import ReportExportMenu from '@/components/finance/ReportExportMenu';

const fmt = (n: number, currency = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

export default function FinanceBudgetsPage() {
  const q = useBudgets();
  const data = (q.data ?? []) as Array<{
    id: string; name: string; period_start: string; period_end: string;
    total_planned: number; currency: string;
    financial_budget_lines?: Array<{ id: string; category_name: string; planned_amount: number }>;
  }>;

  const buildExport = () => {
    const rows: Array<Record<string, unknown>> = [];
    for (const b of data) {
      for (const l of b.financial_budget_lines ?? []) {
        rows.push({
          presupuesto: b.name, periodo: `${b.period_start}→${b.period_end}`,
          categoria: l.category_name, monto_planeado: Number(l.planned_amount), moneda: b.currency,
        });
      }
    }
    return {
      title: 'Presupuestos',
      period: 'Todos los periodos',
      currency: data[0]?.currency ?? 'MXN',
      csvFilename: `presupuestos-${new Date().toISOString().slice(0, 10)}.csv`,
      pdfFilename: `presupuestos-${new Date().toISOString().slice(0, 10)}.pdf`,
      csvRows: rows,
      sections: data.map((b) => ({
        title: `${b.name} · ${b.period_start} → ${b.period_end}`,
        columns: ['Categoría', 'Planeado'],
        rows: (b.financial_budget_lines ?? []).map((l) => [l.category_name, fmt(Number(l.planned_amount), b.currency)]),
        summary: [{ label: 'Total planeado', value: fmt(Number(b.total_planned), b.currency) }],
      })),
    };
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ReportExportMenu build={buildExport} disabled={data.length === 0} />
      </div>
      <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
        <h3 className="text-sm font-semibold mb-1">Presupuestos</h3>
        <p className="text-xs text-muted-foreground">
          En Fase 1 los presupuestos se administran con datos manuales/demo. El editor rico y la comparación automática real vs presupuestado quedan como <b>Próximamente</b>.
        </p>
      </div>

      {q.isLoading ? (
        <div className="text-xs text-muted-foreground text-center py-6">Cargando…</div>
      ) : data.length === 0 ? (
        <div className="rounded-2xl bg-card border border-border p-8 shadow-soft text-center">
          <PiggyBank size={28} className="mx-auto text-muted-foreground mb-2" />
          <div className="text-sm">Aún no hay presupuestos.</div>
          <div className="text-xs text-muted-foreground mt-1">La creación desde UI llega en la siguiente fase.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((b) => (
            <div key={b.id} className="rounded-2xl bg-card border border-border p-4 shadow-soft">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold">{b.name}</div>
                  <div className="text-[11px] text-muted-foreground">{b.period_start} → {b.period_end}</div>
                </div>
                <div className="text-lg font-bold">{fmt(Number(b.total_planned), b.currency)}</div>
              </div>
              <ul className="mt-3 space-y-1">
                {(b.financial_budget_lines ?? []).map((l) => (
                  <li key={l.id} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{l.category_name}</span>
                    <span className="font-medium">{fmt(Number(l.planned_amount), b.currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
