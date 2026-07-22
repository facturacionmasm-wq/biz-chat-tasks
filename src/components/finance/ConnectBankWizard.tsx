import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2, KeyRound, ExternalLink, ShieldCheck } from 'lucide-react';
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
  widget?: { link_token?: string; expiration?: string };
  provider: string;
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

  async function openPlaidLink(linkToken: string) {
    // Load Plaid Link SDK on demand (the widget runs entirely in the browser).
    const w = window as unknown as {
      Plaid?: {
        create: (opts: {
          token: string;
          onSuccess: (public_token: string, metadata: unknown) => void;
          onExit: (err: unknown) => void;
        }) => { open: () => void };
      };
    };
    if (!w.Plaid) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('No se pudo cargar Plaid Link'));
        document.body.appendChild(s);
      });
    }
    const handler = w.Plaid!.create({
      token: linkToken,
      onSuccess: (public_token, metadata) => { completeCallback({ public_token, metadata }); },
      onExit: (err) => { if (err) toast.error(`Plaid: ${(err as { display_message?: string }).display_message ?? 'cancelado'}`); },
    });
    handler.open();
  }

  const missing = init?.missing_secrets ?? [];
  const notConfigured = !loading && init && !init.configured;

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

        {notConfigured && (
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

        {init?.configured && providerId === 'plaid' && init.widget?.link_token && (
          <div className="space-y-3">
            <div className="rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs p-3 flex items-start gap-2">
              <ShieldCheck size={14} className="mt-0.5" />
              <span>Plaid está configurado. Al continuar se abrirá el widget oficial de Plaid Link para elegir tu banco.</span>
            </div>
            <Button className="w-full" onClick={() => openPlaidLink(init.widget!.link_token!)} disabled={loading}>
              Abrir Plaid Link
            </Button>
          </div>
        )}

        {init?.configured && providerId !== 'plaid' && (
          <div className="rounded-xl border border-border bg-muted/30 text-xs p-3">
            El adaptador de <b>{providerLabel}</b> ya tiene credenciales, pero su widget aún no está implementado en el frontend. Contacta al equipo de la plataforma para habilitarlo.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
