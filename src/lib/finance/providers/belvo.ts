import type {
  FinancialDataProvider,
  ProviderAccount,
  ProviderTransaction,
  FinancialAccountStatus,
  ConnectionToken,
} from './types';
import { supabase } from '@/integrations/supabase/client';

async function callBelvo(action: string, params: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('belvo-proxy', {
    body: { action, params },
  });
  if (error) throw new Error(error.message || 'belvo_proxy_error');
  if (!data?.ok) {
    const detail = typeof data?.data === 'string' ? data.data : JSON.stringify(data?.data ?? {});
    throw new Error(`belvo_${action}_failed (${data?.status || 'n/a'}): ${detail}`);
  }
  return data.data;
}

function mapAccountType(category?: string): ProviderAccount['accountType'] {
  const c = (category || '').toUpperCase();
  if (c.includes('CREDIT_CARD')) return 'card';
  if (c.includes('CHECKING') || c.includes('SAVINGS') || c.includes('DEPOSIT')) return 'bank';
  if (c.includes('LOAN')) return 'other';
  return 'bank';
}

function mapDirection(amount: number, type?: string): 'credit' | 'debit' {
  if (type) {
    const t = type.toUpperCase();
    if (t === 'INFLOW' || t === 'CREDIT') return 'credit';
    if (t === 'OUTFLOW' || t === 'DEBIT') return 'debit';
  }
  return amount >= 0 ? 'credit' : 'debit';
}

export const BelvoProvider: FinancialDataProvider & { requiredSecrets: string[]; docsUrl: string } = {
  id: 'belvo',
  label: 'Belvo',
  available: true,
  requiredSecrets: ['BELVO_SECRET_ID', 'BELVO_SECRET_PASSWORD'],
  docsUrl: 'https://developers.belvo.com/',

  async connectInstitution(): Promise<ConnectionToken> {
    // Genera un access_token de corta duración para el Widget Connect de Belvo.
    const res = await callBelvo('create_widget_token');
    const token = (res as any)?.access ?? (res as any)?.access_token ?? '';
    return { token, meta: res as Record<string, unknown> };
  },

  async exchangeConnectionToken(token: ConnectionToken) {
    // El "link" ya viene del Widget o de register_link; se guarda el id devuelto.
    const linkId = (token.meta as any)?.link ?? token.token;
    if (!linkId) throw new Error('belvo_missing_link_id');
    return { connectionId: String(linkId) };
  },

  async refreshConnection(connectionId: string) {
    const res: any = await callBelvo('get_link_status', { link: connectionId });
    return { ok: !!res?.id, message: res?.status };
  },

  async getAccounts(connectionId: string): Promise<ProviderAccount[]> {
    const res: any = await callBelvo('get_accounts', { link: connectionId });
    const list = Array.isArray(res) ? res : res?.results ?? [];
    return list.map((a: any) => ({
      externalId: a.id,
      name: a.name || a.number || 'Cuenta',
      institution: a.institution?.name,
      accountType: mapAccountType(a.category),
      currency: a.currency || 'MXN',
      currentBalance: Number(a.balance?.current ?? 0),
      availableBalance: a.balance?.available != null ? Number(a.balance.available) : undefined,
      status: 'connected' as FinancialAccountStatus,
    }));
  },

  async getBalances(connectionId: string): Promise<Record<string, number>> {
    const accounts = await this.getAccounts(connectionId);
    return Object.fromEntries(accounts.map((a) => [a.externalId, a.currentBalance]));
  },

  async getTransactions(connectionId: string, opts?: { since?: string }): Promise<ProviderTransaction[]> {
    const date_from = opts?.since?.slice(0, 10) ??
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const date_to = new Date().toISOString().slice(0, 10);
    const res: any = await callBelvo('get_transactions', { link: connectionId, date_from, date_to });
    const list = Array.isArray(res) ? res : res?.results ?? [];
    return list.map((t: any) => ({
      externalId: t.id,
      accountExternalId: t.account?.id ?? t.account,
      postedAt: t.value_date || t.accounting_date || t.created_at,
      description: t.description || t.reference || 'Movimiento',
      amount: Math.abs(Number(t.amount ?? 0)),
      currency: t.currency || 'MXN',
      direction: mapDirection(Number(t.amount ?? 0), t.type),
      categoryHint: t.category || undefined,
    }));
  },

  async getConnectionStatus(connectionId: string): Promise<FinancialAccountStatus> {
    try {
      const res: any = await callBelvo('get_link_status', { link: connectionId });
      const s = (res?.status || '').toLowerCase();
      if (s === 'valid') return 'connected';
      if (s === 'invalid' || s === 'unconfirmed') return 'needs_attention';
      if (s === 'token_required') return 'needs_attention';
      return 'connected';
    } catch {
      return 'error';
    }
  },

  async disconnectConnection(connectionId: string) {
    await callBelvo('delete_link', { link: connectionId });
  },
};
