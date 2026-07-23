
-- Helper: project access = member OR tenant admin/owner/super_admin
CREATE OR REPLACE FUNCTION public.can_access_project(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = _project_id
      AND p.tenant_id = public.get_user_tenant_id(_user_id)
      AND (
        public.is_project_member(_user_id, p.id)
        OR public.has_role(_user_id, 'admin'::app_role)
        OR public.has_role(_user_id, 'owner'::app_role)
        OR public.has_role(_user_id, 'super_admin'::app_role)
      )
  )
$$;

-- =====================
-- public.project_documents
-- =====================
DROP POLICY IF EXISTS "Tenant members can view project documents" ON public.project_documents;
DROP POLICY IF EXISTS "Tenant members can insert project documents" ON public.project_documents;
DROP POLICY IF EXISTS "Tenant members can delete project documents" ON public.project_documents;

CREATE POLICY "Project members can view project documents"
ON public.project_documents FOR SELECT TO authenticated
USING (public.can_access_project(auth.uid(), project_id));

CREATE POLICY "Project members can insert project documents"
ON public.project_documents FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND public.can_access_project(auth.uid(), project_id)
);

CREATE POLICY "Project members can delete project documents"
ON public.project_documents FOR DELETE TO authenticated
USING (public.can_access_project(auth.uid(), project_id));

-- =====================
-- storage.objects (project-documents bucket)
-- Path shapes in use:
--   {tenant}/{project}/...
--   progress/{tenant}/{project}/...
--   costs/{tenant}/{project}/...
-- Extract the project uuid from folder[2] or folder[3] and verify access.
-- =====================
DROP POLICY IF EXISTS "Tenant users can view project documents" ON storage.objects;
DROP POLICY IF EXISTS "Tenant users can upload project documents" ON storage.objects;
DROP POLICY IF EXISTS "Tenant users can update project documents" ON storage.objects;
DROP POLICY IF EXISTS "Tenant users can delete project documents" ON storage.objects;

CREATE OR REPLACE FUNCTION public.storage_path_project_id(_name text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  parts text[];
  candidate text;
  result uuid;
BEGIN
  parts := storage.foldername(_name);
  -- try segment 2 (shape: tenant/project/...)
  candidate := parts[2];
  BEGIN
    result := candidate::uuid;
    RETURN result;
  EXCEPTION WHEN others THEN
    NULL;
  END;
  -- try segment 3 (shape: progress|costs/tenant/project/...)
  candidate := parts[3];
  BEGIN
    result := candidate::uuid;
    RETURN result;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$$;

CREATE POLICY "Project members can view project document files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'project-documents'
  AND public.can_access_project(auth.uid(), public.storage_path_project_id(name))
);

CREATE POLICY "Project members can upload project document files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-documents'
  AND public.can_access_project(auth.uid(), public.storage_path_project_id(name))
);

CREATE POLICY "Project members can update project document files"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'project-documents'
  AND public.can_access_project(auth.uid(), public.storage_path_project_id(name))
);

CREATE POLICY "Project members can delete project document files"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'project-documents'
  AND public.can_access_project(auth.uid(), public.storage_path_project_id(name))
);
