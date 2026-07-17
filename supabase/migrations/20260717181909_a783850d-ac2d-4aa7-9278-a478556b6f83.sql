
-- ==========================================================
-- FINANZAS INTELIGENTES · Fase 1 (nivel tenant/empresa)
-- ==========================================================

-- 1) Extender contacts (reutilizado como clientes/proveedores)
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS is_customer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_supplier boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_terms_days integer;

-- 2) financial_accounts
CREATE TABLE IF NOT EXISTS public.financial_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  connection_id uuid,
  provider text NOT NULL DEFAULT 'manual',
  external_id text,
  name text NOT NULL,
  institution text,
  account_type text NOT NULL DEFAULT 'bank',
  currency text NOT NULL DEFAULT 'MXN',
  current_balance numeric(18,2) NOT NULL DEFAULT 0,
  available_balance numeric(18,2),
  status text NOT NULL DEFAULT 'manual',
  last_synced_at timestamptz,
  is_hidden boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_accounts_tenant ON public.financial_accounts(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_accounts TO authenticated;
GRANT ALL ON public.financial_accounts TO service_role;
ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fin_accounts_select" ON public.financial_accounts FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'staff'::app_role)
  );
CREATE POLICY "fin_accounts_write" ON public.financial_accounts FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  );

-- 3) financial_connections
CREATE TABLE IF NOT EXISTS public.financial_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'mock',
  institution text,
  status text NOT NULL DEFAULT 'connected',
  last_sync_at timestamptz,
  last_error text,
  credentials_encrypted text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_conn_tenant ON public.financial_connections(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_connections TO authenticated;
GRANT ALL ON public.financial_connections TO service_role;
ALTER TABLE public.financial_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fin_conn_select" ON public.financial_connections FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  );
CREATE POLICY "fin_conn_write" ON public.financial_connections FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  );

-- 4) financial_categories
CREATE TABLE IF NOT EXISTS public.financial_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'expense', -- income | expense | transfer
  color text,
  icon text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name, kind)
);
CREATE INDEX IF NOT EXISTS idx_fin_cat_tenant ON public.financial_categories(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_categories TO authenticated;
GRANT ALL ON public.financial_categories TO service_role;
ALTER TABLE public.financial_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fin_cat_select" ON public.financial_categories FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'staff'::app_role)
  );
CREATE POLICY "fin_cat_write" ON public.financial_categories FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  );

-- 5) financial_transactions
CREATE TABLE IF NOT EXISTS public.financial_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.financial_accounts(id) ON DELETE CASCADE,
  external_id text,
  posted_at timestamptz NOT NULL DEFAULT now(),
  description text NOT NULL,
  amount numeric(18,2) NOT NULL,
  currency text NOT NULL DEFAULT 'MXN',
  direction text NOT NULL DEFAULT 'debit', -- debit (out) | credit (in)
  category_id uuid REFERENCES public.financial_categories(id) ON DELETE SET NULL,
  counterparty_contact_id uuid,
  status text NOT NULL DEFAULT 'posted', -- pending | posted | reconciled | ignored
  reconciled_expense_id uuid,
  attachment_path text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_tx_tenant_date ON public.financial_transactions(tenant_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_fin_tx_account ON public.financial_transactions(account_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_transactions TO authenticated;
GRANT ALL ON public.financial_transactions TO service_role;
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fin_tx_select" ON public.financial_transactions FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'staff'::app_role)
  );
CREATE POLICY "fin_tx_write" ON public.financial_transactions FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  );

-- 6) financial_budgets + lines
CREATE TABLE IF NOT EXISTS public.financial_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  currency text NOT NULL DEFAULT 'MXN',
  total_planned numeric(18,2) NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_budgets_tenant ON public.financial_budgets(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_budgets TO authenticated;
GRANT ALL ON public.financial_budgets TO service_role;
ALTER TABLE public.financial_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fin_bud_select" ON public.financial_budgets FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'staff'::app_role)
  );
CREATE POLICY "fin_bud_write" ON public.financial_budgets FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  );

