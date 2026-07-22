import { useReceivables, usePayables } from '@/hooks/useFinance';
import type { AgingBucket, AgingResult } from '@/lib/finance/aging';
import ReportExportMenu from '@/components/finance/ReportExportMenu';

const BUCKETS: { key: AgingBucket; label: string; color: string }[] = [
  { key: 'current', label: 'Vigente', color: 'var(--rx-emerald)' },
  { key: '1-30', label: '1-30 días', color: 'var(--rx-sky)' },
  { key: '31-60', label: '31-60 días', color: 'var(--rx-amber)' },
  { key: '61-90', label: '61-90 días', color: 'var(--rx-rose)' },
  { key: '90+', label: '+90 días', color: 'var(--rx-violet)' },
];

const fmt = (n: number, currency = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

function buildAgingExport(title: string, data: AgingResult | undefined) {
  const rows: Array<Record<string, unknown>> = [];
  if (data) {
    for (const b of BUCKETS) {
      for (const it of data.buckets[b.key].items) {
        rows.push({
          bucket: b.label, contacto: it.contactName, monto: it.amount,
          moneda: it.currency, vencimiento: it.dueDate ?? '',
        });
      }
    }
  }
  return {
    title,
    period: 'Aging actual',
    currency: 'MXN',
    csvFilename: `${title.toLowerCase().replace(/[^a-z]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`,
    pdfFilename: `${title.toLowerCase().replace(/[^a-z]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`,
    csvRows: rows,
    sections: [{
      title,
      columns: ['Bucket', 'Contacto', 'Monto', 'Vencimiento'],
      rows: rows.map((r) => [String(r.bucket), String(r.contacto), fmt(Number(r.monto), String(r.moneda)), String(r.vencimiento)]),
      summary: BUCKETS.map((b) => ({
        label: b.label,
        value: `${fmt(data?.buckets[b.key].total ?? 0)} (${data?.buckets[b.key].count ?? 0})`,
      })).concat([{ label: 'Total', value: fmt(data?.grandTotal ?? 0) }]),
    }],
  };
}

export function AgingReport({ title, data, empty }: { title: string; data?: AgingResult; empty: string }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ReportExportMenu build={() => buildAgingExport(title, data)} disabled={!data || data.grandTotal === 0} />
      </div>
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

