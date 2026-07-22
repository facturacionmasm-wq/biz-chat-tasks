import { listFinancialProviders, getProviderMetadata } from '@/lib/finance/providers';
import { Plug, CheckCircle2, Clock, KeyRound, ExternalLink } from 'lucide-react';

export default function FinanceIntegrationsPage() {
  const providers = listFinancialProviders();
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
        <h3 className="text-sm font-semibold mb-1">Integraciones financieras</h3>
        <p className="text-xs text-muted-foreground">
          En Fase 2 dejamos preparados los conectores reales (Belvo, Plaid, Finerio, Prometeo) como <b>stubs seguros</b>: aparecen listados aquí, con la lista exacta de credenciales que requieren para activarse. El proveedor <b>Mock</b> sigue activo para demo y pruebas. Ningún stub se ejecuta hasta capturar las credenciales correspondientes.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {providers.map((p) => {
          const meta = getProviderMetadata(p.id);
          return (
            <div key={p.id} className="rounded-2xl bg-card border border-border p-4 shadow-soft">
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
                {p.available ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 flex items-center gap-1">
                    <CheckCircle2 size={11} /> Disponible
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 flex items-center gap-1">
                    <Clock size={11} /> Requiere credenciales
                  </span>
                )}
              </div>

              {meta && meta.requiredSecrets.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                    <KeyRound size={11} /> Credenciales requeridas
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
    </div>
  );
}
