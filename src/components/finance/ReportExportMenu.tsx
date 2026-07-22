import { useState } from 'react';
import { Download, FileText, Table as TableIcon, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { downloadCsv } from '@/lib/finance/reports/csv';
import { downloadPdf, type PdfSection } from '@/lib/finance/reports/pdf';
import { toast } from 'sonner';

export interface ExportPayload {
  title: string;
  period: string;
  currency: string;
  sections: PdfSection[];
  csvRows: Array<Record<string, unknown>>;
  csvFilename: string;
  pdfFilename: string;
}

export interface ReportExportMenuProps {
  build: () => ExportPayload | Promise<ExportPayload>;
  disabled?: boolean;
}

function useTenantName() {
  const { tenantId } = useAuth();
  return useQuery({
    queryKey: ['tenant-name', tenantId],
    enabled: !!tenantId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('tenants')
        .select('name')
        .eq('id', tenantId!)
        .maybeSingle();
      return data?.name ?? 'Tenant';
    },
  });
}

export default function ReportExportMenu({ build, disabled }: ReportExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const tenantName = useTenantName().data ?? 'Tenant';

  const run = async (kind: 'pdf' | 'csv') => {
    try {
      setBusy(true);
      const payload = await Promise.resolve(build());
      const meta = {
        tenantName,
        period: payload.period,
        currency: payload.currency,
        generatedAt: new Date(),
        title: payload.title,
      };
      if (kind === 'pdf') {
        downloadPdf(payload.pdfFilename, meta, payload.sections);
      } else {
        downloadCsv(payload.csvFilename, payload.csvRows, meta);
      }
      toast.success(`Reporte ${kind.toUpperCase()} descargado`);
    } catch (e) {
      toast.error(`No se pudo exportar: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-[var(--rx-s2)] hover:bg-[var(--rx-s2)]/70 text-foreground font-medium disabled:opacity-50"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
        Exportar
      </button>
      {open && !busy && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 rounded-xl bg-card border border-border shadow-lg overflow-hidden min-w-[160px]">
            <button
              onClick={() => run('pdf')}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--rx-s2)]/50 text-left"
            >
              <FileText size={14} /> PDF
            </button>
            <button
              onClick={() => run('csv')}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--rx-s2)]/50 text-left"
            >
              <TableIcon size={14} /> CSV (Excel)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
