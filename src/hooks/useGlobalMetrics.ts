import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface GlobalMetric {
  id: string;
  metric_date: string;
  region: string;
  country_code: string;
  mrr: number;
  arr: number;
  arpu: number;
  ltv_avg: number;
  cac: number;
  ltv_cac_ratio: number;
  gross_margin_pct: number;
  net_revenue_retention_pct: number;
  churn_rate_pct: number;
  expansion_revenue: number;
  total_tenants: number;
  active_tenants: number;
  new_tenants: number;
  churned_tenants: number;
  total_revenue_usd: number;
  total_cost_usd: number;
}

export interface TenantLTV {
  id: string;
  tenant_id: string;
  estimated_ltv_local: number;
  estimated_ltv_usd: number;
  avg_monthly_revenue: number;
  estimated_lifetime_months: number;
  churn_probability: number;
  country_risk_factor: number;
  calculated_at: string;
}

export interface RegionalTarget {
  id: string;
  region: string;
  target_gross_margin_pct: number;
  max_price_change_pct: number;
  country_risk_multiplier: number;
  active: boolean;
}

export interface UsageCostReconciled {
  id: string;
  tenant_id: string;
  period_start: string;
  region: string;
  total_events: number;
  total_units: number;
  real_cost_usd: number;
  revenue_usd: number;
  margin_usd: number;
  margin_pct: number;
  currency: string;
}

export function useGlobalMetrics() {
  const { userRole } = useAuth();
  const queryClient = useQueryClient();
  const enabled = userRole === 'super_admin';

  // Latest global metrics (last 30 days)
  const globalMetrics = useQuery({
    queryKey: ['global-metrics'],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from('global_metrics_daily')
        .select('*')
        .eq('region', 'GLOBAL')
        .eq('country_code', 'ALL')
        .order('metric_date', { ascending: false })
        .limit(30);
      return (data || []) as unknown as GlobalMetric[];
    },
  });

  // Metrics by region (latest day)
  const regionMetrics = useQuery({
    queryKey: ['region-metrics'],
    enabled,
    queryFn: async () => {
      const { data: latest } = await supabase
        .from('global_metrics_daily')
        .select('metric_date')
        .eq('region', 'GLOBAL')
        .order('metric_date', { ascending: false })
        .limit(1);
      
      const date = (latest as any)?.[0]?.metric_date;
      if (!date) return [];

      const { data } = await supabase
        .from('global_metrics_daily')
        .select('*')
        .eq('metric_date', date)
        .eq('country_code', 'ALL')
        .neq('region', 'GLOBAL');
      return (data || []) as unknown as GlobalMetric[];
    },
  });

  // Metrics by country (latest day)
  const countryMetrics = useQuery({
    queryKey: ['country-metrics'],
    enabled,
    queryFn: async () => {
      const { data: latest } = await supabase
        .from('global_metrics_daily')
        .select('metric_date')
        .eq('region', 'GLOBAL')
        .order('metric_date', { ascending: false })
        .limit(1);
      
      const date = (latest as any)?.[0]?.metric_date;
      if (!date) return [];

      const { data } = await supabase
        .from('global_metrics_daily')
        .select('*')
        .eq('metric_date', date)
        .neq('country_code', 'ALL');
      return (data || []) as unknown as GlobalMetric[];
    },
  });

  // Top tenant LTV estimates
  const ltvEstimates = useQuery({
    queryKey: ['ltv-estimates'],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from('tenant_ltv_estimates')
        .select('*')
        .order('estimated_ltv_usd', { ascending: false })
        .limit(20);
      return (data || []) as unknown as TenantLTV[];
    },
  });

  // Regional targets
  const regionalTargets = useQuery({
    queryKey: ['regional-targets'],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from('regional_margin_targets')
        .select('*')
        .order('region');
      return (data || []) as unknown as RegionalTarget[];
    },
  });

  // WhatsApp usage costs reconciled (global view)
  const usageCosts = useQuery({
    queryKey: ['usage-costs-reconciled'],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from('usage_costs_reconciled')
        .select('*')
        .order('period_start', { ascending: false })
        .limit(100);
      return (data || []) as unknown as UsageCostReconciled[];
    },
  });

  // Generate metrics
  const generateMetrics = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('global-metrics-daily');
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success('Métricas globales generadas');
      queryClient.invalidateQueries({ queryKey: ['global-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['region-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['country-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['ltv-estimates'] });
      queryClient.invalidateQueries({ queryKey: ['usage-costs-reconciled'] });
    },
    onError: (err: any) => {
      toast.error(`Error generando métricas: ${err.message}`);
    },
  });

  // Latest global snapshot
  const latest = globalMetrics.data?.[0] ?? null;

  return {
    globalMetrics,
    regionMetrics,
    countryMetrics,
    ltvEstimates,
    regionalTargets,
    usageCosts,
    generateMetrics,
    latest,
  };
}
