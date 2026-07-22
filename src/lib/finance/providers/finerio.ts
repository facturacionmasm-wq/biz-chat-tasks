import type { FinancialDataProvider } from './types';

export const FinerioProvider: FinancialDataProvider & { requiredSecrets: string[]; docsUrl: string } = {
  id: 'finerio',
  label: 'Finerio',
  available: false,
  requiredSecrets: ['FINERIO_API_KEY', 'FINERIO_CLIENT_ID'],
  docsUrl: 'https://finerioconnect.com/docs',
  async connectInstitution() { throw new Error('Finerio: provider_not_configured — solicitar credenciales'); },
  async exchangeConnectionToken() { throw new Error('Finerio: provider_not_configured'); },
  async refreshConnection() { throw new Error('Finerio: provider_not_configured'); },
  async getAccounts() { throw new Error('Finerio: provider_not_configured'); },
  async getBalances() { throw new Error('Finerio: provider_not_configured'); },
  async getTransactions() { throw new Error('Finerio: provider_not_configured'); },
  async getConnectionStatus() { throw new Error('Finerio: provider_not_configured'); },
  async disconnectConnection() { throw new Error('Finerio: provider_not_configured'); },
};
