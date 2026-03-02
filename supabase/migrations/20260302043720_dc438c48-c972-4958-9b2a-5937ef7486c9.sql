
-- Service packages catalog
CREATE TABLE public.service_packages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  service_type text NOT NULL DEFAULT 'voice', -- 'voice' or 'whatsapp'
  name text NOT NULL,
  description text,
  units integer NOT NULL DEFAULT 0, -- minutes for voice, messages for whatsapp
  unit_label text NOT NULL DEFAULT 'minutos',
  price numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'MXN',
  active boolean NOT NULL DEFAULT true,
  popular boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.service_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active packages" ON public.service_packages
  FOR SELECT USING (active = true);

CREATE POLICY "Service role manages packages" ON public.service_packages
  FOR ALL USING (true);

-- Tenant package balances (purchased packages)
CREATE TABLE public.tenant_package_balances (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  package_id uuid NOT NULL REFERENCES public.service_packages(id),
  service_type text NOT NULL,
  units_purchased integer NOT NULL DEFAULT 0,
  units_used integer NOT NULL DEFAULT 0,
  units_remaining integer GENERATED ALWAYS AS (units_purchased - units_used) STORED,
  status text NOT NULL DEFAULT 'active', -- active, depleted, expired
  stripe_payment_intent_id text,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_package_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view own balances" ON public.tenant_package_balances
  FOR SELECT USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Service role manages balances" ON public.tenant_package_balances
  FOR ALL USING (true);

-- Seed voice agent packages
INSERT INTO public.service_packages (service_type, name, description, units, unit_label, price, currency, sort_order, popular) VALUES
  ('voice', 'Starter Voz', 'Ideal para comenzar', 100, 'minutos', 299, 'MXN', 1, false),
  ('voice', 'Pro Voz', 'Para equipos en crecimiento', 500, 'minutos', 999, 'MXN', 2, true),
  ('voice', 'Enterprise Voz', 'Máximo volumen', 2000, 'minutos', 2999, 'MXN', 3, false);

-- Seed WhatsApp packages
INSERT INTO public.service_packages (service_type, name, description, units, unit_label, price, currency, sort_order, popular) VALUES
  ('whatsapp', 'Starter WhatsApp', 'Para negocios pequeños', 500, 'mensajes', 199, 'MXN', 1, false),
  ('whatsapp', 'Pro WhatsApp', 'Alto volumen de mensajes', 2000, 'mensajes', 599, 'MXN', 2, true),
  ('whatsapp', 'Enterprise WhatsApp', 'Mensajería ilimitada', 10000, 'mensajes', 1499, 'MXN', 3, false);
