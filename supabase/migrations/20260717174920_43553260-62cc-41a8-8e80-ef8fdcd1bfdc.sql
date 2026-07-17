
-- Helper: is user member of project (avoids policy recursion)
CREATE OR REPLACE FUNCTION public.is_project_member(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = _project_id AND user_id = _user_id
  )
$$;

-- ============ project_progress_entries ============
CREATE TABLE IF NOT EXISTS public.project_progress_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL,
  author_name text,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  comment text NOT NULL,
  attachment_path text,
  attachment_name text,
  attachment_mime text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppe_project ON public.project_progress_entries(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ppe_tenant ON public.project_progress_entries(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_progress_entries TO authenticated;
GRANT ALL ON public.project_progress_entries TO service_role;

ALTER TABLE public.project_progress_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ppe_select_tenant_scope" ON public.project_progress_entries
FOR SELECT TO authenticated USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
    OR public.is_project_member(auth.uid(), project_id)
  )
);

CREATE POLICY "ppe_insert_members_or_admins" ON public.project_progress_entries
FOR INSERT TO authenticated WITH CHECK (
  author_user_id = auth.uid()
  AND tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
    OR public.is_project_member(auth.uid(), project_id)
  )
);

CREATE POLICY "ppe_update_author_or_admin" ON public.project_progress_entries
FOR UPDATE TO authenticated USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    author_user_id = auth.uid()
    OR public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
  )
);

CREATE POLICY "ppe_delete_author_or_admin" ON public.project_progress_entries
FOR DELETE TO authenticated USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    author_user_id = auth.uid()
    OR public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
  )
);

CREATE TRIGGER trg_ppe_updated
BEFORE UPDATE ON public.project_progress_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ project_progress_observations ============
CREATE TABLE IF NOT EXISTS public.project_progress_observations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  entry_id uuid NOT NULL REFERENCES public.project_progress_entries(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  supervisor_user_id uuid NOT NULL,
  supervisor_name text,
  observation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppo_entry ON public.project_progress_observations(entry_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ppo_tenant ON public.project_progress_observations(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_progress_observations TO authenticated;
GRANT ALL ON public.project_progress_observations TO service_role;

ALTER TABLE public.project_progress_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ppo_select_tenant_scope" ON public.project_progress_observations
FOR SELECT TO authenticated USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
    OR public.is_project_member(auth.uid(), project_id)
  )
);

CREATE POLICY "ppo_insert_admins_only" ON public.project_progress_observations
FOR INSERT TO authenticated WITH CHECK (
  supervisor_user_id = auth.uid()
  AND tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
  )
);

CREATE POLICY "ppo_update_admins_only" ON public.project_progress_observations
FOR UPDATE TO authenticated USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
  )
);

CREATE POLICY "ppo_delete_admins_only" ON public.project_progress_observations
FOR DELETE TO authenticated USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
  )
);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_progress_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_progress_observations;
