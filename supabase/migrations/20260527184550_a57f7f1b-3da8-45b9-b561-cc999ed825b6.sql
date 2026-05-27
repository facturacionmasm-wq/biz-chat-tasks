
-- 1. Branding storage: enforce tenant folder scope
DROP POLICY IF EXISTS "Admins can upload branding" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update branding" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete branding" ON storage.objects;

CREATE POLICY "Tenant admins can upload branding"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'branding'
  AND (storage.foldername(name))[1] = (public.get_user_tenant_id(auth.uid()))::text
  AND (
    public.has_tenant_role(auth.uid(), public.get_user_tenant_id(auth.uid()), 'admin'::public.app_role)
    OR public.has_tenant_role(auth.uid(), public.get_user_tenant_id(auth.uid()), 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
);

CREATE POLICY "Tenant admins can update branding"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'branding'
  AND (storage.foldername(name))[1] = (public.get_user_tenant_id(auth.uid()))::text
  AND (
    public.has_tenant_role(auth.uid(), public.get_user_tenant_id(auth.uid()), 'admin'::public.app_role)
    OR public.has_tenant_role(auth.uid(), public.get_user_tenant_id(auth.uid()), 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
);

CREATE POLICY "Tenant admins can delete branding"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'branding'
  AND (storage.foldername(name))[1] = (public.get_user_tenant_id(auth.uid()))::text
  AND (
    public.has_tenant_role(auth.uid(), public.get_user_tenant_id(auth.uid()), 'admin'::public.app_role)
    OR public.has_tenant_role(auth.uid(), public.get_user_tenant_id(auth.uid()), 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
);

-- 2. profiles.pin_hash: revoke from authenticated, allow only via service_role (pin-service edge fn)
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (
  id, user_id, tenant_id, name, email, phone, whatsapp_number,
  avatar_url, status, created_at, updated_at, onboarding_completed
) ON public.profiles TO authenticated;
-- keep update/insert/delete privileges (already governed by RLS)
GRANT INSERT, UPDATE, DELETE ON public.profiles TO authenticated;

-- 3. shared_credentials: require staff+ role for INSERT/UPDATE
DROP POLICY IF EXISTS "Staff can insert credentials" ON public.shared_credentials;
DROP POLICY IF EXISTS "Staff can update credentials" ON public.shared_credentials;

CREATE POLICY "Staff can insert credentials"
ON public.shared_credentials FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'staff'::public.app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::public.app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
);

CREATE POLICY "Staff can update credentials"
ON public.shared_credentials FOR UPDATE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'staff'::public.app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::public.app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
);

-- 4. google_calendar_tokens: auto-cleanup when profile is deleted
CREATE OR REPLACE FUNCTION public.cleanup_google_tokens_on_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.google_calendar_tokens WHERE user_id = OLD.user_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_google_tokens ON public.profiles;
CREATE TRIGGER trg_cleanup_google_tokens
  AFTER DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_google_tokens_on_profile_delete();
