import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { getFinancialProvider } from '@/lib/finance/providers';
import { projectCashflow, type ScenarioAssumptions } from '@/lib/finance/cashflow';
import { buildAging, type AgingItem } from '@/lib/finance/aging';
import {
  fetchSuggestions,
  confirmMatch,
  rejectSuggestion,
  markDuplicate,
  resetReconciliation,
  type MatchSuggestion,
} from '@/lib/finance/reconciliation';

// ── Cuentas ────────────────────────────────────────────────
export function useFinancialAccounts() {
  const { tenantId } = useAuth();
  return useQuery({
    queryKey: ['fin-accounts', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('financial_accounts')
        .select('*')
        .eq('tenant_id', tenantId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useFinancialConnections() {
  const { tenantId } = useAuth();
  return useQuery({
    queryKey: ['fin-connections', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('financial_connections')
        .select('*')
        .eq('tenant_id', tenantId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useConnectMockInstitution() {
  const { tenantId, user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (institution: string) => {
      if (!tenantId) throw new Error('Sin tenant');
      const provider = getFinancialProvider('mock');
      const tok = await provider.connectInstitution({ tenantId, institution });
      const { connectionId } = await provider.exchangeConnectionToken(tok);
      const { data: conn, error: connErr } = await supabase
        .from('financial_connections')
        .insert({ tenant_id: tenantId, provider: 'mock', institution, status: 'connected', last_sync_at: new Date().toISOString(), created_by: user?.id ?? null })
        .select()
        .single();
      if (connErr) throw connErr;

      const accs = await provider.getAccounts(connectionId);
      const accRows = accs.map((a) => ({
        tenant_id: tenantId,
        connection_id: conn.id,
        provider: 'mock',
        external_id: a.externalId,
        name: a.name,
        institution: a.institution,
        account_type: a.accountType,
        currency: a.currency,
        current_balance: a.currentBalance,
        available_balance: a.availableBalance ?? null,
        status: 'connected',
        last_synced_at: new Date().toISOString(),
      }));
      const { data: insertedAccs, error: accErr } = await supabase.from('financial_accounts').insert(accRows).select();
      if (accErr) throw accErr;

      const txs = await provider.getTransactions(connectionId);
      const accByExt = new Map(insertedAccs?.map((a) => [a.external_id, a.id]));
      const txRows = txs
        .map((t) => ({
          tenant_id: tenantId,
          account_id: accByExt.get(t.accountExternalId),
          external_id: t.externalId,
          posted_at: t.postedAt,
          description: t.description,
          amount: t.amount,
          currency: t.currency,
          direction: t.direction,
          status: 'posted' as const,
        }))
        .filter((r) => !!r.account_id);
      if (txRows.length) {
        const { error: txErr } = await supabase.from('financial_transactions').insert(txRows);
        if (txErr) throw txErr;
      }

      // Auditoría
      await supabase.from('audit_events').insert({
        tenant_id: tenantId, event_type: 'finance_connection_connect',
        actor_id: user?.id ?? null, resource_type: 'financial_connections',
        resource_id: conn.id, payload: { provider: 'mock', institution },
      });

      return conn;
    },
    onSuccess: () => {
      toast.success('Institución conectada');
      qc.invalidateQueries({ queryKey: ['fin-accounts'] });
      qc.invalidateQueries({ queryKey: ['fin-connections'] });
      qc.invalidateQueries({ queryKey: ['fin-transactions'] });
      qc.invalidateQueries({ queryKey: ['fin-summary'] });
    },
    onError: (e: unknown) => toast.error(`Error: ${(e as Error).message}`),
  });
}

export function useDisconnectConnection() {
  const { tenantId, user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (connectionId: string) => {
      const { error } = await supabase.from('financial_connections').update({ status: 'disconnected' }).eq('id', connectionId);
      if (error) throw error;
      await supabase.from('financial_accounts').update({ status: 'disconnected' }).eq('connection_id', connectionId);
      await supabase.from('audit_events').insert({
        tenant_id: tenantId, event_type: 'finance_connection_disconnect',
        actor_id: user?.id ?? null, resource_type: 'financial_connections', resource_id: connectionId, payload: {},
      });
    },
    onSuccess: () => {
      toast.success('Conexión desconectada');
      qc.invalidateQueries({ queryKey: ['fin-accounts'] });
      qc.invalidateQueries({ queryKey: ['fin-connections'] });
    },
  });
}

// ── Transacciones ─────────────────────────────────────────
export function useFinancialTransactions(limit = 200) {
  const { tenantId } = useAuth();
  return useQuery({
    queryKey: ['fin-transactions', tenantId, limit],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('financial_transactions')
        .select('*, financial_accounts(name, currency), financial_categories(name)')
        .eq('tenant_id', tenantId!)
        .order('posted_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ── Categorías ────────────────────────────────────────────
export function useFinancialCategories() {
  const { tenantId } = useAuth();
  return useQuery({
    queryKey: ['fin-categories', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('financial_categories')
        .select('*')
        .eq('tenant_id', tenantId!)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ── Resumen consolidado ───────────────────────────────────
export function useFinancialSummary(periodDays = 30, currency = 'MXN') {
  const { tenantId } = useAuth();
  return useQuery({
    queryKey: ['fin-summary', tenantId, periodDays, currency],
    enabled: !!tenantId,
    queryFn: async () => {
      const start = new Date(Date.now() - periodDays * 86400000).toISOString().slice(0, 10);
      const end = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase.rpc('compute_tenant_financial_summary', {
        _tenant_id: tenantId!, _period_start: start, _period_end: end, _currency: currency,
      });
      if (error) throw error;
      return data as Record<string, number | string | null>;
    },
  });
}

export function useHealthScore() {
  const { tenantId } = useAuth();
  return useQuery({
    queryKey: ['fin-health', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('compute_tenant_health_score', { _tenant_id: tenantId! });
      if (error) throw error;
      return data as {
        score: number; liquidity_score: number; cashflow_score: number;
        delinquency_score: number; budget_score: number; breakdown: Record<string, unknown>;
      };
    },
  });
}

// ── Presupuestos ──────────────────────────────────────────
export function useBudgets() {
  const { tenantId } = useAuth();
  return useQuery({
    queryKey: ['fin-budgets', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('financial_budgets')
        .select('*, financial_budget_lines(*)')
        .eq('tenant_id', tenantId!)
        .order('period_start', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export type BudgetActualLine = {
  line_id: string;
  category_id: string | null;
  category_name: string;
  planned_amount: number;
  actual_amount: number;
  variance: number;
  variance_pct: number | null;
  status: 'ok' | 'watch' | 'warning' | 'over';
};

export type BudgetActuals = {
  budget_id: string;
  name: string;
  currency: string;
  period_start: string;
  period_end: string;
  total_planned: number;
  total_actual: number;
  total_variance: number;
  total_variance_pct: number | null;
  overall_status: 'ok' | 'watch' | 'warning' | 'over';
  lines: BudgetActualLine[];
};

export function useBudgetActuals(budgetId: string | null) {
  return useQuery({
    queryKey: ['fin-budget-actuals', budgetId],
    enabled: !!budgetId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('compute_budget_actuals', { _budget_id: budgetId! });
      if (error) throw error;
      return data as unknown as BudgetActuals;
    },
  });
}

export type BudgetLineInput = {
  category_id?: string | null;
  category_name: string;
  planned_amount: number;
  notes?: string | null;
  product_id?: string | null;
  quantity?: number | null;
};


export function useUpsertBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string | null;
      name: string;
      period_start: string;
      period_end: string;
      currency?: string;
      notes?: string | null;
      lines: BudgetLineInput[];
    }) => {
      const { data, error } = await supabase.rpc('upsert_budget', {
        _id: input.id ?? null,
        _name: input.name,
        _period_start: input.period_start,
        _period_end: input.period_end,
        _currency: input.currency ?? 'MXN',
        _notes: input.notes ?? null,
        _lines: input.lines as unknown as never,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fin-budgets'] });
      qc.invalidateQueries({ queryKey: ['fin-budget-actuals'] });
      toast.success('Presupuesto guardado');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc('delete_budget', { _id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fin-budgets'] });
      toast.success('Presupuesto eliminado');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ── Forecast ──────────────────────────────────────────────
export function useCashflowForecast(
  horizonDays: 7 | 30 | 60 | 90 = 30,
  assumptions?: ScenarioAssumptions,
) {
  const summary = useFinancialSummary(30);
  const assumptionsKey = JSON.stringify(assumptions ?? {});
  return useQuery({
    queryKey: ['fin-cashflow', horizonDays, assumptionsKey, summary.data],
    enabled: !!summary.data,
    queryFn: async () => {
      const s = summary.data as Record<string, number>;
      const balance = Number(s.total_balance ?? 0);
      const dailyIn = Number(s.inflows ?? 0) / 30;
      const dailyOut = Number(s.outflows ?? 0) / 30;
      return projectCashflow({
        currentBalance: balance,
        dailyInflow: dailyIn,
        dailyOutflow: dailyOut,
        horizonDays,
        ...(assumptions ?? {}),
      });
    },
  });
}

// ── Conciliación (Fase 2) ─────────────────────────────────
export function useReconciliationSuggestions(lookbackDays = 60) {
  const { tenantId } = useAuth();
  return useQuery({
    queryKey: ['fin-reconciliation', tenantId, lookbackDays],
    enabled: !!tenantId,
    queryFn: () => fetchSuggestions(tenantId!, lookbackDays),
  });
}

export function useConfirmMatch() {
  const { user, tenantId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: MatchSuggestion & { mode: 'auto_matched' | 'manual_matched' }) => {
      await confirmMatch({
        transactionId: s.transaction_id,
        expenseId: s.expense_id,
        userId: user!.id,
        confidence: s.score,
        mode: s.mode,
      });
      await supabase.from('audit_events').insert({
        tenant_id: tenantId, event_type: 'finance_reconciliation_match',
        actor_id: user?.id ?? null, resource_type: 'financial_transactions',
        resource_id: s.transaction_id,
        payload: { expense_id: s.expense_id, mode: s.mode, score: s.score },
      });
    },
    onSuccess: () => {
      toast.success('Conciliación confirmada');
      qc.invalidateQueries({ queryKey: ['fin-reconciliation'] });
      qc.invalidateQueries({ queryKey: ['fin-transactions'] });
    },
    onError: (e: unknown) => toast.error(`Error: ${(e as Error).message}`),
  });
}

export function useRejectMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (txId: string) => rejectSuggestion(txId),
    onSuccess: () => {
      toast.success('Sugerencia rechazada');
      qc.invalidateQueries({ queryKey: ['fin-reconciliation'] });
      qc.invalidateQueries({ queryKey: ['fin-transactions'] });
    },
  });
}

export function useMarkDuplicate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (txId: string) => markDuplicate(txId),
    onSuccess: () => {
      toast.success('Marcada como duplicada');
      qc.invalidateQueries({ queryKey: ['fin-reconciliation'] });
      qc.invalidateQueries({ queryKey: ['fin-transactions'] });
    },
  });
}

export function useResetReconciliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (txId: string) => resetReconciliation(txId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fin-reconciliation'] });
      qc.invalidateQueries({ queryKey: ['fin-transactions'] });
    },
  });
}

// ── AR/AP ─────────────────────────────────────────────────
export function usePayables() {
  const { tenantId } = useAuth();
  return useQuery({
    queryKey: ['fin-payables', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      // Reutiliza expenses (proveedores)
      const { data, error } = await supabase
        .from('expenses')
        .select('id, vendor_name, amount, currency, expense_date, status, paid_at')
        .eq('tenant_id', tenantId!)
        .in('status', ['pending_approval', 'approved'])
        .is('paid_at', null)
        .order('expense_date', { ascending: true })
        .limit(500);
      if (error) throw error;
      const items: AgingItem[] = (data ?? []).map((e) => ({
        id: e.id,
        contactName: e.vendor_name ?? 'Proveedor',
        amount: Number(e.amount ?? 0),
        currency: e.currency ?? 'MXN',
        dueDate: e.expense_date ?? null,
      }));
      return buildAging(items);
    },
  });
}

export function useReceivables() {
  const { tenantId } = useAuth();
  return useQuery({
    queryKey: ['fin-receivables', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      // Reutiliza contacts marcados como cliente + transacciones de tipo credit pendientes
      // En Fase 1 armamos una vista simple a partir de contactos.
      const { data, error } = await supabase
        .from('contacts')
        .select('id, name, payment_terms_days')
        .eq('tenant_id', tenantId!)
        .eq('is_customer', true)
        .limit(200);
      if (error) throw error;
      // Sin facturación aún; regresa aging vacío.
      const items: AgingItem[] = (data ?? []).map((c) => ({
        id: c.id, contactName: c.name, amount: 0, currency: 'MXN', dueDate: null,
      }));
      return buildAging(items);
    },
  });
}

// ── Alertas ───────────────────────────────────────────────
export function useFinancialAlerts() {
  const { tenantId } = useAuth();
  return useQuery({
    queryKey: ['fin-alerts', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('financial_alerts')
        .select('*')
        .eq('tenant_id', tenantId!)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}
