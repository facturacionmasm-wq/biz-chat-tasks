
-- 1) Make project-documents bucket private
UPDATE storage.buckets SET public = false WHERE id = 'project-documents';

DROP POLICY IF EXISTS "Anyone can view project documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload project documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete project documents" ON storage.objects;

CREATE POLICY "Tenant users can view project documents"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'project-documents'
  AND (storage.foldername(name))[1] = (public.get_user_tenant_id(auth.uid()))::text);

CREATE POLICY "Tenant users can upload project documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'project-documents'
  AND (storage.foldername(name))[1] = (public.get_user_tenant_id(auth.uid()))::text);

CREATE POLICY "Tenant users can update project documents"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'project-documents'
  AND (storage.foldername(name))[1] = (public.get_user_tenant_id(auth.uid()))::text);

CREATE POLICY "Tenant users can delete project documents"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'project-documents'
  AND (storage.foldername(name))[1] = (public.get_user_tenant_id(auth.uid()))::text);

-- 2) Profiles: prevent tenant_id injection via trigger
CREATE OR REPLACE FUNCTION public.prevent_profile_tenant_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) IN ('service_role', 'supabase_admin', 'postgres') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'Changing tenant_id is not permitted';
    END IF;
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Changing user_id is not permitted';
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.tenant_id IS NULL THEN
      RAISE EXCEPTION 'tenant_id is required';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = NEW.user_id AND tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'Cannot assign profile to a tenant without a membership';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_tenant_change ON public.profiles;
CREATE TRIGGER trg_prevent_profile_tenant_change
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_tenant_change();

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- 3) user_roles: prevent privilege escalation
CREATE OR REPLACE FUNCTION public.can_assign_role(_assigner uuid, _tenant_id uuid, _target_role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _assigner AND role = 'super_admin') THEN true
    WHEN _target_role <> 'super_admin'
      AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _assigner AND tenant_id = _tenant_id AND role = 'owner') THEN true
    WHEN _target_role IN ('staff','partner','guest')
      AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _assigner AND tenant_id = _tenant_id AND role = 'admin') THEN true
    ELSE false
  END;
$$;

DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

CREATE POLICY "Authorized users can insert roles"
ON public.user_roles FOR INSERT TO authenticated
WITH CHECK (public.can_assign_role(auth.uid(), tenant_id, role));

CREATE POLICY "Authorized users can update roles"
ON public.user_roles FOR UPDATE TO authenticated
USING (
  has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  OR has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (public.can_assign_role(auth.uid(), tenant_id, role));

CREATE OR REPLACE FUNCTION public.audit_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_events (tenant_id, event_type, actor_id, resource_type, resource_id, payload)
  VALUES (
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    'user_role_' || lower(TG_OP),
    auth.uid(),
    'user_roles',
    COALESCE(NEW.id, OLD.id)::text,
    jsonb_build_object(
      'target_user_id', COALESCE(NEW.user_id, OLD.user_id),
      'role', COALESCE(NEW.role::text, OLD.role::text),
      'op', TG_OP
    )
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_role_changes ON public.user_roles;
CREATE TRIGGER trg_audit_role_changes
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.audit_role_changes();
