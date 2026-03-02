
-- ============================================
-- FX RATES TABLE (multi-currency support)
-- ============================================
CREATE TABLE public.fx_rates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  base_currency text NOT NULL DEFAULT 'USD',
  target_currency text NOT NULL,
  rate numeric NOT NULL DEFAULT 1,
  rate_date date NOT NULL DEFAULT CURRENT_DATE,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_fx_rates_unique ON public.fx_rates (base_currency, target_currency, rate_date);
CREATE INDEX idx_fx_rates_lookup ON public.fx_rates (target_currency, rate_date DESC);

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages fx_rates" ON public.fx_rates FOR ALL USING (true);
CREATE POLICY "Super admins view fx_rates" ON public.fx_rates FOR SELECT USING (has_role(auth.uid(), 'super_admin'::app_role));

-- Seed initial MXN rate
INSERT INTO public.fx_rates (base_currency, target_currency, rate, source) VALUES ('USD', 'MXN', 17.50, 'manual');

-- ============================================
-- GLOBAL PLAN PRICING (localized pricing)
-- ============================================
CREATE TABLE public.global_plan_pricing (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id),
  country_code text NOT NULL DEFAULT 'MX',
  base_price numeric NOT NULL DEFAULT 0,
  included_units integer NOT NULL DEFAULT 0,
  overage_price numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'MXN',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_global_plan_pricing_unique ON public.global_plan_pricing (plan_id, country_code);

ALTER TABLE public.global_plan_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages plan pricing" ON public.global_plan_pricing FOR ALL USING (true);
CREATE POLICY "Super admins view plan pricing" ON public.global_plan_pricing FOR SELECT USING (has_role(auth.uid(), 'super_admin'::app_role));
CREATE POLICY "Authenticated users view active pricing" ON public.global_plan_pricing FOR SELECT USING (active = true);

-- ============================================
-- WHATSAPP USAGE EVENTS (immutable event sourcing)
-- ============================================
CREATE TABLE public.whatsapp_usage_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  region text NOT NULL DEFAULT 'LATAM',
  provider text NOT NULL DEFAULT 'twilio',
  provider_message_id text,
  event_type text NOT NULL DEFAULT 'message_out',
  units numeric NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  billing_status text NOT NULL DEFAULT 'pending',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_events_tenant_time ON public.whatsapp_usage_events (tenant_id, occurred_at DESC);
CREATE INDEX idx_usage_events_region_time ON public.whatsapp_usage_events (region, occurred_at DESC);
CREATE INDEX idx_usage_events_billing ON public.whatsapp_usage_events (billing_status, tenant_id);

ALTER TABLE public.whatsapp_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages usage events" ON public.whatsapp_usage_events FOR ALL USING (true);
CREATE POLICY "Admins view own tenant usage" ON public.whatsapp_usage_events FOR SELECT 
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND (
    has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role) OR 
    has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
  ));
CREATE POLICY "Super admins view all usage" ON public.whatsapp_usage_events FOR SELECT 
  USING (has_role(auth.uid(), 'super_admin'::app_role));

-- ============================================
-- USAGE COSTS RECONCILED (FX-aware cost tracking)
-- ============================================
CREATE TABLE public.usage_costs_reconciled (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  region text NOT NULL DEFAULT 'LATAM',
  total_events integer NOT NULL DEFAULT 0,
  total_units numeric NOT NULL DEFAULT 0,
  real_cost_local_currency numeric NOT NULL DEFAULT 0,
  real_cost_usd numeric NOT NULL DEFAULT 0,
  revenue_local_currency numeric NOT NULL DEFAULT 0,
  revenue_usd numeric NOT NULL DEFAULT 0,
  margin_local numeric NOT NULL DEFAULT 0,
  margin_usd numeric NOT NULL DEFAULT 0,
  margin_pct numeric NOT NULL DEFAULT 0,
  fx_rate_used numeric NOT NULL DEFAULT 1,
  currency text NOT NULL DEFAULT 'MXN',
  reconciliation_status text NOT NULL DEFAULT 'pending',
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_usage_costs_unique ON public.usage_costs_reconciled (tenant_id, period_start, period_end);
CREATE INDEX idx_usage_costs_region ON public.usage_costs_reconciled (region, period_start DESC);

ALTER TABLE public.usage_costs_reconciled ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages reconciled costs" ON public.usage_costs_reconciled FOR ALL USING (true);
CREATE POLICY "Admins view own reconciled costs" ON public.usage_costs_reconciled FOR SELECT 
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND (
    has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role) OR 
    has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
  ));
CREATE POLICY "Super admins view all reconciled costs" ON public.usage_costs_reconciled FOR SELECT 
  USING (has_role(auth.uid(), 'super_admin'::app_role));

-- Enable realtime on usage events for live dashboards
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_usage_events;
