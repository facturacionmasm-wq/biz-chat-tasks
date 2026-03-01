import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface TenantMarginRow {
  tenant_id: string;
  tenant_name: string;
  current_month_calls: number;
  current_month_minutes: number;
  current_month_revenue: number;
  current_month_cost: number;
  current_month_margin: number;
  current_month_margin_pct: number;
  margin_alert_active: boolean;
  dynamic_markup_pct: number;
}

export interface FraudAlert {
  id: string;
  tenant_id: string;
  detection_type: string;
  severity: string;
  details: Record<string, any>;
  created_at: string;
  resolved: boolean;
}

export interface ChurnScore {
  id: string;
  tenant_id: string;
  churn_probability: number;
  risk_category: string;
  factors: Record<string, any>;
  calculated_at: string;
}

export interface RetentionOffer {
  id: string;
  tenant_id: string;
  offer_type: string;
  status: string;
  discount_pct: number | null;
  duration_days: number | null;
  description: string | null;
  created_at: string;
}

export interface PricingEval {
  id: string;
  tenant_id: string;
  recommended_action: string;
  usage_tier: string;
  avg_monthly_revenue_3m: number;
  avg_monthly_cost_3m: number;
  avg_margin_pct_3m: number;
  growth_rate_pct: number;
  action_applied: boolean;
  evaluation_date: string;
}

export function useSuperAdminData() {
  const { userRole } = useAuth();
  const enabled = userRole === 'super_admin';

  const margins = useQuery({
    queryKey: ['sa-margins'],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from('realtime_margin_state')
        .select('*')
        .order('current_month_revenue', { ascending: false });
      // Enrich with tenant names
      const tenantIds = (data || []).map(d => d.tenant_id);
      const { data: tenants } = await supabase
        .from('profiles')
        .select('tenant_id, name')
        .in('tenant_id', tenantIds);
      const nameMap: Record<string, string> = {};
      (tenants || []).forEach(t => { nameMap[t.tenant_id] = t.name; });
      return (data || []).map(d => ({
        ...d,
        tenant_name: nameMap[d.tenant_id] || d.tenant_id.slice(0, 8),
      })) as TenantMarginRow[];
    },
  });

  const fraudAlerts = useQuery({
    queryKey: ['sa-fraud'],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from('fraud_detection_logs')
        .select('*')
        .eq('resolved', false)
        .order('created_at', { ascending: false })
        .limit(20);
      return (data || []) as FraudAlert[];
    },
  });

  const churnScores = useQuery({
    queryKey: ['sa-churn'],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from('tenant_churn_scores')
        .select('*')
        .order('churn_probability', { ascending: false })
        .limit(20);
      return (data || []) as ChurnScore[];
    },
  });

  const retentionOffers = useQuery({
    queryKey: ['sa-offers'],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from('retention_offers')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(20);
      return (data || []) as RetentionOffer[];
    },
  });

  const pricingEvals = useQuery({
    queryKey: ['sa-pricing-evals'],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from('pricing_evaluations')
        .select('*')
        .order('evaluation_date', { ascending: false })
        .limit(20);
      return (data || []) as PricingEval[];
    },
  });

  const marginMetrics = useQuery({
    queryKey: ['sa-margin-metrics'],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from('margin_metrics')
        .select('*')
        .order('metric_date', { ascending: false })
        .limit(90);
      return data || [];
    },
  });

  const totalRevenue = margins.data?.reduce((s, m) => s + Number(m.current_month_revenue), 0) ?? 0;
  const totalCost = margins.data?.reduce((s, m) => s + Number(m.current_month_cost), 0) ?? 0;
  const totalMargin = totalRevenue - totalCost;
  const avgMarginPct = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0;

  return {
    margins,
    fraudAlerts,
    churnScores,
    retentionOffers,
    pricingEvals,
    marginMetrics,
    totals: { totalRevenue, totalCost, totalMargin, avgMarginPct },
  };
}
