ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'unmatched'
    CHECK (reconciliation_status IN ('unmatched','suggested','auto_matched','manual_matched','duplicate','rejected')),
  ADD COLUMN IF NOT EXISTS reconciled_with_expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_confidence numeric(4,3);

CREATE INDEX IF NOT EXISTS idx_ft_recon
  ON public.financial_transactions(tenant_id, reconciliation_status);

ALTER TABLE public.financial_cashflow_forecasts
  ADD COLUMN IF NOT EXISTS assumptions jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.suggest_transaction_matches(
  _tenant_id uuid,
  _lookback_days int DEFAULT 60
)
RETURNS TABLE(
  transaction_id uuid,
  expense_id uuid,
  tx_amount numeric,
  tx_date timestamptz,
  tx_description text,
  exp_amount numeric,
  exp_date date,
  exp_description text,
  amount_delta numeric,
  day_delta int,
  desc_similarity real,
  score real,
  suggested_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT
      ft.id AS transaction_id,
      e.id  AS expense_id,
      ft.amount AS tx_amount,
      ft.posted_at AS tx_date,
      ft.description AS tx_description,
      e.amount AS exp_amount,
      e.expense_date AS exp_date,
      e.description AS exp_description,
      ABS(ft.amount - e.amount) AS amount_delta,
      ABS((ft.posted_at::date - e.expense_date))::int AS day_delta,
      COALESCE(similarity(LOWER(COALESCE(ft.description,'')), LOWER(COALESCE(e.description,''))), 0)::real AS desc_similarity
    FROM public.financial_transactions ft
    JOIN public.expenses e
      ON e.tenant_id = ft.tenant_id
     AND ABS(ft.amount - e.amount) <= GREATEST(ft.amount * 0.02, 1)
     AND ABS((ft.posted_at::date - e.expense_date)) <= 5
    WHERE ft.tenant_id = _tenant_id
      AND ft.reconciliation_status IN ('unmatched','suggested')
      AND ft.posted_at >= now() - (_lookback_days || ' days')::interval
  ),
  scored AS (
    SELECT
      c.*,
      (
        (1.0 - LEAST(c.amount_delta / GREATEST(c.tx_amount, 1), 1)) * 0.5 +
        (1.0 - LEAST(c.day_delta::real / 5.0, 1)) * 0.3 +
        c.desc_similarity * 0.2
      )::real AS score
    FROM candidates c
  )
  SELECT
    transaction_id, expense_id, tx_amount, tx_date, tx_description,
    exp_amount, exp_date, exp_description,
    amount_delta, day_delta, desc_similarity, score,
    CASE
      WHEN score >= 0.90 THEN 'auto_matched'
      WHEN score >= 0.65 THEN 'suggested'
      ELSE 'unmatched'
    END AS suggested_status
  FROM scored
  WHERE score >= 0.65
  ORDER BY transaction_id, score DESC;
$$;

REVOKE ALL ON FUNCTION public.suggest_transaction_matches(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suggest_transaction_matches(uuid, int) TO authenticated, service_role;