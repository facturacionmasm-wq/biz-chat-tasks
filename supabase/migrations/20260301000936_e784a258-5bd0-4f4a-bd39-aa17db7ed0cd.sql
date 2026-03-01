
-- Server-side function to check subscription status
-- Returns: 'active', 'trialing', 'past_due', 'blocked', 'no_subscription'
CREATE OR REPLACE FUNCTION public.get_tenant_subscription_status(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_build_object(
        'status', ts.status,
        'trial_ends_at', ts.trial_ends_at,
        'plan_slug', sp.slug,
        'plan_name', sp.name,
        'is_blocked', CASE
          WHEN ts.status = 'blocked' THEN true
          WHEN ts.status = 'canceled' THEN true
          WHEN ts.status = 'trialing' AND ts.trial_ends_at < now() THEN true
          ELSE false
        END,
        'days_remaining', CASE
          WHEN ts.status = 'trialing' AND ts.trial_ends_at > now()
            THEN EXTRACT(DAY FROM ts.trial_ends_at - now())::int
          ELSE 0
        END
      )
      FROM public.tenant_subscriptions ts
      JOIN public.subscription_plans sp ON sp.id = ts.plan_id
      WHERE ts.tenant_id = (SELECT tenant_id FROM public.profiles WHERE user_id = _user_id LIMIT 1)
      LIMIT 1
    ),
    jsonb_build_object(
      'status', 'no_subscription',
      'is_blocked', false,
      'days_remaining', 0,
      'plan_slug', null,
      'plan_name', null,
      'trial_ends_at', null
    )
  );
$$;

-- Cron-ready function to auto-block expired trials
CREATE OR REPLACE FUNCTION public.block_expired_trials()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tenant_subscriptions
  SET status = 'blocked', updated_at = now()
  WHERE status = 'trialing'
    AND trial_ends_at < now();
END;
$$;
