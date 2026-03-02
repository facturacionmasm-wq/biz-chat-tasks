import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface UsageSummary {
  current_month: {
    total_units: number;
    by_type: Record<string, number>;
    period_start: string;
  };
  reconciled_history: Array<{
    id: string;
    tenant_id: string;
    period_start: string;
    period_end: string;
    total_events: number;
    total_units: number;
    real_cost_local_currency: number;
    real_cost_usd: number;
    revenue_local_currency: number;
    revenue_usd: number;
    margin_pct: number;
    currency: string;
    fx_rate_used: number;
    reconciliation_status: string;
  }>;
}

export function useTenantBilling(tenantId: string | null) {
  const { userRole } = useAuth();
  const enabled = !!tenantId && (userRole === 'owner' || userRole === 'admin' || userRole === 'super_admin');

  // Current month WhatsApp usage events
  const usageEvents = useQuery({
    queryKey: ['tenant-usage-events', tenantId],
    enabled,
    queryFn: async () => {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00:00`;
      
      const { data } = await supabase
        .from('whatsapp_usage_events')
        .select('event_type, units, occurred_at')
        .eq('tenant_id', tenantId!)
        .gte('occurred_at', monthStart)
        .order('occurred_at', { ascending: false });
      
      return data || [];
    },
  });

  // Reconciled cost history
  const costHistory = useQuery({
    queryKey: ['tenant-cost-history', tenantId],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from('usage_costs_reconciled')
        .select('*')
        .eq('tenant_id', tenantId!)
        .order('period_start', { ascending: false })
        .limit(6);
      
      return (data || []) as UsageSummary['reconciled_history'];
    },
  });

  // FX rate (latest)
  const fxRate = useQuery({
    queryKey: ['fx-rate-latest'],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from('fx_rates')
        .select('rate, rate_date')
        .eq('base_currency', 'USD')
        .eq('target_currency', 'MXN')
        .order('rate_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      return data ? { rate: Number(data.rate), date: data.rate_date } : { rate: 17.5, date: 'N/A' };
    },
  });

  // Aggregate current month stats
  const currentMonth = (() => {
    const events = usageEvents.data || [];
    let totalUnits = 0;
    const byType: Record<string, number> = {};
    for (const ev of events) {
      totalUnits += Number(ev.units);
      byType[ev.event_type] = (byType[ev.event_type] || 0) + Number(ev.units);
    }
    return { totalUnits, byType, eventCount: events.length };
  })();

  return {
    usageEvents,
    costHistory,
    fxRate,
    currentMonth,
    isLoading: usageEvents.isLoading || costHistory.isLoading,
  };
}
