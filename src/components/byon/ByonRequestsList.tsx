import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, FileText, Clock, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';

interface Row {
  id: string;
  request_type: 'hosted_sms' | 'port_in';
  phone_number: string;
  country_code: string;
  status: 'pending' | 'in_review' | 'approved' | 'completed' | 'rejected';
  admin_notes: string | null;
  documents: any[];
  created_at: string;
  reviewed_at: string | null;
}

const STATUS_META: Record<Row['status'], { label: string; className: string; icon: any }> = {
  pending: { label: 'Pendiente', className: 'bg-[var(--rx-amber)]/15 text-[var(--rx-amber)]', icon: Clock },
  in_review: { label: 'En revisión', className: 'bg-[var(--rx-brand)]/15 text-[var(--rx-brand)]', icon: RefreshCw },
  approved: { label: 'Aprobada', className: 'bg-[var(--rx-emerald)]/15 text-[var(--rx-emerald)]', icon: CheckCircle2 },
  completed: { label: 'Completada', className: 'bg-[var(--rx-emerald)]/15 text-[var(--rx-emerald)]', icon: CheckCircle2 },
  rejected: { label: 'Rechazada', className: 'bg-[var(--rx-rose)]/15 text-[var(--rx-rose)]', icon: XCircle },
};

interface Props {
  refreshKey?: number;
}

const ByonRequestsList = ({ refreshKey }: Props) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('byon_requests')
      .select('id, request_type, phone_number, country_code, status, admin_notes, documents, created_at, reviewed_at')
      .order('created_at', { ascending: false });
    setRows((data as any) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  if (loading) {
    return (
      <div className="rx-panel flex items-center gap-2 text-sm text-[var(--rx-t2)]">
        <Loader2 size={14} className="animate-spin" /> Cargando solicitudes...
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rx-panel text-sm text-[var(--rx-t2)] text-center py-6">
        Aún no has enviado solicitudes de portabilidad o Hosted SMS.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const meta = STATUS_META[r.status];
        const Icon = meta.icon;
        return (
          <div key={r.id} className="rx-panel">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-mono text-sm text-foreground truncate">{r.phone_number}</p>
                  <span className="text-[10px] text-[var(--rx-t2)] uppercase tracking-wide">
                    {r.request_type === 'hosted_sms' ? 'Hosted SMS' : 'Port-in'} · {r.country_code}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--rx-t2)]">
                  Enviada el {new Date(r.created_at).toLocaleDateString()}
                  {r.documents?.length ? (
                    <span className="ml-2 inline-flex items-center gap-1"><FileText size={10} />{r.documents.length} doc.</span>
                  ) : null}
                </p>
                {r.admin_notes && (
                  <p className="text-xs text-foreground mt-2 bg-[var(--rx-s2)]/50 rounded-md p-2">
                    <span className="font-medium">Nota del equipo:</span> {r.admin_notes}
                  </p>
                )}
              </div>
              <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full shrink-0 ${meta.className}`}>
                <Icon size={12} /> {meta.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ByonRequestsList;
