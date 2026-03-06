
-- Adaptive learning profiles for WhatsApp bot per user per tenant
CREATE TABLE public.bot_adaptive_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_phone text NOT NULL,
  
  -- Tone & personality preferences (learned from interactions)
  tone_profile jsonb NOT NULL DEFAULT '{
    "formality": "neutral",
    "verbosity": "normal",
    "emoji_level": "moderate",
    "detected_language": "es-MX"
  }'::jsonb,
  
  -- Learned default values for common actions
  learned_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Example: {"preferred_employee": "Dr. García", "default_service": "Consulta general", "preferred_time_range": "14:00-16:00"}
  
  -- Interaction patterns and habits
  interaction_patterns jsonb NOT NULL DEFAULT '{
    "frequent_actions": [],
    "active_hours": [],
    "weekly_patterns": {}
  }'::jsonb,
  
  -- Process optimizations (steps that can be skipped)
  process_shortcuts jsonb NOT NULL DEFAULT '{
    "skip_confirmations": false,
    "auto_fill_fields": {}
  }'::jsonb,
  
  -- Recent corrections and learnings (rolling window)
  recent_learnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  
  -- Stats
  interaction_count integer NOT NULL DEFAULT 0,
  positive_signals integer NOT NULL DEFAULT 0,
  negative_signals integer NOT NULL DEFAULT 0,
  last_interaction_at timestamptz,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(tenant_id, contact_phone)
);

-- RLS
ALTER TABLE public.bot_adaptive_profiles ENABLE ROW LEVEL SECURITY;

-- Service role only (bot backend)
CREATE POLICY "Service role full access on bot_adaptive_profiles"
  ON public.bot_adaptive_profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read their tenant's profiles  
CREATE POLICY "Tenant members can read adaptive profiles"
  ON public.bot_adaptive_profiles
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- Index for fast lookups
CREATE INDEX idx_bot_adaptive_profiles_tenant_phone ON public.bot_adaptive_profiles(tenant_id, contact_phone);

-- Auto-update updated_at
CREATE TRIGGER update_bot_adaptive_profiles_updated_at
  BEFORE UPDATE ON public.bot_adaptive_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
