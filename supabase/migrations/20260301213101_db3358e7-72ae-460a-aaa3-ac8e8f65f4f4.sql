
-- =============================================
-- FASE 1: TABLAS DE USO, COSTOS Y MÉTRICAS
-- =============================================

-- 1. Uso mensual agregado por tenant
CREATE TABLE public.tenant_usage_monthly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  total_calls integer NOT NULL DEFAULT 0,
  total_minutes numeric(10,2) NOT NULL DEFAULT 0,
  total_ai_tokens integer NOT NULL DEFAULT 0,
  cost_twilio numeric(12,4) NOT NULL DEFAULT 0,
  cost_ai numeric(12,4) NOT NULL DEFAULT 0,
  cost_infra numeric(12,4) NOT NULL DEFAULT 0,
  cost_total numeric(12,4) NOT NULL DEFAULT 0,
  revenue numeric(12,4) NOT NULL DEFAULT 0,
  margin numeric(12,4) NOT NULL DEFAULT 0,
  margin_pct numeric(5,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, period_start)
);

ALTER TABLE public.tenant_usage_monthly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages usage" ON public.tenant_usage_monthly
  FOR ALL TO service_role USING (true);

CREATE POLICY "Admins can view tenant usage" ON public.tenant_usage_monthly
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    AND (
      has_tenant_role(auth.uid(), tenant_id, 'admin')
      OR has_tenant_role(auth.uid(), tenant_id, 'owner')
      OR has_tenant_role(auth.uid(), tenant_id, 'super_admin')
    )
  );

-- 2. Métricas de margen por tenant (snapshot diario)
CREATE TABLE public.margin_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  metric_date date NOT NULL DEFAULT CURRENT_DATE,
  revenue_mtd numeric(12,4) NOT NULL DEFAULT 0,
  cost_mtd numeric(12,4) NOT NULL DEFAULT 0,
  margin_mtd numeric(12,4) NOT NULL DEFAULT 0,
  margin_pct_mtd numeric(5,2) NOT NULL DEFAULT 0,
  projected_revenue_eom numeric(12,4) NOT NULL DEFAULT 0,
  projected_cost_eom numeric(12,4) NOT NULL DEFAULT 0,
  projected_margin_eom numeric(12,4) NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'low',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, metric_date)
);

ALTER TABLE public.margin_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages margin" ON public.margin_metrics
  FOR ALL TO service_role USING (true);

CREATE POLICY "Admins can view margin" ON public.margin_metrics
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    AND (
      has_tenant_role(auth.uid(), tenant_id, 'admin')
      OR has_tenant_role(auth.uid(), tenant_id, 'owner')
      OR has_tenant_role(auth.uid(), tenant_id, 'super_admin')
    )
  );

-- 3. Estado de margen en tiempo real por tenant
CREATE TABLE public.realtime_margin_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
  current_month_revenue numeric(12,4) NOT NULL DEFAULT 0,
  current_month_cost numeric(12,4) NOT NULL DEFAULT 0,
  current_month_margin numeric(12,4) NOT NULL DEFAULT 0,
  current_month_margin_pct numeric(5,2) NOT NULL DEFAULT 0,
  current_month_calls integer NOT NULL DEFAULT 0,
  current_month_minutes numeric(10,2) NOT NULL DEFAULT 0,
  avg_cost_per_minute numeric(8,4) NOT NULL DEFAULT 0,
  avg_revenue_per_minute numeric(8,4) NOT NULL DEFAULT 0,
  dynamic_markup_pct numeric(5,2) NOT NULL DEFAULT 0,
  margin_alert_active boolean NOT NULL DEFAULT false,
  last_call_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.realtime_margin_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages realtime margin" ON public.realtime_margin_state
  FOR ALL TO service_role USING (true);

CREATE POLICY "Admins can view realtime margin" ON public.realtime_margin_state
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    AND (
      has_tenant_role(auth.uid(), tenant_id, 'admin')
      OR has_tenant_role(auth.uid(), tenant_id, 'owner')
      OR has_tenant_role(auth.uid(), tenant_id, 'super_admin')
    )
  );

