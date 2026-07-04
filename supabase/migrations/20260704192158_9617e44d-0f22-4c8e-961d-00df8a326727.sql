
ALTER TABLE public.google_calendar_tokens
  ADD COLUMN IF NOT EXISTS last_pull_at timestamptz;

CREATE TABLE IF NOT EXISTS public.calcom_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  api_key_encrypted text NOT NULL,
  webhook_secret text NOT NULL,
  webhook_id text,
  default_event_type_id text,
  status text NOT NULL DEFAULT 'active',
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calcom_integrations TO authenticated;
GRANT ALL ON public.calcom_integrations TO service_role;

ALTER TABLE public.calcom_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view calcom integration"
  ON public.calcom_integrations FOR SELECT
  TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'staff')
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Tenant admins can manage calcom integration"
  ON public.calcom_integrations FOR ALL
  TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE TRIGGER trg_calcom_integrations_updated_at
  BEFORE UPDATE ON public.calcom_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_calcom_integrations_tenant ON public.calcom_integrations(tenant_id);
