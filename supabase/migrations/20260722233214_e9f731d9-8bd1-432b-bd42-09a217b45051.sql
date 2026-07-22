
-- 1) Ampliar policy de lectura para incluir super_admin
DROP POLICY IF EXISTS "Admins can view audit" ON public.audit_events;
CREATE POLICY "Admins can view audit"
  ON public.audit_events
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
      OR public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
    )
  );

GRANT SELECT ON public.audit_events TO authenticated;

-- 2) Trigger de auditoría para expenses
CREATE OR REPLACE FUNCTION public.audit_expense_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _evt text;
  _tenant uuid;
  _rid text;
  _payload jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _evt := 'expense_created';
    _tenant := NEW.tenant_id;
    _rid := NEW.id::text;
    _payload := jsonb_build_object('amount', NEW.amount, 'currency', NEW.currency, 'status', NEW.status, 'category_id', NEW.category_id, 'project_id', NEW.project_id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.category_id IS DISTINCT FROM OLD.category_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
      _evt := 'expense_updated';
      _tenant := NEW.tenant_id;
      _rid := NEW.id::text;
      _payload := jsonb_build_object(
        'old', jsonb_build_object('amount', OLD.amount, 'status', OLD.status, 'category_id', OLD.category_id, 'project_id', OLD.project_id, 'paid_at', OLD.paid_at),
        'new', jsonb_build_object('amount', NEW.amount, 'status', NEW.status, 'category_id', NEW.category_id, 'project_id', NEW.project_id, 'paid_at', NEW.paid_at)
      );
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    _evt := 'expense_deleted';
    _tenant := OLD.tenant_id;
    _rid := OLD.id::text;
    _payload := jsonb_build_object('amount', OLD.amount, 'status', OLD.status);
  END IF;

  INSERT INTO public.audit_events (tenant_id, event_type, actor_id, resource_type, resource_id, payload)
  VALUES (_tenant, _evt, auth.uid(), 'expenses', _rid, COALESCE(_payload, '{}'::jsonb));

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_expenses ON public.expenses;
CREATE TRIGGER trg_audit_expenses
  AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.audit_expense_changes();

-- 3) Trigger de auditoría para financial_accounts (cambios de status)
CREATE OR REPLACE FUNCTION public.audit_financial_account_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _evt text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _evt := 'financial_account_linked';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      _evt := CASE WHEN NEW.status = 'disconnected' THEN 'financial_account_unlinked' ELSE 'financial_account_status_changed' END;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.audit_events (tenant_id, event_type, actor_id, resource_type, resource_id, payload)
  VALUES (NEW.tenant_id, _evt, auth.uid(), 'financial_accounts', NEW.id::text,
    jsonb_build_object('name', NEW.name, 'status', NEW.status, 'currency', NEW.currency));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_financial_accounts ON public.financial_accounts;
CREATE TRIGGER trg_audit_financial_accounts
  AFTER INSERT OR UPDATE ON public.financial_accounts
  FOR EACH ROW EXECUTE FUNCTION public.audit_financial_account_status();
