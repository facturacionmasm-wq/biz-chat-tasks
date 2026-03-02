
-- 1. Unique partial index on external_call_id for idempotency
-- Only enforced for non-null, non-deleted records
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_records_ext_call_id_unique 
ON public.call_records (external_call_id) 
WHERE external_call_id IS NOT NULL AND deleted_at IS NULL;

-- 2. Call sessions table for tracking agent routing state
CREATE TABLE IF NOT EXISTS public.call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  call_record_id uuid NOT NULL REFERENCES public.call_records(id) ON DELETE CASCADE,
  call_sid text NOT NULL,
  agent_mode text NOT NULL DEFAULT 'elevenlabs',
  elevenlabs_agent_id text,
  voice_id text,
  language text DEFAULT 'es',
  routing_method text NOT NULL DEFAULT 'stream',
  target_url text,
  state text NOT NULL DEFAULT 'routing_to_agent',
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(call_sid)
);

ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;

-- RLS: Tenant users can view their call sessions
CREATE POLICY "Tenant users can view call sessions"
ON public.call_sessions FOR SELECT
TO authenticated
USING (tenant_id = get_user_tenant_id(auth.uid()));

-- RLS: Admins can manage call sessions
CREATE POLICY "Admins can manage call sessions"
ON public.call_sessions FOR ALL
TO authenticated
USING (
  has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role) OR
  has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role) OR
  has_role(auth.uid(), 'super_admin'::app_role)
);

-- Enable realtime for call_sessions
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_sessions;

-- Trigger for updated_at
CREATE TRIGGER set_call_sessions_updated_at
  BEFORE UPDATE ON public.call_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
