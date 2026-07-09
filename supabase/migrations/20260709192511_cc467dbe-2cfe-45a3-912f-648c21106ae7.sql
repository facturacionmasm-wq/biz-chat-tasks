
DO $$
DECLARE
  _founder uuid := '2f5fa519-844a-4f01-8888-f1aa69ba907e';
  _count int;
  _bad_count int;
BEGIN
  SELECT count(*) INTO _count FROM public.user_roles WHERE role='super_admin';
  SELECT count(*) INTO _bad_count FROM public.user_roles WHERE role='super_admin' AND user_id <> _founder;
  IF _count <> 1 OR _bad_count > 0 THEN
    RAISE EXCEPTION 'Abort: expected exactly 1 super_admin belonging to founder %, found total=%, non-founder=%', _founder, _count, _bad_count;
  END IF;
END $$;

CREATE UNIQUE INDEX one_super_admin_only
  ON public.user_roles ((true))
  WHERE role = 'super_admin';

CREATE OR REPLACE FUNCTION public.enforce_founder_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _founder uuid := '2f5fa519-844a-4f01-8888-f1aa69ba907e';
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN
    IF NEW.role = 'super_admin' AND NEW.user_id <> _founder THEN
      RAISE EXCEPTION 'Solo el usuario fundador puede ser super_admin';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'super_admin' AND OLD.user_id = _founder THEN
      RAISE EXCEPTION 'No se puede eliminar al super_admin fundador';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.user_id = _founder AND OLD.role = 'super_admin'
       AND (NEW.user_id <> _founder OR NEW.role <> 'super_admin') THEN
      RAISE EXCEPTION 'No se puede eliminar al super_admin fundador';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_founder_super_admin_trg ON public.user_roles;
CREATE TRIGGER enforce_founder_super_admin_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.enforce_founder_super_admin();
