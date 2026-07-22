// Fase 2 · Cliente de conciliación
import { supabase } from '@/integrations/supabase/client';

export interface MatchSuggestion {
  transaction_id: string;
  expense_id: string;
  tx_amount: number;
  tx_date: string;
  tx_description: string | null;
  exp_amount: number;
  exp_date: string;
  exp_description: string | null;
  amount_delta: number;
  day_delta: number;
  desc_similarity: number;
  score: number;
  suggested_status: 'auto_matched' | 'suggested' | 'unmatched';
}

export async function fetchSuggestions(
  tenantId: string,
  lookbackDays = 60,
): Promise<MatchSuggestion[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('suggest_transaction_matches', {
    _tenant_id: tenantId,
    _lookback_days: lookbackDays,
  });
  if (error) throw error;
  return (data ?? []) as MatchSuggestion[];
}

export async function confirmMatch(params: {
  transactionId: string;
  expenseId: string;
  userId: string;
  confidence: number;
  mode: 'auto_matched' | 'manual_matched';
}) {
  const { error } = await supabase
    .from('financial_transactions')
    .update({
      reconciliation_status: params.mode,
      reconciled_with_expense_id: params.expenseId,
      reconciled_at: new Date().toISOString(),
      reconciled_by: params.userId,
      match_confidence: Number(params.confidence.toFixed(3)),
    })
    .eq('id', params.transactionId);
  if (error) throw error;
}

export async function rejectSuggestion(transactionId: string) {
  const { error } = await supabase
    .from('financial_transactions')
    .update({ reconciliation_status: 'rejected' })
    .eq('id', transactionId);
  if (error) throw error;
}

export async function markDuplicate(transactionId: string) {
  const { error } = await supabase
    .from('financial_transactions')
    .update({ reconciliation_status: 'duplicate' })
    .eq('id', transactionId);
  if (error) throw error;
}

export async function resetReconciliation(transactionId: string) {
  const { error } = await supabase
    .from('financial_transactions')
    .update({
      reconciliation_status: 'unmatched',
      reconciled_with_expense_id: null,
      reconciled_at: null,
      reconciled_by: null,
      match_confidence: null,
    })
    .eq('id', transactionId);
  if (error) throw error;
}
