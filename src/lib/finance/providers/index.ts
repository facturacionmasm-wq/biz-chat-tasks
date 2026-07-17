import type { FinancialDataProvider } from './types';
import { MockFinancialProvider } from './mock';

// Stubs para fases futuras — throw explícito.
const notImplemented = (id: string, label: string): FinancialDataProvider => ({
  id, label, available: false,
  async connectInstitution() { throw new Error(`${label}: pendiente para fase futura`); },
  async exchangeConnectionToken() { throw new Error(`${label}: pendiente`); },
  async refreshConnection() { throw new Error(`${label}: pendiente`); },
  async getAccounts() { throw new Error(`${label}: pendiente`); },
  async getBalances() { throw new Error(`${label}: pendiente`); },
  async getTransactions() { throw new Error(`${label}: pendiente`); },
  async getConnectionStatus() { throw new Error(`${label}: pendiente`); },
  async disconnectConnection() { throw new Error(`${label}: pendiente`); },
});

const registry: Record<string, FinancialDataProvider> = {
  mock: MockFinancialProvider,
  belvo: notImplemented('belvo', 'Belvo'),
  plaid: notImplemented('plaid', 'Plaid'),
  finerio: notImplemented('finerio', 'Finerio'),
  prometeo: notImplemented('prometeo', 'Prometeo'),
};

export function getFinancialProvider(id: string): FinancialDataProvider {
  return registry[id] ?? registry.mock;
}

export function listFinancialProviders(): FinancialDataProvider[] {
  return Object.values(registry);
}

export { MockFinancialProvider };
export type { FinancialDataProvider } from './types';
