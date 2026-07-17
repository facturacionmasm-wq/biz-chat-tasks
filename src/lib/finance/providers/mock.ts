import type { FinancialDataProvider, ProviderAccount, ProviderTransaction, ConnectionToken } from './types';

// Determinista por tenantId para que la demo se vea estable.
function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

export const MockFinancialProvider: FinancialDataProvider = {
  id: 'mock',
  label: 'Mock (demo)',
  available: true,

  async connectInstitution({ tenantId, institution }) {
    return { token: `mock-${tenantId}-${institution ?? 'demo'}-${Date.now()}` };
  },

  async exchangeConnectionToken(token: ConnectionToken) {
    return { connectionId: `conn-${hash(token.token).toString(16)}` };
  },

  async refreshConnection(_connectionId) {
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true };
  },

  async getAccounts(connectionId): Promise<ProviderAccount[]> {
    const seed = hash(connectionId);
    return [
      {
        externalId: `${connectionId}-1`,
        name: 'Cuenta Corriente MXN',
        institution: 'Banco Demo',
        accountType: 'bank',
        currency: 'MXN',
        currentBalance: 120000 + (seed % 50000),
        availableBalance: 115000 + (seed % 50000),
        status: 'connected',
      },
      {
        externalId: `${connectionId}-2`,
        name: 'Cuenta USD',
        institution: 'Banco Demo',
        accountType: 'bank',
        currency: 'USD',
        currentBalance: 8500 + (seed % 3000),
        status: 'connected',
      },
      {
        externalId: `${connectionId}-3`,
        name: 'Tarjeta Corporativa',
        institution: 'Banco Demo',
        accountType: 'card',
        currency: 'MXN',
        currentBalance: -15000 - (seed % 8000),
        status: 'connected',
      },
    ];
  },

  async getBalances(connectionId) {
    const accs = await this.getAccounts(connectionId);
    return Object.fromEntries(accs.map((a) => [a.externalId, a.currentBalance]));
  },

  async getTransactions(connectionId, opts): Promise<ProviderTransaction[]> {
    const accs = await this.getAccounts(connectionId);
    const seed = hash(connectionId + (opts?.since ?? ''));
    const out: ProviderTransaction[] = [];
    const merchants = ['OXXO', 'CFE', 'Telcel', 'Uber', 'Costco', 'Home Depot', 'Amazon', 'Pemex', 'Rappi', 'Cliente ABC S.A.'];
    const now = Date.now();
    for (let i = 0; i < 60; i++) {
      const acc = accs[i % accs.length];
      const isCredit = (seed + i) % 5 === 0;
      const amount = ((seed + i * 37) % 8000) + 150;
      out.push({
        externalId: `${connectionId}-tx-${i}`,
        accountExternalId: acc.externalId,
        postedAt: new Date(now - i * 24 * 3600 * 1000 * ((seed % 3) + 1)).toISOString(),
        description: isCredit ? `Depósito ${merchants[(seed + i) % merchants.length]}` : merchants[(i + seed) % merchants.length],
        amount,
        currency: acc.currency,
        direction: isCredit ? 'credit' : 'debit',
        categoryHint: isCredit ? 'Ventas' : ['Servicios', 'Combustible', 'Compras', 'Nómina'][i % 4],
      });
    }
    return out;
  },

  async getConnectionStatus(_connectionId) {
    return 'connected';
  },

  async disconnectConnection(_connectionId) {
    return;
  },
};
