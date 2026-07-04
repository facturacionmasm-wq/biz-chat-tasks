import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, FileText, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

interface AdminReq {
  id: string;
  tenant_id: string;
  request_type: 'hosted_sms' | 'port_in';
  phone_number: string;
  country_code: string;
  current_carrier: string | null;
  desired_capabilities: any;
  documents: Array<{ type: string; name: string; storage_path: string; signed_url?: string | null }>;
  status: string;
  admin_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  tenants?: { name: string } | null;
}

const STATUSES = ['pending', 'in_review', 'approved', 'completed', 'rejected'] as const;

const SuperAdminByonRequests = () => {
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<AdminReq[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('');
  const [saving, setSaving] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const path = filter ? `byon-request-admin?status=${filter}` : 'byon-request-admin';
      const { data, error } = await supabase.functions.invoke(path, { method: 'GET' as any });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Error');
      setRows(data.requests || []);
      const draft: Record<string, string> = {};
      (data.requests || []).forEach((r: AdminReq) => { draft[r.id] = r.admin_notes || ''; });
      setNotesDraft(draft);
    } catch (e: any) {
      toast.error(e?.message || 'No se pudieron cargar las solicitudes BYON');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open, filter]);

  const update = async (id: string, status?: string) => {
    setSaving(id);
    try {
      const { data, error } = await supabase.functions.invoke('byon-request-admin', {
        method: 'PATCH' as any,
        body: { id, status, admin_notes: notesDraft[id] },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Error');
      toast.success('Solicitud actualizada');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Error al actualizar');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="rx-panel">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Solicitudes BYON (Hosted SMS / Port-in)
          </h3>
          <p className="text-xs text-[var(--rx-t2)] mt-0.5">Solicitudes de tenants para traer su propio número.</p>
        </div>
        <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); load(); }} disabled={loading} className="gap-1">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Recargar
        </Button>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--rx-t2)]">Filtrar:</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-[var(--rx-s2)] border border-[var(--rx-b1)] rounded-md px-2 py-1">
              <option value="">Todas</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="text-[var(--rx-t2)]">· {rows.length} resultado(s)</span>
          </div>

          {rows.length === 0 && !loading && (
            <p className="text-xs text-[var(--rx-t2)] text-center py-4">Sin solicitudes.</p>
          )}

          {rows.map((r) => (
            <div key={r.id} className="border border-[var(--rx-b1)] rounded-lg p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {r.tenants?.name || r.tenant_id.slice(0, 8)} · <span className="font-mono">{r.phone_number}</span>
                  </p>
                  <p className="text-[11px] text-[var(--rx-t2)]">
                    {r.request_type === 'hosted_sms' ? 'Hosted SMS' : 'Port-in'} · {r.country_code}
                    {r.current_carrier ? ` · ${r.current_carrier}` : ''} · {new Date(r.created_at).toLocaleString()}
                  </p>
                </div>
                <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-[var(--rx-s2)]">{r.status}</span>
              </div>

              {r.documents?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {r.documents.map((d, i) => (
                    <a
                      key={i}
                      href={d.signed_url || '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--rx-s2)] hover:bg-[var(--rx-s2)]/70 text-[var(--rx-brand)]"
                    >
                      <FileText size={10} /> {d.type} <ExternalLink size={10} />
                    </a>
                  ))}
                </div>
              )}

              <textarea
                value={notesDraft[r.id] || ''}
                onChange={(e) => setNotesDraft((prev) => ({ ...prev, [r.id]: e.target.value }))}
                placeholder="Notas para el tenant (visible en su panel)"
                className="w-full bg-[var(--rx-s2)] rounded-md px-2 py-1.5 text-xs border border-[var(--rx-b1)]"
                rows={2}
              />

              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    onClick={() => update(r.id, s)}
                    disabled={saving === r.id || s === r.status}
                    className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
                      s === r.status
                        ? 'bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground border-primary'
                        : 'bg-[var(--rx-s2)] border-[var(--rx-b1)] hover:bg-[var(--rx-s2)]/70'
                    }`}
                  >
                    {s}
                  </button>
                ))}
                <button
                  onClick={() => update(r.id)}
                  disabled={saving === r.id}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-[var(--rx-b1)] hover:bg-[var(--rx-s2)]"
                >
                  Guardar notas
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SuperAdminByonRequests;
