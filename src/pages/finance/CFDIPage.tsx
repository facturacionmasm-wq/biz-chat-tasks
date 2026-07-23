import { useEffect, useState } from 'react';
import { FileText, Plus, ExternalLink, Ban, AlertTriangle, Loader2, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import CFDIEditor from '@/components/finance/CFDIEditor';
import { useCfdiList, useCancelCfdi, type CfdiDocument } from '@/hooks/useCFDI';
import { supabase } from '@/integrations/supabase/client';

const CANCEL_MOTIVOS = [
  ['02', 'Comprobante emitido con errores sin relación'],
  ['03', 'No se llevó a cabo la operación'],
  ['04', 'Operación nominativa relacionada en una factura global'],
  ['01', 'Comprobante emitido con errores con relación'],
];

const STATUS_COLORS: Record<string, string> = {
  borrador: 'bg-muted text-muted-foreground',
  timbrado: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  cancelado: 'bg-destructive/10 text-destructive',
  error: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
};

export default function CFDIPage() {
  const list = useCfdiList();
  const cancel = useCancelCfdi();
  const [editing, setEditing] = useState<CfdiDocument | null | undefined>(undefined);
  const [cancelling, setCancelling] = useState<CfdiDocument | null>(null);
  const [motivo, setMotivo] = useState('02');
  const [profileActive, setProfileActive] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.from('tenant_fiscal_profiles_public').select('is_active').maybeSingle()
      .then(({ data }) => setProfileActive(data?.is_active ?? false));
  }, []);

  const rows = list.data ?? [];
  const fmt = (n: number, cur: string) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: cur }).format(n);

  return (
    <div className="space-y-4">
      {profileActive === false && (
        <div className="bg-orange-500/5 border border-orange-500/30 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-orange-500 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <div className="font-medium">Configura tu perfil fiscal antes de timbrar</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Cada empresa emite CFDI bajo su propia identidad legal (RFC, CSD, PAC). Sin perfil activo, el timbrado está bloqueado.
            </div>
          </div>
          <Link to="/finance/cfdi/settings"
            className="text-xs px-3 py-1.5 rounded-lg bg-orange-500 text-white flex items-center gap-1 shrink-0">
            <Settings size={12} /> Configurar
          </Link>
        </div>
      )}
      {profileActive && (
        <div className="flex justify-end">
          <Link to="/finance/cfdi/settings" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <Settings size={12} /> Perfil fiscal
          </Link>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <FileText size={20} /> Facturación electrónica (CFDI 4.0)
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">Emisión, timbrado y cancelación de comprobantes SAT.</p>
        </div>
        <button
          onClick={() => setEditing(null)}
          className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm flex items-center gap-2 hover:bg-primary/90"
        >
          <Plus size={16} /> Nuevo CFDI
        </button>
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {list.isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Cargando…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Sin comprobantes. Crea el primero.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Fecha</th>
                  <th className="text-left px-3 py-2 font-medium">Folio</th>
                  <th className="text-left px-3 py-2 font-medium">Receptor</th>
                  <th className="text-right px-3 py-2 font-medium">Total</th>
                  <th className="text-left px-3 py-2 font-medium">Estado</th>
                  <th className="text-right px-3 py-2 font-medium w-40">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="border-t border-border">
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {new Date(d.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{d.series ?? ''}{d.folio ?? '—'}</div>
                      {d.uuid_fiscal && <div className="text-[10px] text-muted-foreground font-mono">{d.uuid_fiscal}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{d.receptor_nombre}</div>
                      <div className="text-xs text-muted-foreground">{d.receptor_rfc}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(Number(d.total), d.moneda)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_COLORS[d.estado] ?? 'bg-muted'}`}>
                        {d.estado}
                      </span>
                      {d.estado === 'error' && d.error_message && (
                        <div className="text-[10px] text-destructive mt-1 truncate max-w-[220px]" title={d.error_message}>
                          {d.error_message}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {d.pdf_url && (
                          <a href={d.pdf_url} target="_blank" rel="noreferrer" className="p-1.5 rounded hover:bg-muted" title="PDF">
                            <ExternalLink size={14} />
                          </a>
                        )}
                        {d.estado === 'borrador' && (
                          <button
                            onClick={() => setEditing(d)}
                            className="text-xs px-2 py-1 rounded bg-secondary hover:bg-muted"
                          >
                            Editar
                          </button>
                        )}
                        {d.estado === 'timbrado' && (
                          <button
                            onClick={() => { setCancelling(d); setMotivo('02'); }}
                            className="p-1.5 rounded text-destructive hover:bg-destructive/10"
                            title="Cancelar"
                          >
                            <Ban size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CFDIEditor
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        existing={editing ?? null}
      />

      {cancelling && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl p-4 max-w-md w-full space-y-3">
            <h3 className="font-bold">Cancelar CFDI</h3>
            <p className="text-xs text-muted-foreground">
              UUID: <span className="font-mono">{cancelling.uuid_fiscal}</span>
            </p>
            <div>
              <label className="text-xs text-muted-foreground">Motivo SAT</label>
              <select value={motivo} onChange={(e) => setMotivo(e.target.value)}
                className="mt-1 w-full bg-secondary rounded-lg px-3 py-2 text-sm border border-border">
                {CANCEL_MOTIVOS.map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setCancelling(null)} className="px-3 py-1.5 text-sm rounded-xl hover:bg-muted">Cerrar</button>
              <button
                onClick={async () => {
                  await cancel.mutateAsync({ id: cancelling.id, motivo });
                  setCancelling(null);
                }}
                disabled={cancel.isPending}
                className="px-3 py-1.5 text-sm rounded-xl bg-destructive text-destructive-foreground disabled:opacity-50 flex items-center gap-2"
              >
                {cancel.isPending && <Loader2 size={14} className="animate-spin" />}
                Cancelar CFDI
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
