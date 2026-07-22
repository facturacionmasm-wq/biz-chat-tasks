import { useMemo, useState } from 'react';
import { PiggyBank, Plus, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import {
  useBudgets,
  useBudgetActuals,
  useDeleteBudget,
  useFinancialAlerts,
  type BudgetActualLine,
} from '@/hooks/useFinance';
import BudgetEditor from '@/components/finance/BudgetEditor';
import ReportExportMenu from '@/components/finance/ReportExportMenu';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from 'recharts';

const fmt = (n: number, currency = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    Number(n) || 0,
  );

const statusColor = (s: BudgetActualLine['status']) => {
  switch (s) {
    case 'over':
      return 'bg-destructive/10 text-destructive border-destructive/30';
    case 'warning':
      return 'bg-amber-500/10 text-amber-500 border-amber-500/30';
    case 'watch':
      return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30';
    default:
      return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30';
  }
};
const statusLabel = (s: BudgetActualLine['status']) =>
  ({ over: 'Excedido', warning: 'Alerta', watch: 'Observación', ok: 'En rango' })[s];

type BudgetRow = {
  id: string;
  name: string;
  period_start: string;
  period_end: string;
  total_planned: number;
  currency: string;
  notes: string | null;
  financial_budget_lines?: Array<{
    id: string;
    category_id: string | null;
    category_name: string;
    planned_amount: number;
    notes: string | null;
  }>;
};

function BudgetCard({
  budget,
  onEdit,
  onDelete,
}: {
  budget: BudgetRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const actuals = useBudgetActuals(budget.id);
  const data = actuals.data;

  const chartData = useMemo(
    () =>
      (data?.lines ?? []).map((l) => ({
        name: l.category_name.length > 14 ? l.category_name.slice(0, 12) + '…' : l.category_name,
        Planeado: Number(l.planned_amount),
        Real: Number(l.actual_amount),
      })),
    [data],
  );

  const overallPct = data?.total_variance_pct ?? 0;
  const barWidth = Math.min(100, Math.max(0, overallPct));

  return (
    <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{budget.name}</div>
          <div className="text-[11px] text-muted-foreground">
            {budget.period_start} → {budget.period_end}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
            aria-label="Editar"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive"
            aria-label="Eliminar"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-muted-foreground">Planeado</div>
          <div className="font-semibold">{fmt(Number(budget.total_planned), budget.currency)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Real</div>
          <div className="font-semibold">
            {actuals.isLoading ? '—' : fmt(data?.total_actual ?? 0, budget.currency)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Variación</div>
          <div
            className={
              'font-semibold ' +
              ((data?.total_variance ?? 0) < 0 ? 'text-destructive' : 'text-emerald-500')
            }
          >
            {actuals.isLoading ? '—' : fmt(data?.total_variance ?? 0, budget.currency)}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={
              'h-full transition-all ' +
              (data?.overall_status === 'over'
                ? 'bg-destructive'
                : data?.overall_status === 'warning'
                  ? 'bg-amber-500'
                  : data?.overall_status === 'watch'
                    ? 'bg-yellow-500'
                    : 'bg-emerald-500')
            }
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground text-right">
          {overallPct ? `${overallPct.toFixed(0)}% consumido` : 'Sin ejecución'}
        </div>
      </div>

      {chartData.length > 0 && (
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={(v: number) => fmt(v, budget.currency)}
                contentStyle={{ fontSize: 11, borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Planeado" fill="hsl(var(--muted-foreground))" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Real" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <ul className="mt-3 space-y-1.5">
        {(data?.lines ?? []).map((l) => (
          <li
            key={l.line_id}
            className="flex items-center justify-between text-xs gap-2"
          >
            <span className="text-foreground truncate flex-1">{l.category_name}</span>
            <span className="text-muted-foreground">
              {fmt(Number(l.actual_amount), budget.currency)} / {fmt(Number(l.planned_amount), budget.currency)}
            </span>
            <span
              className={
                'text-[10px] px-1.5 py-0.5 rounded-full border ' + statusColor(l.status)
              }
            >
              {statusLabel(l.status)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function FinanceBudgetsPage() {
  const q = useBudgets();
  const alerts = useFinancialAlerts();
  const del = useDeleteBudget();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetRow | null>(null);

  const data = (q.data ?? []) as BudgetRow[];

  const budgetAlerts = (alerts.data ?? []).filter(
    (a: { alert_type: string; status: string }) =>
      a.alert_type === 'budget_overrun' && a.status === 'active',
  );

  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (b: BudgetRow) => {
    setEditing(b);
    setEditorOpen(true);
  };
  const onDelete = async (b: BudgetRow) => {
    if (!confirm(`¿Eliminar presupuesto "${b.name}"?`)) return;
    await del.mutateAsync(b.id);
  };

  const buildExport = () => {
    const rows: Array<Record<string, unknown>> = [];
    for (const b of data) {
      for (const l of b.financial_budget_lines ?? []) {
        rows.push({
          presupuesto: b.name,
          periodo: `${b.period_start}→${b.period_end}`,
          categoria: l.category_name,
          monto_planeado: Number(l.planned_amount),
          moneda: b.currency,
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
        rows: (b.financial_budget_lines ?? []).map((l) => [
          l.category_name,
          fmt(Number(l.planned_amount), b.currency),
        ]),
        summary: [{ label: 'Total planeado', value: fmt(Number(b.total_planned), b.currency) }],
      })),
    };
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {data.length} presupuesto{data.length === 1 ? '' : 's'}
        </div>
        <div className="flex items-center gap-2">
          <ReportExportMenu build={buildExport} disabled={data.length === 0} />
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            <Plus size={14} /> Nuevo
          </button>
        </div>
      </div>

      {budgetAlerts.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-sm font-semibold mb-1">
            <AlertTriangle size={14} />
            Alertas de sobre-ejecución activas
          </div>
          <ul className="space-y-1 text-xs text-foreground">
            {budgetAlerts.slice(0, 5).map((a: { id: string; message: string; severity: string }) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{a.message}</span>
                <span className="text-[10px] uppercase text-muted-foreground">{a.severity}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {q.isLoading ? (
        <div className="text-xs text-muted-foreground text-center py-6">Cargando…</div>
      ) : data.length === 0 ? (
        <div className="rounded-2xl bg-card border border-border p-8 shadow-soft text-center">
          <PiggyBank size={28} className="mx-auto text-muted-foreground mb-2" />
          <div className="text-sm">Aún no hay presupuestos.</div>
          <div className="text-xs text-muted-foreground mt-1">
            Crea el primero para comparar planeado vs real por categoría.
          </div>
          <button
            onClick={openNew}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm"
          >
            <Plus size={14} /> Nuevo presupuesto
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {data.map((b) => (
            <BudgetCard key={b.id} budget={b} onEdit={() => openEdit(b)} onDelete={() => onDelete(b)} />
          ))}
        </div>
      )}

      <BudgetEditor open={editorOpen} onClose={() => setEditorOpen(false)} budget={editing} />
    </div>
  );
}
