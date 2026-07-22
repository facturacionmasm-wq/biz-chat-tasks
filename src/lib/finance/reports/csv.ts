// Fase 2 · CSV export — nativo, sin dependencia.
// Cada valor se escapa según RFC 4180.

function escape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface CsvMeta {
  tenantName: string;
  period: string;
  currency: string;
  generatedAt: Date;
  title: string;
}

export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>, meta?: CsvMeta): void {
  const bom = '\uFEFF'; // Excel UTF-8
  const lines: string[] = [];
  if (meta) {
    lines.push(escape(meta.title));
    lines.push(`${escape('Tenant')},${escape(meta.tenantName)}`);
    lines.push(`${escape('Periodo')},${escape(meta.period)}`);
    lines.push(`${escape('Moneda')},${escape(meta.currency)}`);
    lines.push(`${escape('Generado')},${escape(meta.generatedAt.toLocaleString('es-MX'))}`);
    lines.push('');
  }
  if (rows.length > 0) {
    const headers = Object.keys(rows[0]);
    lines.push(headers.map(escape).join(','));
    for (const row of rows) {
      lines.push(headers.map((h) => escape(row[h])).join(','));
    }
  } else {
    lines.push('(sin datos)');
  }
  const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
