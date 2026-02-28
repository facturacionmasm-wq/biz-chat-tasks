CREATE TABLE public.contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  phone text NOT NULL,
  name text,
  email text,
  company text,
  notes text,
  source text DEFAULT 'whatsapp',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, phone)
);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view contacts" ON public.contacts
  FOR SELECT USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Tenant staff can manage contacts" ON public.contacts
  FOR ALL USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Service role manages contacts" ON public.contacts
  FOR ALL USING (true);

CREATE TRIGGER update_contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.contacts;