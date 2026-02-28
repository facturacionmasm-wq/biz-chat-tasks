CREATE TABLE public.shared_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  platform_name text NOT NULL,
  username text NOT NULL,
  password_encrypted text NOT NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shared_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view credentials"
  ON public.shared_credentials FOR SELECT
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Staff can insert credentials"
  ON public.shared_credentials FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Staff can update credentials"
  ON public.shared_credentials FOR UPDATE
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Admins can delete credentials"
  ON public.shared_credentials FOR DELETE
  USING (
    tenant_id = get_user_tenant_id(auth.uid())
    AND (
      has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'super_admin'::app_role)
      OR created_by = auth.uid()
    )
  );

CREATE POLICY "Service role manages credentials"
  ON public.shared_credentials FOR ALL
  USING (true);

CREATE TRIGGER update_shared_credentials_updated_at
  BEFORE UPDATE ON public.shared_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();