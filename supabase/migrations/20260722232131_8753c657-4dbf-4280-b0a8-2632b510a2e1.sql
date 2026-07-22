
-- 1) Recompute trigger to keep financial_budgets.total_planned in sync
CREATE OR REPLACE FUNCTION public.recompute_budget_total_planned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _budget_id uuid;
BEGIN
  _budget_id := COALESCE(NEW.budget_id, OLD.budget_id);
  UPDATE public.financial_budgets fb
     SET total_planned = COALESCE((
           SELECT SUM(planned_amount) FROM public.financial_budget_lines
            WHERE budget_id = _budget_id
         ), 0),
         updated_at = now()
   WHERE fb.id = _budget_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_total_planned ON public.financial_budget_lines;
CREATE TRIGGER trg_recompute_total_planned
AFTER INSERT OR UPDATE OF planned_amount OR DELETE
ON public.financial_budget_lines
FOR EACH ROW EXECUTE FUNCTION public.recompute_budget_total_planned();

-- 2) Upsert budget + lines (transactional)
CREATE OR REPLACE FUNCTION public.upsert_budget(
  _id uuid,
  _name text,
  _period_start date,
  _period_end date,
  _currency text,
  _notes text,
  _lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid;
  _budget_id uuid;
  _line jsonb;
  _cat_id uuid;
  _cat_name text;
  _amount numeric;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _period_end < _period_start THEN
    RAISE EXCEPTION 'period_end must be >= period_start';
  END IF;

  IF _id IS NULL THEN
    SELECT tenant_id INTO _tenant FROM public.profiles WHERE user_id = _caller LIMIT 1;
    IF _tenant IS NULL THEN
      RAISE EXCEPTION 'No tenant for caller';
    END IF;
    IF NOT (public.has_tenant_role(_caller, _tenant, 'owner') OR public.has_tenant_role(_caller, _tenant, 'admin')) THEN
      RAISE EXCEPTION 'Insufficient privileges' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.financial_budgets (tenant_id, name, period_start, period_end, currency, notes, created_by, total_planned)
    VALUES (_tenant, _name, _period_start, _period_end, COALESCE(_currency,'MXN'), _notes, _caller, 0)
    RETURNING id INTO _budget_id;
  ELSE
    SELECT tenant_id INTO _tenant FROM public.financial_budgets WHERE id = _id;
    IF _tenant IS NULL THEN
      RAISE EXCEPTION 'Budget not found';
    END IF;
    IF NOT (public.has_tenant_role(_caller, _tenant, 'owner') OR public.has_tenant_role(_caller, _tenant, 'admin')) THEN
      RAISE EXCEPTION 'Insufficient privileges' USING ERRCODE = '42501';
    END IF;
    UPDATE public.financial_budgets
       SET name = _name,
           period_start = _period_start,
           period_end = _period_end,
           currency = COALESCE(_currency, currency),
           notes = _notes,
           updated_at = now()
     WHERE id = _id;
    _budget_id := _id;
    DELETE FROM public.financial_budget_lines WHERE budget_id = _budget_id;
  END IF;

  IF _lines IS NOT NULL AND jsonb_typeof(_lines) = 'array' THEN
    FOR _line IN SELECT * FROM jsonb_array_elements(_lines)
    LOOP
      _cat_id := NULLIF(_line->>'category_id','')::uuid;
      _cat_name := COALESCE(NULLIF(_line->>'category_name',''), 'Sin categoría');
      _amount := COALESCE((_line->>'planned_amount')::numeric, 0);
      IF _amount < 0 THEN
        RAISE EXCEPTION 'planned_amount must be >= 0';
      END IF;
      INSERT INTO public.financial_budget_lines
        (tenant_id, budget_id, category_id, category_name, planned_amount, notes)
      VALUES
        (_tenant, _budget_id, _cat_id, _cat_name, _amount, NULLIF(_line->>'notes',''));
    END LOOP;
  END IF;

  INSERT INTO public.audit_events (tenant_id, event_type, actor_id, resource_type, resource_id, payload)
  VALUES (_tenant, CASE WHEN _id IS NULL THEN 'budget_created' ELSE 'budget_updated' END,
          _caller, 'financial_budgets', _budget_id::text,
          jsonb_build_object('name', _name, 'period', jsonb_build_object('start', _period_start, 'end', _period_end)));

  RETURN jsonb_build_object('ok', true, 'budget_id', _budget_id);
END;
$$;

-- 3) Delete budget
CREATE OR REPLACE FUNCTION public.delete_budget(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_id INTO _tenant FROM public.financial_budgets WHERE id = _id;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'Budget not found';
  END IF;
  IF NOT (public.has_tenant_role(_caller, _tenant, 'owner') OR public.has_tenant_role(_caller, _tenant, 'admin')) THEN
    RAISE EXCEPTION 'Insufficient privileges' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.financial_budgets WHERE id = _id;

  INSERT INTO public.audit_events (tenant_id, event_type, actor_id, resource_type, resource_id, payload)
  VALUES (_tenant, 'budget_deleted', _caller, 'financial_budgets', _id::text, '{}'::jsonb);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 4) Compute actuals: planned vs real per line + totals
