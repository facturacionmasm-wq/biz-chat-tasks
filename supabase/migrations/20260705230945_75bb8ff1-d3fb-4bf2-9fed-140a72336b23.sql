
-- 1. Actualizar planes
UPDATE public.subscription_plans SET price_monthly = 50, features = '{"whatsapp": true, "knowledge_base": true, "voice_agent": false, "api_access": false, "support_level": "standard", "direct_support": false}'::jsonb WHERE slug = 'basic';

UPDATE public.subscription_plans SET features = '{"whatsapp": true, "knowledge_base": true, "voice_agent": true, "api_access": true, "support_level": "priority", "direct_support": true}'::jsonb WHERE slug = 'pro';

UPDATE public.subscription_plans SET features = '{"whatsapp": true, "knowledge_base": true, "voice_agent": true, "api_access": true, "custom_integrations": true, "priority_support": true, "support_level": "dedicated", "direct_support": true}'::jsonb WHERE slug = 'enterprise';

-- 2. Tabla de consultas de soporte prepagadas
CREATE TABLE IF NOT EXISTS public.support_consult_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid,
  stripe_session_id text,
  stripe_payment_intent_id text,
  amount numeric NOT NULL DEFAULT 20,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','consumed','refunded','failed')),
  paid_at timestamptz,
  consumed_at timestamptz,
  ticket_id uuid,
  channel_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_consult_tenant ON public.support_consult_purchases(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_support_consult_session ON public.support_consult_purchases(stripe_session_id);

GRANT SELECT, INSERT, UPDATE ON public.support_consult_purchases TO authenticated;
GRANT ALL ON public.support_consult_purchases TO service_role;

ALTER TABLE public.support_consult_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read own consults"
  ON public.support_consult_purchases FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Tenant members insert own consults"
  ON public.support_consult_purchases FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE TRIGGER trg_support_consult_updated
  BEFORE UPDATE ON public.support_consult_purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
