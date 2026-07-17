import { useState } from 'react';
import { useFinancialAccounts, useFinancialConnections, useConnectMockInstitution, useDisconnectConnection } from '@/hooks/useFinance';
import { Landmark, Plus, RefreshCw, Unplug, Loader2 } from 'lucide-react';

const STATUS_STYLES: Record<string, string> = {
  connected: 'bg-emerald-500/15 text-emerald-500',
  syncing: 'bg-sky-500/15 text-sky-500',
  needs_attention: 'bg-amber-500/15 text-amber-500',
  error: 'bg-rose-500/15 text-rose-500',
  manual: 'bg-slate-500/15 text-slate-500',
  disconnected: 'bg-muted text-muted-foreground',
};

const fmt = (n: number, currency = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

export default function FinanceAccountsPage() {
  const accounts = useFinancialAccounts();
  const connections = useFinancialConnections();
  const connect = useConnectMockInstitution();
  const disconnect = useDisconnectConnection();
  const [institution, setInstitution] = useState('Banco Demo');

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
        <h3 className="text-sm font-semibold mb-3">Conectar institución (Mock)</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
            placeholder="Nombre de institución"
            className="flex-1 min-w-[200px] px-3 py-2 rounded-xl bg-[var(--rx-s2)] text-sm text-foreground border border-border outline-none focus:border-[var(--rx-brand)]"
          />
          <button
            onClick={() => connect.mutate(institution)}
            disabled={connect.isPending}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--rx-brand)] text-[var(--rx-brand-foreground,white)] text-sm font-medium disabled:opacity-60"
          >
            {connect.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Conectar mock
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Fase 1: solo el adaptador Mock siembra cuentas y transacciones simuladas. Belvo / Plaid / Finerio / Prometeo llegan en fase siguiente.
        </p>
      </div>

      <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
        <h3 className="text-sm font-semibold mb-3">Cuentas financieras</h3>
        {accounts.isLoading ? (
          <div className="text-xs text-muted-foreground">Cargando…</div>
        ) : (accounts.data ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground">Aún no hay cuentas. Conecta una institución mock arriba.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(accounts.data ?? []).map((a: { id: string; name: string; institution: string | null; account_type: string; currency: string; current_balance: number; status: string; connection_id: string | null }) => (
              <div key={a.id} className="rounded-xl border border-border p-3 bg-[var(--rx-s2)]/40">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2">
                    <Landmark size={16} className="text-[var(--rx-brand)] mt-0.5" />
                    <div>
                      <div className="text-sm font-semibold">{a.name}</div>
                      <div className="text-[11px] text-muted-foreground">{a.institution ?? '—'} · {a.account_type}</div>
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_STYLES[a.status] ?? STATUS_STYLES.manual}`}>{a.status}</span>
                </div>
                <div className="mt-3 text-lg font-bold">{fmt(Number(a.current_balance), a.currency)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-card border border-border p-4 shadow-soft">
        <h3 className="text-sm font-semibold mb-3">Conexiones</h3>
        {(connections.data ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground">Sin conexiones.</div>
        ) : (
          <ul className="space-y-2">
            {(connections.data ?? []).map((c: { id: string; provider: string; institution: string | null; status: string; last_sync_at: string | null }) => (
              <li key={c.id} className="flex items-center justify-between p-2 rounded-lg bg-[var(--rx-s2)]/40">
                <div>
                  <div className="text-xs font-medium">{c.institution ?? c.provider}</div>
                  <div className="text-[10px] text-muted-foreground">Provider: {c.provider} · Estado: {c.status}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    disabled
                    className="p-1.5 rounded-lg text-muted-foreground opacity-50 cursor-not-allowed"
                    title="Sincronizar (próximamente)"
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button
                    onClick={() => disconnect.mutate(c.id)}
                    className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10"
                    title="Desconectar"
                  >
                    <Unplug size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
