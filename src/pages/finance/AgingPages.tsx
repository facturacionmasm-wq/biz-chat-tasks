import { useReceivables, usePayables } from '@/hooks/useFinance';
import type { AgingBucket, AgingResult } from '@/lib/finance/aging';

const BUCKETS: { key: AgingBucket; label: string; color: string }[] = [
  { key: 'current', label: 'Vigente', color: 'var(--rx-emerald)' },
  { key: '1-30', label: '1-30 días', color: 'var(--rx-sky)' },
  { key: '31-60', label: '31-60 días', color: 'var(--rx-amber)' },
  { key: '61-90', label: '61-90 días', color: 'var(--rx-rose)' },
  { key: '90+', label: '+90 días', color: 'var(--rx-violet)' },
];

const fmt = (n: number, currency = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

export function AgingReport({ title, data, empty }: { title: string; data?: AgingResult; empty: string }) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <span className="text-lg font-bold">{fmt(data?.grandTotal ?? 0)}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {BUCKETS.map((b) => {
            const bucket = data?.buckets[b.key];
            return (
              <div key={b.key} className="rounded-xl p-3 bg-[var(--rx-s2)]/40 border border-border">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{b.label}</div>
                <div className="text-base font-bold mt-1" style={{ color: b.color }}>{fmt(bucket?.total ?? 0)}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{bucket?.count ?? 0} items</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
        {(!data || data.grandTotal === 0) ? (
          <div className="text-xs text-muted-foreground text-center py-6">{empty}</div>
        ) : (
          <ul className="divide-y divide-border">
            {BUCKETS.flatMap((b) => data.buckets[b.key].items.map((it) => (
              <li key={it.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm font-medium">{it.contactName}</div>
                  <div className="text-[11px] text-muted-foreground">{b.label}{it.dueDate ? ` · vence ${new Date(it.dueDate).toLocaleDateString('es-MX')}` : ''}</div>
                </div>
                <div className="text-sm font-semibold" style={{ color: b.color }}>{fmt(it.amount, it.currency)}</div>
              </li>
            )))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function ReceivablesPage() {
  const q = useReceivables();
  return <AgingReport title="Cuentas por cobrar (Aging)" data={q.data} empty="Sin cuentas por cobrar registradas. Marca contactos como cliente en Contactos." />;
}

export function PayablesPage() {
  const q = usePayables();
  return <AgingReport title="Cuentas por pagar (Aging)" data={q.data} empty="Sin cuentas por pagar pendientes. Fuente: módulo Gastos." />;
}
