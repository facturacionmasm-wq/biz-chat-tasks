// Finanzas Inteligentes · Fase 1 — Capa de abstracción proveedor
// Interfaz común. Único adaptador real en Fase 1: MockFinancialProvider.

export type FinancialAccountStatus =
  | 'connected'
  | 'syncing'
  | 'needs_attention'
  | 'error'
  | 'manual'
  | 'disconnected';

export interface ProviderAccount {
  externalId: string;
  name: string;
  institution?: string;
  accountType: 'bank' | 'card' | 'processor' | 'cash' | 'other';
  currency: string;
  currentBalance: number;
  availableBalance?: number;
  status: FinancialAccountStatus;
}

export interface ProviderTransaction {
  externalId: string;
  accountExternalId: string;
  postedAt: string; // ISO
  description: string;
  amount: number;
  currency: string;
  direction: 'credit' | 'debit';
  categoryHint?: string;
}

export interface ConnectionToken {
  token: string;
  expiresAt?: string;
  meta?: Record<string, unknown>;
}

export interface FinancialDataProvider {
  readonly id: string;
  readonly label: string;
  readonly available: boolean;
  connectInstitution(params: { tenantId: string; institution?: string }): Promise<ConnectionToken>;
  exchangeConnectionToken(token: ConnectionToken): Promise<{ connectionId: string }>;
  refreshConnection(connectionId: string): Promise<{ ok: boolean; message?: string }>;
  getAccounts(connectionId: string): Promise<ProviderAccount[]>;
  getBalances(connectionId: string): Promise<Record<string, number>>;
  getTransactions(connectionId: string, opts?: { since?: string }): Promise<ProviderTransaction[]>;
  getConnectionStatus(connectionId: string): Promise<FinancialAccountStatus>;
  disconnectConnection(connectionId: string): Promise<void>;
  handleWebhook?(payload: unknown): Promise<void>;
}
