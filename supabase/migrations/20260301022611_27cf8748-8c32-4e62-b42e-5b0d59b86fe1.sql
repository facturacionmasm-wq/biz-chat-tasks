-- Block unauthenticated access to profiles
CREATE POLICY "Require authentication for profiles"
  ON public.profiles
  FOR ALL
  TO anon
  USING (false);

-- Block unauthenticated access to contacts
CREATE POLICY "Require authentication for contacts"
  ON public.contacts
  FOR ALL
  TO anon
  USING (false);