CREATE OR REPLACE FUNCTION public.compute_budget_actuals(_budget_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _b record;
  _lines jsonb;
  _total_planned numeric := 0;
  _total_actual numeric := 0;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id, name, period_start, period_end, currency, total_planned
    INTO _b
    FROM public.financial_budgets WHERE id = _budget_id;
  IF _b.id IS NULL THEN
    RAISE EXCEPTION 'Budget not found';
  END IF;
  IF NOT (
    public.has_tenant_role(_caller, _b.tenant_id, 'owner') OR
    public.has_tenant_role(_caller, _b.tenant_id, 'admin') OR
    public.has_tenant_role(_caller, _b.tenant_id, 'staff')
  ) THEN
    RAISE EXCEPTION 'Insufficient privileges' USING ERRCODE = '42501';
  END IF;

  WITH line_data AS (
    SELECT
      bl.id AS line_id,
      bl.category_id,
      bl.category_name,
      bl.planned_amount,
      COALESCE((
        SELECT SUM(e.amount)
          FROM public.expenses e
         WHERE e.tenant_id = _b.tenant_id
           AND e.expense_date BETWEEN _b.period_start AND _b.period_end
           AND (
             (bl.category_id IS NOT NULL AND e.category_id = bl.category_id)
             OR (bl.category_id IS NULL AND lower(coalesce(e.category,'')) = lower(bl.category_name))
           )
           AND e.status IN ('approved','paid')
      ), 0) AS actual_amount
    FROM public.financial_budget_lines bl
    WHERE bl.budget_id = _budget_id
  )
  SELECT
    COALESCE(SUM(planned_amount), 0),
    COALESCE(SUM(actual_amount), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'line_id', line_id,
      'category_id', category_id,
      'category_name', category_name,
      'planned_amount', planned_amount,
      'actual_amount', actual_amount,
      'variance', planned_amount - actual_amount,
      'variance_pct', CASE WHEN planned_amount > 0
                           THEN ROUND(((actual_amount / planned_amount) * 100)::numeric, 2)
                           ELSE NULL END,
      'status', CASE
                  WHEN planned_amount <= 0 THEN 'ok'
                  WHEN actual_amount > planned_amount THEN 'over'
                  WHEN actual_amount >= planned_amount * 0.9 THEN 'warning'
                  WHEN actual_amount >= planned_amount * 0.7 THEN 'watch'
                  ELSE 'ok'
                END
    ) ORDER BY planned_amount DESC), '[]'::jsonb)
  INTO _total_planned, _total_actual, _lines
  FROM line_data;

  RETURN jsonb_build_object(
    'budget_id', _b.id,
    'name', _b.name,
    'currency', _b.currency,
    'period_start', _b.period_start,
    'period_end', _b.period_end,
    'total_planned', _total_planned,
    'total_actual', _total_actual,
    'total_variance', _total_planned - _total_actual,
    'total_variance_pct', CASE WHEN _total_planned > 0
                               THEN ROUND(((_total_actual / _total_planned) * 100)::numeric, 2)
                               ELSE NULL END,
    'overall_status', CASE
                        WHEN _total_planned <= 0 THEN 'ok'
                        WHEN _total_actual > _total_planned THEN 'over'
                        WHEN _total_actual >= _total_planned * 0.9 THEN 'warning'
                        WHEN _total_actual >= _total_planned * 0.7 THEN 'watch'
                        ELSE 'ok'
                      END,
    'lines', _lines
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_budget(uuid,text,date,date,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_budget(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_budget_actuals(uuid) TO authenticated;
