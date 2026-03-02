
-- 6. Global metrics daily (unicorn KPIs)
CREATE TABLE IF NOT EXISTS public.global_metrics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date date NOT NULL DEFAULT CURRENT_DATE,
  region text NOT NULL DEFAULT 'GLOBAL',
  country_code text NOT NULL DEFAULT 'ALL',
  mrr numeric NOT NULL DEFAULT 0,
  arr numeric NOT NULL DEFAULT 0,
  arpu numeric NOT NULL DEFAULT 0,
  ltv_avg numeric NOT NULL DEFAULT 0,
  cac numeric NOT NULL DEFAULT 0,
  ltv_cac_ratio numeric NOT NULL DEFAULT 0,
  gross_margin_pct numeric NOT NULL DEFAULT 0,
  net_revenue_retention_pct numeric NOT NULL DEFAULT 100,
  churn_rate_pct numeric NOT NULL DEFAULT 0,
  expansion_revenue numeric NOT NULL DEFAULT 0,
  total_tenants integer NOT NULL DEFAULT 0,
  active_tenants integer NOT NULL DEFAULT 0,
  new_tenants integer NOT NULL DEFAULT 0,
  churned_tenants integer NOT NULL DEFAULT 0,
  total_revenue_usd numeric NOT NULL DEFAULT 0,
  total_cost_usd numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(metric_date, region, country_code)
);
ALTER TABLE public.global_metrics_daily ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_global_metrics_date ON public.global_metrics_daily(metric_date DESC);
CREATE INDEX idx_global_metrics_region ON public.global_metrics_daily(region, metric_date DESC);
CREATE POLICY "Super admins view global metrics" ON public.global_metrics_daily FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role));
CREATE POLICY "Service role manages global metrics" ON public.global_metrics_daily FOR ALL USING (true);

-- 7. Tenant LTV estimation
CREATE TABLE IF NOT EXISTS public.tenant_ltv_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  estimated_ltv_local numeric NOT NULL DEFAULT 0,
  estimated_ltv_usd numeric NOT NULL DEFAULT 0,
  avg_monthly_revenue numeric NOT NULL DEFAULT 0,
  estimated_lifetime_months numeric NOT NULL DEFAULT 12,
  churn_probability numeric NOT NULL DEFAULT 0,
  country_risk_factor numeric NOT NULL DEFAULT 1,
  fx_instability_factor numeric NOT NULL DEFAULT 0,
  model_version text NOT NULL DEFAULT 'v1',
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenant_ltv_estimates ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ltv_tenant ON public.tenant_ltv_estimates(tenant_id, calculated_at DESC);
CREATE POLICY "Super admins view LTV" ON public.tenant_ltv_estimates FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role));
CREATE POLICY "Service role manages LTV" ON public.tenant_ltv_estimates FOR ALL USING (true);

-- 8. Regional target margins config
CREATE TABLE IF NOT EXISTS public.regional_margin_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region text NOT NULL UNIQUE,
  target_gross_margin_pct numeric NOT NULL DEFAULT 65,
  max_price_change_pct numeric NOT NULL DEFAULT 10,
  country_risk_multiplier numeric NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.regional_margin_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins manage targets" ON public.regional_margin_targets FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role));
CREATE POLICY "Service role manages targets" ON public.regional_margin_targets FOR ALL USING (true);

-- Seed default regional targets
INSERT INTO public.regional_margin_targets (region, target_gross_margin_pct, max_price_change_pct, country_risk_multiplier) VALUES
  ('LATAM', 65, 10, 1.15),
  ('NA', 70, 10, 1.0),
  ('EU', 68, 10, 1.0),
  ('APAC', 65, 10, 1.1)
ON CONFLICT (region) DO NOTHING;
