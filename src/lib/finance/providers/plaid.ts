import type { FinancialDataProvider } from './types';

export const PlaidProvider: FinancialDataProvider & { requiredSecrets: string[]; docsUrl: string } = {
  id: 'plaid',
  label: 'Plaid',
  available: false,
  requiredSecrets: ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'PLAID_ENV'],
  docsUrl: 'https://plaid.com/docs/',
  async connectInstitution() { throw new Error('Plaid: provider_not_configured — solicitar credenciales'); },
  async exchangeConnectionToken() { throw new Error('Plaid: provider_not_configured'); },
  async refreshConnection() { throw new Error('Plaid: provider_not_configured'); },
  async getAccounts() { throw new Error('Plaid: provider_not_configured'); },
  async getBalances() { throw new Error('Plaid: provider_not_configured'); },
  async getTransactions() { throw new Error('Plaid: provider_not_configured'); },
  async getConnectionStatus() { throw new Error('Plaid: provider_not_configured'); },
  async disconnectConnection() { throw new Error('Plaid: provider_not_configured'); },
};
