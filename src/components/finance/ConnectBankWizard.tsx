import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2, KeyRound, ExternalLink, ShieldCheck, Info } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface Props {
  providerId: string;
  providerLabel: string;
  docsUrl?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface InitResponse {
  configured: boolean;
  missing_secrets?: string[];
  widget?: Record<string, unknown>;
  provider: string;
  requires_custom_ui?: boolean;
  message?: string;
}

export default function ConnectBankWizard({ providerId, providerLabel, docsUrl, open, onOpenChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [init, setInit] = useState<InitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) { setInit(null); setError(null); return; }
    let aborted = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data, error } = await supabase.functions.invoke('financial-connection-init', {
          body: { provider: providerId },
        });
        if (aborted) return;
        if (error) throw error;
        setInit(data as InitResponse);
      } catch (e) {
        if (!aborted) setError((e as Error).message);
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => { aborted = true; };
  }, [open, providerId]);

  async function completeCallback(payload: Record<string, unknown>) {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('financial-connection-callback', {
        body: { provider: providerId, payload },
      });
      if (error) throw error;
      toast.success(`Cuenta conectada${(data as { institution?: string })?.institution ? ` · ${(data as { institution?: string }).institution}` : ''}`);
      qc.invalidateQueries({ queryKey: ['fin-connections'] });
      qc.invalidateQueries({ queryKey: ['fin-accounts'] });
      onOpenChange(false);
    } catch (e) {
      toast.error(`No se pudo conectar: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadScript(src: string): Promise<void> {
    if (document.querySelector(`script[src="${src}"]`)) return;
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
      document.body.appendChild(s);
    });
  }

  async function openPlaidLink(linkToken: string) {
    await loadScript('https://cdn.plaid.com/link/v2/stable/link-initialize.js');
    const w = window as unknown as {
      Plaid?: { create: (opts: Record<string, unknown>) => { open: () => void } };
    };
    const handler = w.Plaid!.create({
      token: linkToken,
      onSuccess: (public_token: string, metadata: unknown) => { completeCallback({ public_token, metadata }); },
      onExit: (err: unknown) => { if (err) toast.error(`Plaid: ${(err as { display_message?: string }).display_message ?? 'cancelado'}`); },
    });
    handler.open();
  }

  async function openBelvoWidget(accessToken: string) {
    // https://developers.belvo.com/docs/connect-widget
    await loadScript('https://cdn.belvo.io/belvo-widget-1-stable.js');
    const w = window as unknown as {
      belvoSDK?: { createWidget: (token: string, opts: Record<string, unknown>) => { build: () => void } };
    };
    if (!w.belvoSDK) { toast.error('Belvo SDK no disponible'); return; }
    const widget = w.belvoSDK.createWidget(accessToken, {
      callback: (link_id: string, institution: string) => { completeCallback({ link: link_id, institution }); },
      onExit: () => { /* usuario cerró */ },
      onEvent: () => { /* logging opcional */ },
    });
    widget.build();
  }

  async function openFinerioWidget(widgetToken: string, customerId: string) {
    // Finerio Connect embed: https://finerioconnect.com/docs/widget
    // TODO(finerio): confirmar URL exacta del SDK; si difiere ajustar aquí.
    const src = 'https://widget.finerioconnect.com/sdk.js';
    try { await loadScript(src); } catch { toast.error('No se pudo cargar el widget de Finerio'); return; }
    const w = window as unknown as {
      FinerioConnect?: {
        create: (opts: Record<string, unknown>) => { open: () => void };
      };
    };
    if (!w.FinerioConnect) { toast.error('Finerio SDK no disponible'); return; }
    const handler = w.FinerioConnect.create({
      token: widgetToken,
      customerId,
      onSuccess: (data: { credentialId?: string; credential_id?: string; bank?: { name?: string } }) => {
        completeCallback({ credentialId: data.credentialId ?? data.credential_id, institution: data.bank?.name });
      },
      onExit: () => { /* usuario cerró */ },
    });
    handler.open();
  }

  const missing = init?.missing_secrets ?? [];
  const notConfigured = !loading && init && !init.configured;
  const widget = (init?.widget ?? {}) as Record<string, unknown>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar con {providerLabel}</DialogTitle>
          <DialogDescription>
            Flujo self-service. Tú solo inicias sesión en tu banco a través del widget oficial del proveedor. Las credenciales del banco nunca pasan por esta app.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 size={16} className="animate-spin" /> Preparando conexión…
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 text-destructive text-xs p-3">
            {error}
          </div>
        )}

        {init?.requires_custom_ui && (
          <div className="rounded-xl border border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400 text-xs p-3 space-y-1">
            <div className="flex items-center gap-1 font-semibold"><Info size={12} /> Requiere formulario dedicado</div>
            <p>{init.message ?? 'Este proveedor requiere una UI dedicada de credenciales bancarias (fase posterior).'}</p>
          </div>
        )}

        {notConfigured && !init?.requires_custom_ui && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs p-3 space-y-2">
            <div className="flex items-center gap-1 font-semibold"><KeyRound size={12} /> Proveedor no configurado</div>
            <p>El super admin de la plataforma aún no ha cargado las credenciales maestras necesarias para activar este proveedor.</p>
            {missing.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {missing.map((m) => (
                  <span key={m} className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-background/60">{m}</span>
                ))}
              </div>
            )}
            {docsUrl && (
              <a href={docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                Docs oficiales <ExternalLink size={10} />
              </a>
            )}
          </div>
        )}

        {init?.configured && providerId === 'plaid' && typeof widget.link_token === 'string' && (
          <ConfiguredAction label="Plaid está configurado. Se abrirá Plaid Link para elegir tu banco."
            onClick={() => openPlaidLink(widget.link_token as string)} disabled={loading} />
        )}

        {init?.configured && providerId === 'belvo' && typeof widget.access_token === 'string' && (
          <ConfiguredAction label="Belvo está configurado. Se abrirá el widget oficial."
            onClick={() => openBelvoWidget(widget.access_token as string)} disabled={loading} />
        )}

        {init?.configured && providerId === 'finerio' && typeof widget.widget_token === 'string' && (
          <ConfiguredAction label="Finerio Connect está configurado. Se abrirá el widget."
            onClick={() => openFinerioWidget(widget.widget_token as string, widget.customer_id as string)} disabled={loading} />
        )}

        {init?.configured && !['plaid','belvo','finerio'].includes(providerId) && (
          <div className="rounded-xl border border-border bg-muted/30 text-xs p-3">
            El adaptador de <b>{providerLabel}</b> ya tiene credenciales pero su UI aún no está implementada en el frontend.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConfiguredAction({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs p-3 flex items-start gap-2">
        <ShieldCheck size={14} className="mt-0.5" />
        <span>{label}</span>
      </div>
      <Button className="w-full" onClick={onClick} disabled={disabled}>Continuar</Button>
    </div>
  );
}
