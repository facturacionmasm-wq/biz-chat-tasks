-- Allow public read access to tenants for branding on login page
CREATE POLICY "Public can read tenant branding" ON public.tenants
  FOR SELECT
  USING (true);