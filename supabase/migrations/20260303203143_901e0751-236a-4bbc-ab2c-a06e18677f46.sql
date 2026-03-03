
-- Usage packages (prepaid bundles)
CREATE TABLE public.usage_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  package_type text NOT NULL DEFAULT 'whatsapp', -- whatsapp, voice, mixed
  package_name text NOT NULL,
  included_messages integer NOT NULL DEFAULT 0,
  included_minutes numeric NOT NULL DEFAULT 0,
  used_messages integer NOT NULL DEFAULT 0,
  used_minutes numeric NOT NULL DEFAULT 0,
  price_local numeric NOT NULL DEFAULT 0,
  price_usd numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'MXN',
  status text NOT NULL DEFAULT 'active', -- active, exhausted, expired, cancelled
  purchased_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.usage_packages ENABLE ROW LEVEL SECURITY;

-- Owners/admins can view their tenant packages
CREATE POLICY "Tenant admins can view packages"
  ON public.usage_packages FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    AND (
      has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
      OR has_role(auth.uid(), 'super_admin'::app_role)
    )
  );

-- Super admins can manage all packages  
CREATE POLICY "Super admins can manage packages"
  ON public.usage_packages FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role));

-- Package catalog (available bundles for purchase)
CREATE TABLE public.package_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  package_type text NOT NULL DEFAULT 'whatsapp',
  included_messages integer NOT NULL DEFAULT 0,
  included_minutes numeric NOT NULL DEFAULT 0,
  price_mxn numeric NOT NULL DEFAULT 0,
  price_usd numeric NOT NULL DEFAULT 0,
  validity_days integer NOT NULL DEFAULT 30,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.package_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view catalog"
  ON public.package_catalog FOR SELECT
  TO authenticated
  USING (active = true);

CREATE POLICY "Super admins manage catalog"
  ON public.package_catalog FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role));
