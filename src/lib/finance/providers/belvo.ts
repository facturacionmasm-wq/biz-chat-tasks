import type { FinancialDataProvider } from './types';

export const BelvoProvider: FinancialDataProvider & { requiredSecrets: string[]; docsUrl: string } = {
  id: 'belvo',
  label: 'Belvo',
  available: false,
  requiredSecrets: ['BELVO_SECRET_ID', 'BELVO_SECRET_PASSWORD'],
  docsUrl: 'https://developers.belvo.com/',
  async connectInstitution() { throw new Error('Belvo: provider_not_configured — solicitar credenciales'); },
  async exchangeConnectionToken() { throw new Error('Belvo: provider_not_configured'); },
  async refreshConnection() { throw new Error('Belvo: provider_not_configured'); },
  async getAccounts() { throw new Error('Belvo: provider_not_configured'); },
  async getBalances() { throw new Error('Belvo: provider_not_configured'); },
  async getTransactions() { throw new Error('Belvo: provider_not_configured'); },
  async getConnectionStatus() { throw new Error('Belvo: provider_not_configured'); },
  async disconnectConnection() { throw new Error('Belvo: provider_not_configured'); },
};
