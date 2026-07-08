
CREATE OR REPLACE FUNCTION public.get_tenant_subscription_status(_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT jsonb_build_object(
        'status', ts.status,
        'trial_ends_at', ts.trial_ends_at,
        'plan_slug', sp.slug,
        'plan_name', sp.name,
        'stripe_subscription_id', ts.stripe_subscription_id,
        'has_paid_subscription', (ts.status = 'active' AND ts.stripe_subscription_id IS NOT NULL),
        'is_master_tenant', (p.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid),
        'is_blocked', CASE
          WHEN p.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid THEN false
          WHEN ts.status = 'active' THEN false
          WHEN ts.status = 'past_due' THEN true
          WHEN ts.status = 'blocked' THEN true
          WHEN ts.status = 'canceled' THEN true
          -- Nuevo: trial sin pago real vinculado es bloqueado (fuerza checkout)
          WHEN ts.status = 'trialing' AND ts.stripe_subscription_id IS NULL THEN true
          WHEN ts.status = 'trialing' AND ts.trial_ends_at < now() THEN true
          ELSE false
        END,
        'days_remaining', CASE
          WHEN ts.status = 'trialing' AND ts.trial_ends_at > now()
            THEN EXTRACT(DAY FROM ts.trial_ends_at - now())::int
          ELSE 0
        END
      )
      FROM public.profiles p
      JOIN public.tenant_subscriptions ts ON ts.tenant_id = p.tenant_id
      JOIN public.subscription_plans sp ON sp.id = ts.plan_id
      WHERE p.user_id = _user_id
      LIMIT 1
    ),
    jsonb_build_object(
      'status', 'no_subscription',
      'is_blocked', CASE
        WHEN (SELECT tenant_id FROM public.profiles WHERE user_id = _user_id LIMIT 1)
             = '00000000-0000-0000-0000-000000000001'::uuid THEN false
        ELSE true
      END,
      'is_master_tenant', CASE
        WHEN (SELECT tenant_id FROM public.profiles WHERE user_id = _user_id LIMIT 1)
             = '00000000-0000-0000-0000-000000000001'::uuid THEN true
        ELSE false
      END,
      'days_remaining', 0,
      'plan_slug', null,
      'plan_name', null,
      'trial_ends_at', null,
      'stripe_subscription_id', null,
      'has_paid_subscription', false
    )
  );
$function$;