-- 4. Costos por llamada individual (extensión de call_records)
CREATE TABLE public.call_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_record_id uuid NOT NULL REFERENCES public.call_records(id) ON DELETE CASCADE UNIQUE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  duration_minutes numeric(8,2) NOT NULL DEFAULT 0,
  ai_tokens_used integer NOT NULL DEFAULT 0,
  cost_twilio numeric(10,4) NOT NULL DEFAULT 0,
  cost_ai numeric(10,4) NOT NULL DEFAULT 0,
  cost_infra numeric(10,4) NOT NULL DEFAULT 0,
  cost_total numeric(10,4) NOT NULL DEFAULT 0,
  revenue_charged numeric(10,4) NOT NULL DEFAULT 0,
  margin numeric(10,4) NOT NULL DEFAULT 0,
  margin_pct numeric(5,2) NOT NULL DEFAULT 0,
  pricing_rule_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.call_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages call costs" ON public.call_costs
  FOR ALL TO service_role USING (true);

CREATE POLICY "Admins can view call costs" ON public.call_costs
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    AND (
      has_tenant_role(auth.uid(), tenant_id, 'admin')
      OR has_tenant_role(auth.uid(), tenant_id, 'owner')
      OR has_tenant_role(auth.uid(), tenant_id, 'super_admin')
    )
  );

-- 5. Reglas de pricing
CREATE TABLE public.pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  rule_type text NOT NULL DEFAULT 'per_minute',
  base_rate numeric(8,4) NOT NULL DEFAULT 0,
  markup_pct numeric(5,2) NOT NULL DEFAULT 30,
  min_charge numeric(8,4) NOT NULL DEFAULT 0,
  volume_tiers jsonb DEFAULT '[]'::jsonb,
  conditions jsonb DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages pricing rules" ON public.pricing_rules
  FOR ALL TO service_role USING (true);

CREATE POLICY "Super admins can view pricing rules" ON public.pricing_rules
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'));

-- 6. Ajustes de pricing por tenant
CREATE TABLE public.tenant_pricing_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pricing_rule_id uuid REFERENCES public.pricing_rules(id),
  adjustment_type text NOT NULL DEFAULT 'markup_override',
  adjustment_value numeric(8,4) NOT NULL DEFAULT 0,
  reason text,
  applied_by text DEFAULT 'system',
  active boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_pricing_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages pricing adjustments" ON public.tenant_pricing_adjustments
  FOR ALL TO service_role USING (true);

CREATE POLICY "Super admins can view pricing adjustments" ON public.tenant_pricing_adjustments
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'));

-- 7. Logs de detección de fraude
CREATE TABLE public.fraud_detection_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  detection_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_taken text,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fraud_detection_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages fraud logs" ON public.fraud_detection_logs
  FOR ALL TO service_role USING (true);

CREATE POLICY "Super admins can view fraud logs" ON public.fraud_detection_logs
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'));

-- 8. Scores de churn por tenant
CREATE TABLE public.tenant_churn_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  churn_probability numeric(5,4) NOT NULL DEFAULT 0,
  risk_category text NOT NULL DEFAULT 'low',
  factors jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  model_version text NOT NULL DEFAULT 'v1'
);

ALTER TABLE public.tenant_churn_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages churn scores" ON public.tenant_churn_scores
  FOR ALL TO service_role USING (true);

CREATE POLICY "Super admins can view churn scores" ON public.tenant_churn_scores
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'));

-- 9. Ofertas de retención
CREATE TABLE public.retention_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  offer_type text NOT NULL,
  description text,
  discount_pct numeric(5,2),
  duration_days integer,
  estimated_margin_impact numeric(10,4),
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.retention_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages retention offers" ON public.retention_offers
  FOR ALL TO service_role USING (true);

CREATE POLICY "Super admins can view offers" ON public.retention_offers
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Owners can view own offers" ON public.retention_offers
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    AND has_tenant_role(auth.uid(), tenant_id, 'owner')
  );

-- INDEXES for performance
CREATE INDEX idx_call_costs_tenant ON public.call_costs(tenant_id);
CREATE INDEX idx_call_costs_created ON public.call_costs(created_at);
CREATE INDEX idx_tenant_usage_period ON public.tenant_usage_monthly(tenant_id, period_start);
CREATE INDEX idx_margin_metrics_date ON public.margin_metrics(tenant_id, metric_date);
CREATE INDEX idx_fraud_logs_tenant ON public.fraud_detection_logs(tenant_id, created_at);
CREATE INDEX idx_churn_scores_tenant ON public.tenant_churn_scores(tenant_id, calculated_at);
CREATE INDEX idx_retention_offers_tenant ON public.retention_offers(tenant_id, status);
CREATE INDEX idx_pricing_adjustments_tenant ON public.tenant_pricing_adjustments(tenant_id, active);
