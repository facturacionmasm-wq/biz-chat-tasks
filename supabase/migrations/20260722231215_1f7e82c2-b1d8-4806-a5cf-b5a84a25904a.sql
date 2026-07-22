
-- 1) FKs opcionales a categoría y proyecto
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.financial_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id  uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_category ON public.expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_project  ON public.expenses(project_id);

-- 2) RPC de aprobación / rechazo
CREATE OR REPLACE FUNCTION public.approve_expense(
  _expense_id uuid,
  _decision text,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _exp record;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _decision NOT IN ('approve','reject') THEN
    RAISE EXCEPTION 'decision must be approve or reject';
  END IF;

  SELECT id, tenant_id, status INTO _exp FROM public.expenses WHERE id = _expense_id;
  IF _exp.id IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  IF NOT (
    public.has_role(_caller, 'super_admin')
    OR public.has_tenant_role(_caller, _exp.tenant_id, 'owner')
    OR public.has_tenant_role(_caller, _exp.tenant_id, 'admin')
  ) THEN
    RAISE EXCEPTION 'Insufficient privileges' USING ERRCODE = '42501';
  END IF;

  IF _decision = 'approve' THEN
    UPDATE public.expenses
      SET status = 'approved',
          approver_user_id = _caller,
          approved_at = now(),
          rejected_at = NULL,
          rejection_reason = NULL,
          updated_at = now()
      WHERE id = _expense_id;
  ELSE
    UPDATE public.expenses
      SET status = 'rejected',
          approver_user_id = _caller,
          rejected_at = now(),
          rejection_reason = _reason,
          updated_at = now()
      WHERE id = _expense_id;
  END IF;

  INSERT INTO public.audit_events (tenant_id, event_type, actor_id, resource_type, resource_id, payload)
  VALUES (_exp.tenant_id, 'expense_' || _decision, _caller, 'expenses', _expense_id::text,
          jsonb_build_object('reason', _reason));

  RETURN jsonb_build_object('ok', true, 'decision', _decision, 'expense_id', _expense_id);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_expense(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_expense(uuid, text, text) TO authenticated, service_role;
