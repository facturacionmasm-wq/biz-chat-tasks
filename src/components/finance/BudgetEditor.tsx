import { useEffect, useState } from 'react';
import { X, Plus, Trash2, Loader2 } from 'lucide-react';
import { useFinancialCategories, useUpsertBudget, type BudgetLineInput } from '@/hooks/useFinance';
import { useProducts } from '@/hooks/useProducts';


type ExistingBudget = {
  id: string;
  name: string;
  period_start: string;
  period_end: string;
  currency: string;
  notes: string | null;
  financial_budget_lines?: Array<{
    id: string;
    category_id: string | null;
    category_name: string;
    planned_amount: number | string;
    notes: string | null;
  }>;
};

interface Props {
  open: boolean;
  onClose: () => void;
  budget?: ExistingBudget | null;
}

const emptyLine = (): BudgetLineInput => ({
  category_id: null,
  category_name: '',
  planned_amount: 0,
});

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthEndISO = () => {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return last.toISOString().slice(0, 10);
};

export default function BudgetEditor({ open, onClose, budget }: Props) {
  const cats = useFinancialCategories();
  const upsert = useUpsertBudget();

  const [name, setName] = useState('');
  const [periodStart, setPeriodStart] = useState(todayISO());
  const [periodEnd, setPeriodEnd] = useState(monthEndISO());
  const [currency, setCurrency] = useState('MXN');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<BudgetLineInput[]>([emptyLine()]);

  useEffect(() => {
    if (!open) return;
    if (budget) {
      setName(budget.name);
      setPeriodStart(budget.period_start);
      setPeriodEnd(budget.period_end);
      setCurrency(budget.currency ?? 'MXN');
      setNotes(budget.notes ?? '');
      setLines(
        (budget.financial_budget_lines ?? []).map((l) => ({
          category_id: l.category_id,
          category_name: l.category_name,
          planned_amount: Number(l.planned_amount) || 0,
          notes: l.notes,
        })),
      );
      if ((budget.financial_budget_lines ?? []).length === 0) setLines([emptyLine()]);
    } else {
      setName('');
      setPeriodStart(todayISO());
      setPeriodEnd(monthEndISO());
      setCurrency('MXN');
      setNotes('');
      setLines([emptyLine()]);
    }
  }, [open, budget]);

  if (!open) return null;

  const total = lines.reduce((acc, l) => acc + (Number(l.planned_amount) || 0), 0);

  const updateLine = (idx: number, patch: Partial<BudgetLineInput>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const canSave =
    name.trim().length > 0 &&
    periodStart &&
    periodEnd &&
    lines.length > 0 &&
    lines.every((l) => l.category_name.trim().length > 0 && Number(l.planned_amount) >= 0);

  const onSave = async () => {
    await upsert.mutateAsync({
      id: budget?.id ?? null,
      name: name.trim(),
      period_start: periodStart,
      period_end: periodEnd,
      currency,
      notes: notes.trim() || null,
      lines: lines.map((l) => ({
        category_id: l.category_id ?? null,
        category_name: l.category_name.trim(),
        planned_amount: Number(l.planned_amount) || 0,
        notes: l.notes ?? null,
      })),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card">
          <h3 className="text-base font-bold">{budget ? 'Editar presupuesto' : 'Nuevo presupuesto'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Nombre</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Presupuesto operativo julio"
              className="mt-1 w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary text-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Inicio</label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="mt-1 w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary text-foreground"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fin</label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="mt-1 w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary text-foreground"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Moneda</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="mt-1 w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary text-foreground"
            >
              <option value="MXN">MXN</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">Líneas por categoría</label>
              <button
                onClick={addLine}
                className="text-xs flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20"
              >
                <Plus size={12} /> Agregar línea
              </button>
            </div>
            <div className="space-y-2">
              {lines.map((l, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                  <select
                    value={l.category_id ?? ''}
                    onChange={(e) => {
                      const id = e.target.value || null;
                      const cat = (cats.data ?? []).find((c: { id: string; name: string }) => c.id === id);
                      updateLine(idx, {
                        category_id: id,
                        category_name: cat?.name ?? l.category_name,
                      });
                    }}
                    className="bg-secondary rounded-lg px-2 py-2 text-xs outline-none border border-border focus:border-primary text-foreground"
                  >
                    <option value="">— Categoría personalizada —</option>
                    {(cats.data ?? []).map((c: { id: string; name: string }) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {!l.category_id && (
                    <input
                      value={l.category_name}
                      onChange={(e) => updateLine(idx, { category_name: e.target.value })}
                      placeholder="Nombre"
                      className="w-32 bg-secondary rounded-lg px-2 py-2 text-xs outline-none border border-border focus:border-primary text-foreground"
                    />
                  )}
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={l.planned_amount}
                    onChange={(e) => updateLine(idx, { planned_amount: Number(e.target.value) })}
                    className="w-28 bg-secondary rounded-lg px-2 py-2 text-xs text-right outline-none border border-border focus:border-primary text-foreground"
                  />
                  <button
                    onClick={() => removeLine(idx)}
                    disabled={lines.length === 1}
                    className="p-2 rounded-lg text-destructive hover:bg-destructive/10 disabled:opacity-40"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
              <span className="text-xs text-muted-foreground">Total planeado</span>
              <span className="text-sm font-bold">
                {new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(total)}
              </span>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Notas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary text-foreground resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-border sticky bottom-0 bg-card">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl hover:bg-muted">
            Cancelar
          </button>
          <button
            onClick={onSave}
            disabled={!canSave || upsert.isPending}
            className="px-4 py-2 text-sm rounded-xl bg-primary text-primary-foreground disabled:opacity-50 flex items-center gap-2"
          >
            {upsert.isPending && <Loader2 size={14} className="animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
