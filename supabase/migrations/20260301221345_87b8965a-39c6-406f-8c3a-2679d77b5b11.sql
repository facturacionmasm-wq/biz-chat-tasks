
-- 1. tenant_phone_numbers for resolving tenant from Twilio phone number
CREATE TABLE IF NOT EXISTS public.tenant_phone_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  provider text NOT NULL DEFAULT 'twilio',
  label text,
  twilio_subaccount_sid text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_phone_numbers_phone ON public.tenant_phone_numbers(phone_e164);
CREATE INDEX IF NOT EXISTS idx_tenant_phone_numbers_tenant ON public.tenant_phone_numbers(tenant_id);

ALTER TABLE public.tenant_phone_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage phone numbers"
  ON public.tenant_phone_numbers FOR ALL
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    AND (
      has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'super_admin'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id(auth.uid())
    AND (
      has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'super_admin'::app_role)
    )
  );

CREATE POLICY "Service role manages phone numbers"
  ON public.tenant_phone_numbers FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Tenant users view phone numbers"
  ON public.tenant_phone_numbers FOR SELECT
  USING (tenant_id = get_user_tenant_id(auth.uid()));

-- 2. Add pipeline status columns to call_records
ALTER TABLE public.call_records
  ADD COLUMN IF NOT EXISTS recording_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS transcript_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS summary_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS appointment_status text NOT NULL DEFAULT 'not_requested';

CREATE INDEX IF NOT EXISTS idx_call_records_tenant_created ON public.call_records(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_records_tenant_status ON public.call_records(tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_records_external_call_id ON public.call_records(external_call_id) WHERE external_call_id IS NOT NULL;
