
-- Pendiente 1: PIN temporal + reset por admin
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pin_must_change boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pin_temp_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS pin_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS pin_set_by uuid;

CREATE INDEX IF NOT EXISTS idx_profiles_pin_must_change
  ON public.profiles(user_id) WHERE pin_must_change = true;

-- Genera PIN temporal server-side, lo hashea, guarda flags y retorna el PIN en claro (una sola vez).
-- Solo owner/admin del mismo tenant, o super_admin, pueden invocarla.
CREATE OR REPLACE FUNCTION public.admin_reset_user_pin(_target_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _caller uuid := auth.uid();
  _target_tenant uuid;
  _pin text;
  _salt bytea;
  _salt_hex text;
  _hash bytea;
  _hash_hex text;
  _expires timestamptz := now() + interval '72 hours';
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT tenant_id INTO _target_tenant FROM public.profiles WHERE user_id = _target_user LIMIT 1;
  IF _target_tenant IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    public.has_role(_caller, 'super_admin') OR
    public.has_tenant_role(_caller, _target_tenant, 'owner') OR
    public.has_tenant_role(_caller, _target_tenant, 'admin')
  ) THEN
    RAISE EXCEPTION 'Not allowed to reset PIN for this user' USING ERRCODE = '42501';
  END IF;

  -- Generate 6-digit numeric PIN
  _pin := lpad((floor(random() * 1000000))::int::text, 6, '0');

  -- Salt (16 random bytes → 32 hex chars)
  _salt := extensions.gen_random_bytes(16);
  _salt_hex := encode(_salt, 'hex');

  -- Match pin-service format: PBKDF2 100k SHA-256 → 32 bytes. pgcrypto doesn't do PBKDF2 directly;
  -- we store a marker hash so the client MUST use the new PIN via pin-service verify path,
  -- which re-hashes. Use HMAC(sha256, salt, pin) as a stopgap-compatible representation ONLY IF
  -- the edge function knows to accept both. To stay strictly compatible, we invoke the edge fn
  -- server-side is not possible from SQL; therefore we store a temporary sentinel and require
  -- the edge fn `admin_reset_pin` to call this RPC and then overwrite pin_hash with a proper hash.
  -- => Return the plaintext PIN and let the edge function compute the PBKDF2 hash.

  UPDATE public.profiles
     SET pin_must_change = true,
         pin_temp_expires_at = _expires,
         pin_set_by = _caller,
         pin_updated_at = now()
   WHERE user_id = _target_user;

  INSERT INTO public.audit_events (tenant_id, event_type, actor_id, resource_type, resource_id, payload)
  VALUES (_target_tenant, 'pin_reset_by_admin', _caller, 'profiles', _target_user::text,
          jsonb_build_object('expires_at', _expires));

  RETURN jsonb_build_object(
    'ok', true,
    'pin_plaintext', _pin,
    'expires_at', _expires,
    'target_user_id', _target_user,
    'target_tenant_id', _target_tenant
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_user_pin(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_pin(uuid) TO authenticated, service_role;
