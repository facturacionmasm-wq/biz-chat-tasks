
CREATE TABLE public.byon_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('hosted_sms','port_in')),
  phone_number text NOT NULL,
  country_code text NOT NULL,
  current_carrier text,
  desired_capabilities jsonb NOT NULL DEFAULT '{"sms":true,"voice":false,"mms":false}'::jsonb,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_review','approved','completed','rejected')),
  admin_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.byon_requests TO authenticated;
GRANT ALL ON public.byon_requests TO service_role;

ALTER TABLE public.byon_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "byon_select_own_tenant"
  ON public.byon_requests FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "byon_insert_own_tenant"
  ON public.byon_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND requested_by = auth.uid()
  );

CREATE POLICY "byon_update_admin_only"
  ON public.byon_requests FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX idx_byon_requests_tenant ON public.byon_requests(tenant_id, created_at DESC);
CREATE INDEX idx_byon_requests_status ON public.byon_requests(status);

CREATE TRIGGER trg_byon_requests_updated_at
  BEFORE UPDATE ON public.byon_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
