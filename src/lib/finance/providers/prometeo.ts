import type { FinancialDataProvider } from './types';

export const PrometeoProvider: FinancialDataProvider & { requiredSecrets: string[]; docsUrl: string } = {
  id: 'prometeo',
  label: 'Prometeo',
  available: false,
  requiredSecrets: ['PROMETEO_API_KEY'],
  docsUrl: 'https://docs.prometeoapi.com/',
  async connectInstitution() { throw new Error('Prometeo: provider_not_configured — solicitar credenciales'); },
  async exchangeConnectionToken() { throw new Error('Prometeo: provider_not_configured'); },
  async refreshConnection() { throw new Error('Prometeo: provider_not_configured'); },
  async getAccounts() { throw new Error('Prometeo: provider_not_configured'); },
  async getBalances() { throw new Error('Prometeo: provider_not_configured'); },
  async getTransactions() { throw new Error('Prometeo: provider_not_configured'); },
  async getConnectionStatus() { throw new Error('Prometeo: provider_not_configured'); },
  async disconnectConnection() { throw new Error('Prometeo: provider_not_configured'); },
};
