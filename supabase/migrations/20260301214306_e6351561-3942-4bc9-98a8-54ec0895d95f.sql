
-- =============================================
-- FASE 2: TABLAS STRIPE AUXILIARES
-- =============================================

-- 1. Stripe customers por tenant
CREATE TABLE public.stripe_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
  stripe_customer_id text NOT NULL UNIQUE,
  stripe_subscription_id text,
  stripe_metered_item_id text,
  stripe_base_item_id text,
  email text,
  name text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages stripe customers" ON public.stripe_customers
  FOR ALL TO service_role USING (true);

CREATE POLICY "Owners can view own stripe customer" ON public.stripe_customers
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    AND (
      has_tenant_role(auth.uid(), tenant_id, 'owner')
      OR has_tenant_role(auth.uid(), tenant_id, 'super_admin')
    )
  );

-- 2. Registros de uso reportados a Stripe
CREATE TABLE public.stripe_usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stripe_subscription_item_id text NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  period_start date NOT NULL,
  period_end date NOT NULL,
  stripe_usage_record_id text,
  status text NOT NULL DEFAULT 'pending',
  reported_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_usage_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages usage records" ON public.stripe_usage_records
  FOR ALL TO service_role USING (true);

CREATE POLICY "Super admins can view usage records" ON public.stripe_usage_records
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'));

-- Indexes
CREATE INDEX idx_stripe_customers_tenant ON public.stripe_customers(tenant_id);
CREATE INDEX idx_stripe_customers_stripe_id ON public.stripe_customers(stripe_customer_id);
CREATE INDEX idx_stripe_usage_tenant_period ON public.stripe_usage_records(tenant_id, period_start);
