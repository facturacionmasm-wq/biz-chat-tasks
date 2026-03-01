
-- =============================================
-- FASE 4: TABLAS ANTIFRAUDE, CHURN Y RETENCIÓN
-- =============================================

-- 1. Rate limiting state per tenant
CREATE TABLE public.tenant_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
  calls_last_hour integer NOT NULL DEFAULT 0,
  calls_last_hour_reset_at timestamptz NOT NULL DEFAULT now(),
  calls_last_day integer NOT NULL DEFAULT 0,
  calls_last_day_reset_at timestamptz NOT NULL DEFAULT now(),
  is_blocked boolean NOT NULL DEFAULT false,
  blocked_reason text,
  blocked_at timestamptz,
  blocked_until timestamptz,
  max_calls_per_hour integer NOT NULL DEFAULT 60,
  max_calls_per_day integer NOT NULL DEFAULT 500,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages rate limits" ON public.tenant_rate_limits
  FOR ALL TO service_role USING (true);

CREATE POLICY "Super admins can view rate limits" ON public.tenant_rate_limits
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'));

-- 2. Fraud detection thresholds (configurable)
CREATE TABLE public.fraud_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  threshold_value numeric(10,2) NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  action text NOT NULL DEFAULT 'log',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fraud_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages thresholds" ON public.fraud_thresholds
  FOR ALL TO service_role USING (true);

CREATE POLICY "Super admins can manage thresholds" ON public.fraud_thresholds
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'));

-- 3. Churn model metrics (model performance tracking)
CREATE TABLE public.churn_model_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version text NOT NULL DEFAULT 'v1',
  run_date date NOT NULL DEFAULT CURRENT_DATE,
  tenants_evaluated integer NOT NULL DEFAULT 0,
  avg_churn_probability numeric(5,4) NOT NULL DEFAULT 0,
  high_risk_count integer NOT NULL DEFAULT 0,
  medium_risk_count integer NOT NULL DEFAULT 0,
  low_risk_count integer NOT NULL DEFAULT 0,
  offers_generated integer NOT NULL DEFAULT 0,
  accuracy_last_30d numeric(5,4),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.churn_model_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages churn metrics" ON public.churn_model_metrics
  FOR ALL TO service_role USING (true);

CREATE POLICY "Super admins can view churn metrics" ON public.churn_model_metrics
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'));

-- 4. Offer history (tracking accepted/rejected/expired)
CREATE TABLE public.tenant_offer_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  offer_id uuid REFERENCES public.retention_offers(id),
  offer_type text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  churn_score_at_time numeric(5,4),
  margin_at_time numeric(12,4),
  response_at timestamptz,
  response_action text,
  impact_revenue_30d numeric(12,4),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_offer_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages offer history" ON public.tenant_offer_history
  FOR ALL TO service_role USING (true);

CREATE POLICY "Super admins can view offer history" ON public.tenant_offer_history
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'));

-- Indexes
CREATE INDEX idx_rate_limits_tenant ON public.tenant_rate_limits(tenant_id);
CREATE INDEX idx_fraud_thresholds_active ON public.fraud_thresholds(active);
CREATE INDEX idx_churn_model_date ON public.churn_model_metrics(run_date);
CREATE INDEX idx_offer_history_tenant ON public.tenant_offer_history(tenant_id, created_at);

-- Seed default fraud thresholds
INSERT INTO public.fraud_thresholds (name, description, threshold_value, severity, action) VALUES
  ('max_call_duration_min', 'Duración máxima de llamada en minutos', 120, 'warning', 'log'),
  ('spike_calls_per_hour', 'Pico anormal de llamadas por hora vs promedio', 300, 'high', 'rate_limit'),
  ('min_avg_duration_sec', 'Duración mínima promedio sospechosa (bot)', 12, 'high', 'block_temp'),
  ('max_cost_per_call', 'Costo máximo por llamada individual', 50, 'critical', 'block_temp'),
  ('rapid_succession_interval_sec', 'Intervalo mínimo entre llamadas sucesivas', 5, 'warning', 'log'),
  ('concurrent_calls_limit', 'Límite de llamadas simultáneas por tenant', 10, 'high', 'rate_limit'),
  ('daily_cost_limit', 'Límite de costo diario por tenant', 500, 'critical', 'block_temp'),
  ('unusual_hours_threshold', 'Porcentaje de llamadas en horario inusual (2-5am)', 80, 'warning', 'log');
