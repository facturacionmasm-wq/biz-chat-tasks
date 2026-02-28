
-- Create a safe view excluding pin_hash
CREATE VIEW public.profiles_safe
WITH (security_invoker = on) AS
  SELECT id, user_id, tenant_id, name, email, phone,
         whatsapp_number, avatar_url, status, created_at, updated_at
  FROM public.profiles;

-- Grant access
GRANT SELECT ON public.profiles_safe TO authenticated;

-- Restrict base table SELECT to own profile only (pin_hash only visible for own record)
DROP POLICY IF EXISTS "Users can view tenant profiles" ON public.profiles;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());
