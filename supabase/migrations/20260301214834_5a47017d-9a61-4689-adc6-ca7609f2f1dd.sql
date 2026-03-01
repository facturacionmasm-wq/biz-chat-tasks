
-- =============================================
-- FASE 3: TABLAS DE PRICING DINÁMICO
-- =============================================

-- 1. Historial de evaluaciones de pricing por tenant
CREATE TABLE public.pricing_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  evaluation_date date NOT NULL DEFAULT CURRENT_DATE,
  avg_monthly_minutes_3m numeric(10,2) NOT NULL DEFAULT 0,
  avg_monthly_calls_3m numeric(10,2) NOT NULL DEFAULT 0,
  avg_monthly_revenue_3m numeric(12,4) NOT NULL DEFAULT 0,
  avg_monthly_cost_3m numeric(12,4) NOT NULL DEFAULT 0,
  avg_margin_pct_3m numeric(5,2) NOT NULL DEFAULT 0,
  growth_rate_pct numeric(5,2) NOT NULL DEFAULT 0,
  usage_tier text NOT NULL DEFAULT 'standard',
  current_plan_slug text,
  recommended_plan_slug text,
  recommended_action text NOT NULL DEFAULT 'none',
  action_reason text,
  action_applied boolean NOT NULL DEFAULT false,
  applied_at timestamptz,
  old_markup_pct numeric(5,2),
  new_markup_pct numeric(5,2),
  old_per_minute_rate numeric(8,4),
  new_per_minute_rate numeric(8,4),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pricing_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages evaluations" ON public.pricing_evaluations
  FOR ALL TO service_role USING (true);

CREATE POLICY "Super admins can view evaluations" ON public.pricing_evaluations
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'));

-- 2. Volume tiers configuration (global)
CREATE TABLE public.volume_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  min_minutes numeric(10,2) NOT NULL DEFAULT 0,
  max_minutes numeric(10,2),
  per_minute_rate numeric(8,4) NOT NULL,
  markup_pct numeric(5,2) NOT NULL DEFAULT 30,
  discount_pct numeric(5,2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.volume_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages volume tiers" ON public.volume_tiers
  FOR ALL TO service_role USING (true);

CREATE POLICY "Super admins can manage volume tiers" ON public.volume_tiers
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'));

-- 3. Plan change history
CREATE TABLE public.plan_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  old_plan_slug text,
  new_plan_slug text NOT NULL,
  change_type text NOT NULL DEFAULT 'manual',
  change_reason text,
  evaluation_id uuid REFERENCES public.pricing_evaluations(id),
  stripe_subscription_id text,
  applied_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plan_change_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages plan changes" ON public.plan_change_history
  FOR ALL TO service_role USING (true);

CREATE POLICY "Super admins can view plan changes" ON public.plan_change_history
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Owners can view own plan changes" ON public.plan_change_history
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    AND has_tenant_role(auth.uid(), tenant_id, 'owner')
  );

-- Indexes
CREATE INDEX idx_pricing_evaluations_tenant ON public.pricing_evaluations(tenant_id, evaluation_date);
CREATE INDEX idx_plan_change_history_tenant ON public.plan_change_history(tenant_id, created_at);
CREATE INDEX idx_volume_tiers_active ON public.volume_tiers(active, sort_order);

-- Seed default volume tiers
INSERT INTO public.volume_tiers (name, min_minutes, max_minutes, per_minute_rate, markup_pct, discount_pct, sort_order) VALUES
  ('Starter', 0, 500, 1.50, 35, 0, 1),
  ('Growth', 500, 2000, 1.30, 30, 13, 2),
  ('Scale', 2000, 5000, 1.10, 25, 27, 3),
  ('Enterprise', 5000, NULL, 0.90, 20, 40, 4);