CREATE TABLE IF NOT EXISTS public.financial_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  budget_id uuid NOT NULL REFERENCES public.financial_budgets(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.financial_categories(id) ON DELETE SET NULL,
  category_name text NOT NULL,
  planned_amount numeric(18,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_budlines_budget ON public.financial_budget_lines(budget_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_budget_lines TO authenticated;
GRANT ALL ON public.financial_budget_lines TO service_role;
ALTER TABLE public.financial_budget_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fin_budline_select" ON public.financial_budget_lines FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'staff'::app_role)
  );
CREATE POLICY "fin_budline_write" ON public.financial_budget_lines FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  );

-- 7) financial_cashflow_forecasts
CREATE TABLE IF NOT EXISTS public.financial_cashflow_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  horizon_days integer NOT NULL,
  currency text NOT NULL DEFAULT 'MXN',
  opening_balance numeric(18,2) NOT NULL DEFAULT 0,
  expected_inflows numeric(18,2) NOT NULL DEFAULT 0,
  expected_outflows numeric(18,2) NOT NULL DEFAULT 0,
  projected_balance numeric(18,2) NOT NULL DEFAULT 0,
  daily_series jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_cf_tenant ON public.financial_cashflow_forecasts(tenant_id, snapshot_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_cashflow_forecasts TO authenticated;
GRANT ALL ON public.financial_cashflow_forecasts TO service_role;
ALTER TABLE public.financial_cashflow_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fin_cf_select" ON public.financial_cashflow_forecasts FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'staff'::app_role)
  );
CREATE POLICY "fin_cf_write" ON public.financial_cashflow_forecasts FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  );

-- 8) financial_health_scores
CREATE TABLE IF NOT EXISTS public.financial_health_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  score integer NOT NULL DEFAULT 0,
  liquidity_score integer NOT NULL DEFAULT 0,
  cashflow_score integer NOT NULL DEFAULT 0,
  delinquency_score integer NOT NULL DEFAULT 0,
  budget_score integer NOT NULL DEFAULT 0,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_health_tenant ON public.financial_health_scores(tenant_id, snapshot_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_health_scores TO authenticated;
GRANT ALL ON public.financial_health_scores TO service_role;
ALTER TABLE public.financial_health_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fin_health_select" ON public.financial_health_scores FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'staff'::app_role)
  );
CREATE POLICY "fin_health_write" ON public.financial_health_scores FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  );

-- 9) financial_alerts
CREATE TABLE IF NOT EXISTS public.financial_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  alert_type text NOT NULL, -- low_balance | overdue_payable | overdue_receivable | budget_exceeded | unusual_expense
  severity text NOT NULL DEFAULT 'medium',
  account_id uuid,
  budget_id uuid,
  message text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active', -- active | acknowledged | resolved
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_alerts_tenant ON public.financial_alerts(tenant_id, status, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_alerts TO authenticated;
GRANT ALL ON public.financial_alerts TO service_role;
ALTER TABLE public.financial_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fin_alerts_select" ON public.financial_alerts FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'staff'::app_role)
  );
CREATE POLICY "fin_alerts_write" ON public.financial_alerts FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
  );

