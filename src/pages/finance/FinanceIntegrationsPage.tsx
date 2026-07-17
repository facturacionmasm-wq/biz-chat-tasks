import { listFinancialProviders } from '@/lib/finance/providers';
import { Plug, CheckCircle2, Clock } from 'lucide-react';

export default function FinanceIntegrationsPage() {
  const providers = listFinancialProviders();
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
        <h3 className="text-sm font-semibold mb-1">Integraciones financieras</h3>
        <p className="text-xs text-muted-foreground">
          En Fase 1 solo el proveedor <b>Mock</b> está activo (siembra datos simulados para demo y pruebas). Belvo, Plaid, Finerio y Prometeo quedan como <b>Próximamente</b> y aparecerán aquí conectables en la siguiente fase.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {providers.map((p) => (
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
                  <Clock size={11} /> Próximamente
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
