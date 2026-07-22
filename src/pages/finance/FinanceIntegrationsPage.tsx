import { useState } from 'react';
import { listFinancialProviders, getProviderMetadata } from '@/lib/finance/providers';
import { Plug, CheckCircle2, Clock, KeyRound, ExternalLink, Link2, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ConnectBankWizard from '@/components/finance/ConnectBankWizard';
import { useFinancialConnections } from '@/hooks/useFinance';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

export default function FinanceIntegrationsPage() {
  const providers = listFinancialProviders().filter((p) => p.id !== 'mock');
  const { data: connections = [], isLoading } = useFinancialConnections();
  const [wizard, setWizard] = useState<{ id: string; label: string; docsUrl?: string } | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const qc = useQueryClient();

  async function handleDisconnect(connectionId: string) {
    setDisconnecting(connectionId);
    try {
      const { error } = await supabase.functions.invoke('financial-connection-disconnect', {
        body: { connection_id: connectionId },
      });
      if (error) throw error;
      toast.success('Conexión desconectada');
      qc.invalidateQueries({ queryKey: ['fin-connections'] });
      qc.invalidateQueries({ queryKey: ['fin-accounts'] });
    } catch (e) {
      toast.error(`Error: ${(e as Error).message}`);
    } finally {
      setDisconnecting(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
        <h3 className="text-sm font-semibold mb-1">Integraciones financieras</h3>
        <p className="text-xs text-muted-foreground">
          Conecta tus cuentas bancarias vía los widgets oficiales de cada proveedor. Nunca introduces API keys ni credenciales del banco en esta app: solo inicias sesión en tu banco dentro del widget. Los proveedores aparecen como <b>Requiere credenciales</b> hasta que el super admin de la plataforma cargue las credenciales maestras correspondientes.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {providers.map((p) => {
          const meta = getProviderMetadata(p.id);
          const active = connections.filter((c) => c.provider === p.id && c.status === 'connected');
          return (
            <div key={p.id} className="rounded-2xl bg-card border border-border p-4 shadow-soft space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[var(--rx-brand)]/15 flex items-center justify-center">
                    <Plug size={18} className="text-[var(--rx-brand)]" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold capitalize">{p.label}</div>
                    <div className="text-[11px] text-muted-foreground">ID: {p.id}</div>
                  </div>
                </div>
                {active.length > 0 ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 flex items-center gap-1">
                    <CheckCircle2 size={11} /> {active.length} conectada{active.length > 1 ? 's' : ''}
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 flex items-center gap-1">
                    <Clock size={11} /> Requiere credenciales
                  </span>
                )}
              </div>

              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => setWizard({ id: p.id, label: p.label, docsUrl: meta?.docsUrl })}
              >
                <Link2 size={14} className="mr-1" /> Conectar cuenta bancaria
              </Button>

              {isLoading && (
                <div className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Cargando conexiones…</div>
              )}

              {active.length > 0 && (
                <div className="pt-2 border-t border-border space-y-2">
                  {active.map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-xs">
                      <div>
                        <div className="font-medium">{c.institution ?? 'Institución'}</div>
                        <div className="text-[10px] text-muted-foreground">
                          Última sync: {c.last_sync_at ? formatDistanceToNow(new Date(c.last_sync_at), { addSuffix: true, locale: es }) : '—'}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDisconnect(c.id)}
                        disabled={disconnecting === c.id}
                      >
                        {disconnecting === c.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {meta && meta.requiredSecrets.length > 0 && (
                <div className="pt-2 border-t border-border">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                    <KeyRound size={11} /> Credenciales requeridas (plataforma)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {meta.requiredSecrets.map((s) => (
                      <span key={s} className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[var(--rx-s2)] text-foreground">
                        {s}
                      </span>
                    ))}
                  </div>
                  {meta.docsUrl && (
                    <a
                      href={meta.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-[11px] text-[var(--rx-brand)] hover:underline"
                    >
                      Docs oficiales <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {wizard && (
        <ConnectBankWizard
          providerId={wizard.id}
          providerLabel={wizard.label}
          docsUrl={wizard.docsUrl}
          open={!!wizard}
          onOpenChange={(o) => { if (!o) setWizard(null); }}
        />
      )}
    </div>
  );
}