-- Triggers updated_at
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'financial_accounts','financial_connections','financial_categories',
    'financial_transactions','financial_budgets','financial_budget_lines',
    'financial_alerts'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS update_%1$s_updated_at ON public.%1$s', t);
    EXECUTE format('CREATE TRIGGER update_%1$s_updated_at BEFORE UPDATE ON public.%1$s FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
  END LOOP;
END $$;

-- 10) Función consolidada
CREATE OR REPLACE FUNCTION public.compute_tenant_financial_summary(
  _tenant_id uuid,
  _period_start date DEFAULT (now() - interval '30 days')::date,
  _period_end date DEFAULT now()::date,
  _currency text DEFAULT 'MXN'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _total_balance numeric := 0;
  _inflows numeric := 0;
  _outflows numeric := 0;
  _receivables numeric := 0;
  _payables numeric := 0;
  _project_cost_total numeric := 0;
  _monthly_burn numeric := 0;
  _runway_days integer := NULL;
BEGIN
  SELECT COALESCE(SUM(current_balance),0) INTO _total_balance
  FROM public.financial_accounts
  WHERE tenant_id = _tenant_id AND is_hidden = false;

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE direction = 'credit'),0),
    COALESCE(SUM(amount) FILTER (WHERE direction = 'debit'),0)
  INTO _inflows, _outflows
  FROM public.financial_transactions
  WHERE tenant_id = _tenant_id
    AND posted_at::date BETWEEN _period_start AND _period_end;

  -- AR/AP a partir de expenses existentes (payables) + placeholder receivables
  SELECT COALESCE(SUM(amount),0) INTO _payables
  FROM public.expenses
  WHERE tenant_id = _tenant_id
    AND status IN ('pending_approval','approved')
    AND (paid_at IS NULL);

  -- Costos de obra acumulados en snapshots
  SELECT COALESCE(SUM(total_cost),0) INTO _project_cost_total
  FROM (
    SELECT DISTINCT ON (project_id) project_id, total_cost
    FROM public.project_financial_snapshots
    WHERE tenant_id = _tenant_id
    ORDER BY project_id, snapshot_at DESC
  ) s;

  -- Runway simple: si outflows > 0 en el periodo, extrapolar por día
  IF _outflows > 0 THEN
    _monthly_burn := (_outflows / GREATEST(_period_end - _period_start,1)) * 30;
    IF _monthly_burn > 0 THEN
      _runway_days := GREATEST(ROUND((_total_balance / (_monthly_burn / 30))::numeric)::int, 0);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'tenant_id', _tenant_id,
    'currency', _currency,
    'period_start', _period_start,
    'period_end', _period_end,
    'total_balance', _total_balance,
    'inflows', _inflows,
    'outflows', _outflows,
    'net_flow', _inflows - _outflows,
    'receivables', _receivables,
    'payables', _payables,
    'project_costs_accumulated', _project_cost_total,
    'monthly_burn', _monthly_burn,
    'runway_days', _runway_days
  );
END;
$$;

-- 11) Health score
CREATE OR REPLACE FUNCTION public.compute_tenant_health_score(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _summary jsonb;
  _balance numeric := 0;
  _payables numeric := 0;
  _inflows numeric := 0;
  _outflows numeric := 0;
  _runway integer;
  _liquidity int := 0;
  _cashflow int := 0;
  _delinquency int := 0;
  _budget int := 0;
  _overdue_count int := 0;
  _budget_exceeded int := 0;
  _score int;
BEGIN
  _summary := public.compute_tenant_financial_summary(_tenant_id);
  _balance := COALESCE((_summary->>'total_balance')::numeric, 0);
  _payables := COALESCE((_summary->>'payables')::numeric, 0);
  _inflows := COALESCE((_summary->>'inflows')::numeric, 0);
  _outflows := COALESCE((_summary->>'outflows')::numeric, 0);
  _runway := NULLIF(_summary->>'runway_days','')::int;

  -- Liquidez (0-25)
  IF _payables <= 0 THEN
    _liquidity := 25;
  ELSE
    _liquidity := LEAST(25, GREATEST(0, ROUND((_balance / GREATEST(_payables,1)) * 12.5)::int));
  END IF;

  -- Flujo (0-25)
  IF _inflows >= _outflows THEN
    _cashflow := 25;
  ELSIF _outflows > 0 THEN
    _cashflow := GREATEST(0, ROUND((_inflows / _outflows) * 25)::int);
  END IF;

  -- Morosidad (0-25): cuenta overdue payables
  SELECT COUNT(*) INTO _overdue_count
  FROM public.expenses
  WHERE tenant_id = _tenant_id
    AND status IN ('pending_approval','approved')
    AND paid_at IS NULL
    AND expense_date < (now() - interval '30 days')::date;
  _delinquency := GREATEST(0, 25 - LEAST(25, _overdue_count * 5));

  -- Presupuesto (0-25)
  SELECT COUNT(*) INTO _budget_exceeded
  FROM public.financial_alerts
  WHERE tenant_id = _tenant_id AND alert_type = 'budget_exceeded' AND status = 'active';
  _budget := GREATEST(0, 25 - LEAST(25, _budget_exceeded * 8));

  _score := _liquidity + _cashflow + _delinquency + _budget;

  RETURN jsonb_build_object(
    'score', _score,
    'liquidity_score', _liquidity,
    'cashflow_score', _cashflow,
    'delinquency_score', _delinquency,
    'budget_score', _budget,
    'breakdown', jsonb_build_object(
      'balance', _balance,
      'payables', _payables,
      'inflows', _inflows,
      'outflows', _outflows,
      'runway_days', _runway,
      'overdue_payables', _overdue_count,
      'budget_exceeded_count', _budget_exceeded
    )
  );
END;
$$;
