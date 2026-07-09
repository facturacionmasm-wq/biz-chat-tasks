
-- 1) Reserved LOADTEST tenant (idempotent)
INSERT INTO public.tenants (id, name, settings_json)
VALUES (
  '10ad7e57-0000-4000-a000-000000000001'::uuid,
  'LOADTEST',
  jsonb_build_object(
    'loadtest', true,
    'address', 'N/A - Load Test Tenant',
    'branches', jsonb_build_array(
      jsonb_build_object(
        'id', 'br_loadtest_default',
        'name', 'LoadTest HQ',
        'address', 'N/A - Load Test',
        'maps_url', 'https://example.test/loadtest',
        'is_default', true
      )
    )
  )
)
ON CONFLICT (id) DO NOTHING;

-- 2) Ensure an active Basic subscription for LOADTEST (idempotent, non-destructive)
DO $$
DECLARE
  _basic uuid;
BEGIN
  SELECT id INTO _basic FROM public.subscription_plans WHERE slug = 'basic' LIMIT 1;
  IF _basic IS NULL THEN
    SELECT id INTO _basic FROM public.subscription_plans ORDER BY price_monthly ASC NULLS LAST LIMIT 1;
  END IF;
  IF _basic IS NOT NULL THEN
    INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status)
    VALUES ('10ad7e57-0000-4000-a000-000000000001'::uuid, _basic, 'active')
    ON CONFLICT (tenant_id) DO NOTHING;
  END IF;
END $$;

-- 3) load_test_runs table
CREATE TABLE IF NOT EXISTS public.load_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.load_test_runs TO authenticated;
GRANT ALL ON public.load_test_runs TO service_role;

ALTER TABLE public.load_test_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin can read load_test_runs" ON public.load_test_runs;
CREATE POLICY "super_admin can read load_test_runs"
  ON public.load_test_runs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

DROP TRIGGER IF EXISTS trg_load_test_runs_updated_at ON public.load_test_runs;
CREATE TRIGGER trg_load_test_runs_updated_at
  BEFORE UPDATE ON public.load_test_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_load_test_runs_started_at
  ON public.load_test_runs (started_at DESC);
