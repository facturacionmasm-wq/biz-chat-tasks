
-- Extend projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS contract_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS contract_currency text NOT NULL DEFAULT 'MXN',
  ADD COLUMN IF NOT EXISTS estimated_duration_days integer,
  ADD COLUMN IF NOT EXISTS physical_progress_pct numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS target_margin_pct numeric(5,2) NOT NULL DEFAULT 20;

-- ============ project_costs ============
CREATE TABLE IF NOT EXISTS public.project_costs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('materials','labor','equipment','subcontracts','overhead','contingency')),
  cost_type text NOT NULL CHECK (cost_type IN ('fixed','variable')),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'MXN',
  cost_date date NOT NULL DEFAULT CURRENT_DATE,
  description text,
  attachment_path text,
  attachment_name text,
  created_by uuid NOT NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pc_project ON public.project_costs(project_id, cost_date);
CREATE INDEX IF NOT EXISTS idx_pc_tenant ON public.project_costs(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_costs TO authenticated;
GRANT ALL ON public.project_costs TO service_role;

ALTER TABLE public.project_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pc_select_tenant_scope" ON public.project_costs
FOR SELECT TO authenticated USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
    OR public.is_project_member(auth.uid(), project_id)
  )
);

CREATE POLICY "pc_insert_members_or_admins" ON public.project_costs
FOR INSERT TO authenticated WITH CHECK (
  created_by = auth.uid()
  AND tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
    OR public.is_project_member(auth.uid(), project_id)
  )
);

CREATE POLICY "pc_update_author_or_admin" ON public.project_costs
FOR UPDATE TO authenticated USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    created_by = auth.uid()
    OR public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
  )
);

CREATE POLICY "pc_delete_author_or_admin" ON public.project_costs
FOR DELETE TO authenticated USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    created_by = auth.uid()
    OR public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
  )
);

CREATE TRIGGER trg_pc_updated
BEFORE UPDATE ON public.project_costs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ project_financial_snapshots ============
CREATE TABLE IF NOT EXISTS public.project_financial_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  total_fixed numeric(14,2) NOT NULL DEFAULT 0,
  total_variable numeric(14,2) NOT NULL DEFAULT 0,
  total_cost numeric(14,2) NOT NULL DEFAULT 0,
  break_even_amount numeric(14,2),
  break_even_progress_pct numeric(6,2),
  recommended_min_price numeric(14,2),
  projected_total_cost numeric(14,2),
  projected_profit numeric(14,2),
  projected_overrun numeric(14,2),
  cost_performance_index numeric(6,3),
  physical_progress_pct numeric(5,2),
  contract_amount numeric(14,2),
  ai_summary text,
  alerts jsonb NOT NULL DEFAULT '[]'::jsonb,
  trigger_source text
);

CREATE INDEX IF NOT EXISTS idx_pfs_project ON public.project_financial_snapshots(project_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_pfs_tenant ON public.project_financial_snapshots(tenant_id);

GRANT SELECT, INSERT ON public.project_financial_snapshots TO authenticated;
GRANT ALL ON public.project_financial_snapshots TO service_role;

ALTER TABLE public.project_financial_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pfs_select_tenant_scope" ON public.project_financial_snapshots
FOR SELECT TO authenticated USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
    OR public.is_project_member(auth.uid(), project_id)
  )
);

-- No INSERT policy for authenticated: snapshots are written by the edge function using service_role.

-- ============ compute_project_financials ============
CREATE OR REPLACE FUNCTION public.compute_project_financials(_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _p record;
  _total_fixed numeric := 0;
  _total_variable numeric := 0;
  _total_cost numeric := 0;
  _break_even numeric;
  _break_even_pct numeric;
  _min_price numeric;
  _projected_total numeric;
  _projected_profit numeric;
  _projected_overrun numeric;
  _cpi numeric;
  _alerts jsonb := '[]'::jsonb;
BEGIN
  SELECT id, tenant_id, contract_amount, contract_currency,
         physical_progress_pct, target_margin_pct
  INTO _p
  FROM public.projects WHERE id = _project_id;

  IF _p.id IS NULL THEN
    RETURN jsonb_build_object('error','project_not_found');
  END IF;

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE cost_type = 'fixed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE cost_type = 'variable'), 0)
  INTO _total_fixed, _total_variable
  FROM public.project_costs
  WHERE project_id = _project_id;

  _total_cost := _total_fixed + _total_variable;
  _break_even := _total_cost;

  IF _p.contract_amount IS NOT NULL AND _p.contract_amount > 0 THEN
    _break_even_pct := ROUND((_break_even / _p.contract_amount) * 100, 2);
  END IF;

  IF _p.target_margin_pct IS NOT NULL AND _p.target_margin_pct < 100 THEN
    _min_price := ROUND(_total_cost / (1 - (_p.target_margin_pct / 100.0)), 2);
  END IF;

  IF _p.physical_progress_pct IS NOT NULL AND _p.physical_progress_pct > 0 THEN
    _projected_total := ROUND(_total_cost / (_p.physical_progress_pct / 100.0), 2);
    IF _p.contract_amount IS NOT NULL AND _p.contract_amount > 0 THEN
      _cpi := ROUND(((_total_cost / _p.contract_amount) / (_p.physical_progress_pct / 100.0))::numeric, 3);
    END IF;
  ELSE
    _projected_total := _total_cost;
  END IF;

  IF _p.contract_amount IS NOT NULL THEN
    _projected_profit := _p.contract_amount - _projected_total;
    IF _projected_total > _p.contract_amount THEN
      _projected_overrun := _projected_total - _p.contract_amount;
      _alerts := _alerts || jsonb_build_object(
        'code','overrun',
        'severity','high',
        'message', 'Sobrecosto proyectado de ' || _projected_overrun::text
      );
    END IF;
    IF _min_price IS NOT NULL AND _min_price > _p.contract_amount THEN
      _alerts := _alerts || jsonb_build_object(
        'code','margin_below_target',
        'severity','medium',
        'message','El precio contratado no alcanza el margen objetivo'
      );
    END IF;
    IF _break_even_pct IS NOT NULL AND _p.physical_progress_pct IS NOT NULL
       AND _break_even_pct >= _p.physical_progress_pct THEN
      _alerts := _alerts || jsonb_build_object(
        'code','break_even_reached',
        'severity','medium',
        'message','Punto de equilibrio alcanzado o superado al avance actual'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'tenant_id', _p.tenant_id,
    'project_id', _p.id,
    'contract_amount', _p.contract_amount,
    'contract_currency', _p.contract_currency,
    'physical_progress_pct', _p.physical_progress_pct,
    'target_margin_pct', _p.target_margin_pct,
    'total_fixed', _total_fixed,
    'total_variable', _total_variable,
    'total_cost', _total_cost,
    'break_even_amount', _break_even,
    'break_even_progress_pct', _break_even_pct,
    'recommended_min_price', _min_price,
    'projected_total_cost', _projected_total,
    'projected_profit', _projected_profit,
    'projected_overrun', _projected_overrun,
    'cost_performance_index', _cpi,
    'alerts', _alerts
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_project_financials(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_project_financials(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) TO authenticated, service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.project_costs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_financial_snapshots;
