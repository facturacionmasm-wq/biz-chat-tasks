
-- ===== Table =====
CREATE TABLE IF NOT EXISTS public.tenant_fiscal_profiles (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Datos fiscales SAT
  rfc text NOT NULL,
  razon_social text NOT NULL,
  regimen_fiscal_sat text NOT NULL,
  codigo_postal text NOT NULL,
  -- CSD (cifrado AES-GCM)
  csd_cer_encrypted text,
  csd_key_encrypted text,
  csd_password_encrypted text,
  csd_serial text,
  csd_valid_from timestamptz,
  csd_valid_to timestamptz,
  csd_uploaded_at timestamptz,
  -- PAC
  pac_provider text CHECK (pac_provider IN ('facturama','sw_sapien','finkok')),
  pac_mode text NOT NULL DEFAULT 'sandbox' CHECK (pac_mode IN ('sandbox','production')),
  pac_credentials_encrypted text,
  use_shared_sandbox boolean NOT NULL DEFAULT false,
  -- Estado
  is_active boolean NOT NULL DEFAULT false,
  last_test_at timestamptz,
  last_test_status text,
  last_test_error text,
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ===== Grants =====
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_fiscal_profiles TO authenticated;
GRANT ALL ON public.tenant_fiscal_profiles TO service_role;

-- ===== RLS =====
ALTER TABLE public.tenant_fiscal_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners/admins select own fiscal profile" ON public.tenant_fiscal_profiles;
CREATE POLICY "Owners/admins select own fiscal profile"
ON public.tenant_fiscal_profiles FOR SELECT TO authenticated
USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  )
);

DROP POLICY IF EXISTS "Owners/admins insert own fiscal profile" ON public.tenant_fiscal_profiles;
CREATE POLICY "Owners/admins insert own fiscal profile"
ON public.tenant_fiscal_profiles FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  )
);

DROP POLICY IF EXISTS "Owners/admins update own fiscal profile" ON public.tenant_fiscal_profiles;
CREATE POLICY "Owners/admins update own fiscal profile"
ON public.tenant_fiscal_profiles FOR UPDATE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  )
)
WITH CHECK (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  )
);

DROP POLICY IF EXISTS "Owners/admins delete own fiscal profile" ON public.tenant_fiscal_profiles;
CREATE POLICY "Owners/admins delete own fiscal profile"
ON public.tenant_fiscal_profiles FOR DELETE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_role(auth.uid(), 'super_admin')
  )
);

-- ===== Public view (no encrypted columns) =====
CREATE OR REPLACE VIEW public.tenant_fiscal_profiles_public
WITH (security_invoker = true)
AS
SELECT
  tenant_id,
  rfc,
  razon_social,
  regimen_fiscal_sat,
  codigo_postal,
  (csd_cer_encrypted IS NOT NULL) AS has_csd,
  csd_serial,
  csd_valid_from,
  csd_valid_to,
  csd_uploaded_at,
  pac_provider,
  pac_mode,
  (pac_credentials_encrypted IS NOT NULL) AS has_pac_credentials,
  use_shared_sandbox,
  is_active,
  last_test_at,
  last_test_status,
  last_test_error,
  created_at,
  updated_at
FROM public.tenant_fiscal_profiles;

GRANT SELECT ON public.tenant_fiscal_profiles_public TO authenticated;
GRANT SELECT ON public.tenant_fiscal_profiles_public TO service_role;

-- ===== updated_at trigger =====
DROP TRIGGER IF EXISTS trg_tfp_updated_at ON public.tenant_fiscal_profiles;
CREATE TRIGGER trg_tfp_updated_at
BEFORE UPDATE ON public.tenant_fiscal_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== Audit trigger (no secrets in payload) =====
CREATE OR REPLACE FUNCTION public.audit_fiscal_profile_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _evt text; _tenant uuid; _payload jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _evt := 'fiscal_profile_created'; _tenant := NEW.tenant_id;
    _payload := jsonb_build_object('rfc', NEW.rfc, 'pac_provider', NEW.pac_provider, 'pac_mode', NEW.pac_mode, 'is_active', NEW.is_active);
  ELSIF TG_OP = 'UPDATE' THEN
    _evt := 'fiscal_profile_updated'; _tenant := NEW.tenant_id;
    _payload := jsonb_build_object(
      'rfc_changed', NEW.rfc IS DISTINCT FROM OLD.rfc,
      'csd_changed', NEW.csd_cer_encrypted IS DISTINCT FROM OLD.csd_cer_encrypted,
      'pac_provider', NEW.pac_provider,
      'pac_mode', NEW.pac_mode,
      'is_active', NEW.is_active,
      'use_shared_sandbox', NEW.use_shared_sandbox
    );
  ELSIF TG_OP = 'DELETE' THEN
    _evt := 'fiscal_profile_deleted'; _tenant := OLD.tenant_id;
    _payload := jsonb_build_object('rfc', OLD.rfc);
  END IF;
  INSERT INTO public.audit_events (tenant_id, event_type, actor_id, resource_type, resource_id, payload)
  VALUES (_tenant, _evt, auth.uid(), 'tenant_fiscal_profiles', _tenant::text, COALESCE(_payload, '{}'::jsonb));
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_tfp_audit ON public.tenant_fiscal_profiles;
CREATE TRIGGER trg_tfp_audit
AFTER INSERT OR UPDATE OR DELETE ON public.tenant_fiscal_profiles
FOR EACH ROW EXECUTE FUNCTION public.audit_fiscal_profile_changes();
