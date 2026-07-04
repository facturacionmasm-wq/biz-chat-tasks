
-- (1) Update handle_new_user to auto-create a 15-day trial on Basic plan
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant_id uuid;
  _role app_role;
  _has_super boolean;
  _admin_email text;
  _user_name text;
  _basic_plan_id uuid;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO _admin_email
    FROM vault.decrypted_secrets
    WHERE name = 'admin_email'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    _admin_email := NULL;
  END;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE role = 'super_admin'
  ) INTO _has_super;

  _user_name := COALESCE(
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1)
  );

  IF _admin_email IS NOT NULL AND NEW.email = _admin_email AND NOT _has_super THEN
    _tenant_id := '00000000-0000-0000-0000-000000000001';
    _role := 'super_admin';

    INSERT INTO public.profiles (user_id, tenant_id, name, email, onboarding_completed)
    VALUES (NEW.id, _tenant_id, _user_name, NEW.email, true)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.audit_events (tenant_id, event_type, actor_id, resource_type, resource_id, payload)
    VALUES (_tenant_id, 'super_admin_role_assigned', NEW.id, 'user_roles', NEW.id::text,
      jsonb_build_object('email', NEW.email, 'role', 'super_admin', 'method', 'handle_new_user_trigger'));
  ELSE
    INSERT INTO public.tenants (name)
    VALUES (COALESCE(NULLIF(_user_name, ''), 'Mi Empresa'))
    RETURNING id INTO _tenant_id;

    _role := 'owner';

    INSERT INTO public.profiles (user_id, tenant_id, name, email, onboarding_completed)
    VALUES (NEW.id, _tenant_id, _user_name, NEW.email, false)
    ON CONFLICT (user_id) DO NOTHING;

    -- Auto-create 15-day trial on the Basic plan (idempotent)
    IF NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE tenant_id = _tenant_id) THEN
      SELECT id INTO _basic_plan_id
      FROM public.subscription_plans
      WHERE slug = 'basic'
      LIMIT 1;

      IF _basic_plan_id IS NULL THEN
        SELECT id INTO _basic_plan_id
        FROM public.subscription_plans
        ORDER BY price_monthly ASC NULLS LAST
        LIMIT 1;
      END IF;

      IF _basic_plan_id IS NOT NULL THEN
        INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, trial_ends_at)
        VALUES (_tenant_id, _basic_plan_id, 'trialing', now() + interval '15 days');
      END IF;
    END IF;
  END IF;

  INSERT INTO public.user_roles (user_id, tenant_id, role)
  VALUES (NEW.id, _tenant_id, _role)
  ON CONFLICT (user_id, tenant_id, role) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_new_user error: % %', SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$function$;

-- (2) Harden get_tenant_subscription_status: no_subscription => is_blocked=true
-- Master tenant is never blocked.
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
        'is_blocked', CASE
          WHEN p.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid THEN false
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
      'days_remaining', 0,
      'plan_slug', null,
      'plan_name', null,
      'trial_ends_at', null
    )
  );
$function$;
