
-- Financial projections table
CREATE TABLE public.financial_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projection_date date NOT NULL DEFAULT CURRENT_DATE,
  horizon_days integer NOT NULL, -- 30, 60, or 90
  projected_revenue numeric NOT NULL DEFAULT 0,
  projected_cost numeric NOT NULL DEFAULT 0,
  projected_margin numeric NOT NULL DEFAULT 0,
  projected_margin_pct numeric NOT NULL DEFAULT 0,
  projected_calls integer NOT NULL DEFAULT 0,
  projected_minutes numeric NOT NULL DEFAULT 0,
  confidence_score numeric NOT NULL DEFAULT 0, -- 0-1
  risk_factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  opportunities jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_narrative text,
  model_version text NOT NULL DEFAULT 'v1',
  input_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.financial_projections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages projections"
  ON public.financial_projections FOR ALL
  USING (true);

CREATE POLICY "Super admins can view projections"
  ON public.financial_projections FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- Index for fast lookups
CREATE INDEX idx_financial_projections_date ON public.financial_projections(projection_date DESC);
CREATE INDEX idx_financial_projections_horizon ON public.financial_projections(horizon_days);
