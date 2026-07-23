
ALTER TABLE public.tenant_fiscal_profiles
  ADD COLUMN IF NOT EXISTS facturama_account_mode text NOT NULL DEFAULT 'own'
    CHECK (facturama_account_mode IN ('own','integrator')),
  ADD COLUMN IF NOT EXISTS facturama_csd_synced_at timestamptz;

DROP VIEW IF EXISTS public.tenant_fiscal_profiles_public;

CREATE VIEW public.tenant_fiscal_profiles_public
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
  facturama_account_mode,
  facturama_csd_synced_at,
  is_active,
  last_test_at,
  last_test_status,
  last_test_error,
  created_at,
  updated_at
FROM public.tenant_fiscal_profiles;

GRANT SELECT ON public.tenant_fiscal_profiles_public TO authenticated;
GRANT SELECT ON public.tenant_fiscal_profiles_public TO service_role;
