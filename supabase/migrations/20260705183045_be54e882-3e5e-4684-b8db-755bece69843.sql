-- 1) Backfill: give every non-master tenant without a subscription a fresh 15-day trial on Basic
INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, trial_ends_at)
SELECT t.id,
       (SELECT id FROM public.subscription_plans WHERE slug = 'basic' LIMIT 1),
       'trialing',
       now() + interval '15 days'
FROM public.tenants t
WHERE t.id <> '00000000-0000-0000-0000-000000000001'::uuid
  AND NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions ts WHERE ts.tenant_id = t.id);

-- 2) Security-definer RPC so the onboarding flow can activate a trial for the caller's tenant
CREATE OR REPLACE FUNCTION public.activate_trial_for_current_user(_plan_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _tenant uuid;
  _plan uuid;
  _trial_end timestamptz := now() + interval '15 days';
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT tenant_id INTO _tenant FROM public.profiles WHERE user_id = _uid LIMIT 1;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant for current user';
  END IF;

  _plan := _plan_id;
  IF _plan IS NULL THEN
    SELECT id INTO _plan FROM public.subscription_plans WHERE slug = 'basic' LIMIT 1;
  END IF;
  IF _plan IS NULL THEN
    SELECT id INTO _plan FROM public.subscription_plans ORDER BY price_monthly ASC NULLS LAST LIMIT 1;
  END IF;

  INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
  VALUES (_tenant, _plan, 'trialing', _trial_end, now(), _trial_end)
  ON CONFLICT (tenant_id) DO UPDATE
    SET plan_id = EXCLUDED.plan_id,
        status = CASE
          WHEN public.tenant_subscriptions.status IN ('active','past_due') THEN public.tenant_subscriptions.status
          ELSE 'trialing'
        END,
        trial_ends_at = CASE
          WHEN public.tenant_subscriptions.status IN ('active','past_due') THEN public.tenant_subscriptions.trial_ends_at
          ELSE EXCLUDED.trial_ends_at
        END,
        updated_at = now();

  RETURN jsonb_build_object('ok', true, 'tenant_id', _tenant, 'plan_id', _plan, 'trial_ends_at', _trial_end);
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_trial_for_current_user(uuid) TO authenticated;