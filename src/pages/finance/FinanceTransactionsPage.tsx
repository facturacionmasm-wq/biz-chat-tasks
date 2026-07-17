import { useState, useMemo } from 'react';
import { useFinancialTransactions } from '@/hooks/useFinance';
import { ArrowUpRight, ArrowDownLeft, Search } from 'lucide-react';

const fmt = (n: number, currency = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

// Categorizador simple por reglas (Fase 1). Precede a IA compleja.
function suggestCategory(desc: string): string {
  const s = desc.toLowerCase();
  if (/(pemex|gasol|combust)/.test(s)) return 'Combustible';
  if (/(cfe|luz|agua|telcel|internet)/.test(s)) return 'Servicios';
  if (/(oxxo|walmart|costco|home depot|amazon|rappi)/.test(s)) return 'Compras';
  if (/(nómi|nomina|payroll)/.test(s)) return 'Nómina';
  if (/(dep[oó]sito|venta|ingreso|cobro)/.test(s)) return 'Ventas';
  return 'Sin categorizar';
}

export default function FinanceTransactionsPage() {
  const txs = useFinancialTransactions(300);
  const [q, setQ] = useState('');
  const [dirFilter, setDirFilter] = useState<'all' | 'credit' | 'debit'>('all');

  const filtered = useMemo(() => {
    const list = (txs.data ?? []) as Array<{
      id: string; posted_at: string; description: string; amount: number; currency: string;
      direction: 'credit' | 'debit'; status: string;
      financial_accounts?: { name: string; currency: string } | null;
      financial_categories?: { name: string } | null;
    }>;
    return list.filter((t) => {
      if (dirFilter !== 'all' && t.direction !== dirFilter) return false;
      if (q && !t.description.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [txs.data, q, dirFilter]);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-card border border-border p-3 shadow-soft">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-[200px] px-3 py-2 rounded-xl bg-[var(--rx-s2)]">
            <Search size={14} className="text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar transacción…"
              className="flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          {(['all', 'credit', 'debit'] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDirFilter(d)}
              className={`text-xs px-3 py-1.5 rounded-xl font-medium ${
                dirFilter === d ? 'bg-[var(--rx-brand)] text-[var(--rx-brand-foreground,white)]' : 'bg-[var(--rx-s2)] text-[var(--rx-t2)]'
              }`}
            >
              {d === 'all' ? 'Todas' : d === 'credit' ? 'Ingresos' : 'Egresos'}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-card border border-border overflow-hidden">
        {txs.isLoading ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Cargando…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Sin transacciones.</div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((t) => {
              const category = t.financial_categories?.name ?? suggestCategory(t.description);
              const isCredit = t.direction === 'credit';
              return (
                <li key={t.id} className="flex items-center gap-3 p-3 hover:bg-[var(--rx-s2)]/40">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isCredit ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'}`}>
                    {isCredit ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{t.description}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(t.posted_at).toLocaleDateString('es-MX')} · {t.financial_accounts?.name ?? '—'} · {category}
                    </div>
                  </div>
                  <div className={`text-sm font-semibold ${isCredit ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {isCredit ? '+' : '-'}{fmt(Number(t.amount), t.currency)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
