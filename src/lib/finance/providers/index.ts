import type { FinancialDataProvider } from './types';
import { MockFinancialProvider } from './mock';
import { BelvoProvider } from './belvo';
import { PlaidProvider } from './plaid';
import { FinerioProvider } from './finerio';
import { PrometeoProvider } from './prometeo';

const registry: Record<string, FinancialDataProvider> = {
  mock: MockFinancialProvider,
  belvo: BelvoProvider,
  plaid: PlaidProvider,
  finerio: FinerioProvider,
  prometeo: PrometeoProvider,
};

export function getFinancialProvider(id: string): FinancialDataProvider {
  return registry[id] ?? registry.mock;
}

export function listFinancialProviders(): FinancialDataProvider[] {
  return Object.values(registry);
}

// Metadatos de cada provider real (para UI de integraciones)
export interface ProviderMetadata {
  id: string;
  requiredSecrets: string[];
  docsUrl: string;
}

export function getProviderMetadata(id: string): ProviderMetadata | null {
  const p = registry[id] as unknown as (FinancialDataProvider & Partial<ProviderMetadata>);
  if (!p || !p.requiredSecrets) return null;
  return { id: p.id, requiredSecrets: p.requiredSecrets, docsUrl: p.docsUrl ?? '' };
}

export { MockFinancialProvider };
export type { FinancialDataProvider } from './types';
