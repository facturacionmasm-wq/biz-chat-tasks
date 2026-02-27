
-- ============================
-- ROLES ENUM & USER ROLES TABLE
-- ============================
CREATE TYPE public.app_role AS ENUM ('super_admin', 'owner', 'admin', 'staff', 'partner', 'guest');

-- ============================
-- TENANTS
-- ============================
CREATE TABLE public.tenants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
  settings_json JSONB DEFAULT '{}'::jsonb,
  whatsapp_config JSONB DEFAULT NULL,
  elevenlabs_config JSONB DEFAULT NULL,
  google_calendar_config JSONB DEFAULT NULL,
  notification_rules JSONB DEFAULT '{"unread_delay_minutes": 15, "max_per_hour": 3, "quiet_start": "22:00", "quiet_end": "08:00"}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- ============================
-- PROFILES
-- ============================
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  whatsapp_number TEXT,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============================
-- USER ROLES (separate table as required)
-- ============================
CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'staff',
  permissions_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ============================
-- SECURITY DEFINER FUNCTIONS
-- ============================
CREATE OR REPLACE FUNCTION public.get_user_tenant_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.profiles WHERE user_id = _user_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.has_tenant_role(_user_id UUID, _tenant_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND tenant_id = _tenant_id AND role = _role
  )
$$;

-- ============================
-- CALL RECORDS
-- ============================
CREATE TABLE public.call_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  external_call_id TEXT,
  from_number TEXT,
  to_number TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  channel TEXT DEFAULT 'phone',
  tags TEXT[] DEFAULT '{}',
  agent_user_id UUID,
  transcript TEXT,
  transcript_language TEXT,
  transcript_confidence NUMERIC,
  audio_url TEXT,
  summary_system TEXT,
  summary_human TEXT,
  summary_version INTEGER DEFAULT 1,
  extracted_data JSONB DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
ALTER TABLE public.call_records ENABLE ROW LEVEL SECURITY;

-- ============================
-- APPOINTMENTS
-- ============================
CREATE TABLE public.appointments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID,
  contact_name TEXT NOT NULL,
  contact_phone TEXT,
  contact_email TEXT,
  service_type TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  calendar_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  source TEXT DEFAULT 'app',
  notes TEXT,
  call_record_id UUID REFERENCES public.call_records(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- ============================
-- WHATSAPP CONVERSATIONS
-- ============================
CREATE TABLE public.whatsapp_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  contact_phone TEXT NOT NULL,
  contact_name TEXT,
  assigned_user_id UUID,
  status TEXT NOT NULL DEFAULT 'open',
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;

-- ============================
-- WHATSAPP MESSAGES
-- ============================
CREATE TABLE public.whatsapp_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  conversation_id UUID REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE NOT NULL,
  direction TEXT NOT NULL DEFAULT 'in',
  body TEXT,
  media_url TEXT,
  template_id TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- ============================
-- KNOWLEDGE ITEMS
-- ============================
CREATE TABLE public.knowledge_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'internal',
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  category TEXT,
  tags TEXT[] DEFAULT '{}',
  version INTEGER DEFAULT 1,
  active BOOLEAN DEFAULT true,
  author_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
ALTER TABLE public.knowledge_items ENABLE ROW LEVEL SECURITY;

-- ============================
-- OTP CHALLENGES
-- ============================
CREATE TABLE public.otp_challenges (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.otp_challenges ENABLE ROW LEVEL SECURITY;

-- ============================
-- INTERNAL MESSAGES
-- ============================
CREATE TABLE public.internal_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  channel_id TEXT,
  sender_id UUID NOT NULL,
  body TEXT NOT NULL,
  attachments JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.internal_messages ENABLE ROW LEVEL SECURITY;

-- Enable realtime for internal messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.internal_messages;

-- ============================
-- MESSAGE READ RECEIPTS
-- ============================
CREATE TABLE public.message_read_receipts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID REFERENCES public.internal_messages(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);
ALTER TABLE public.message_read_receipts ENABLE ROW LEVEL SECURITY;

-- ============================
-- AUDIT EVENTS
-- ============================
CREATE TABLE public.audit_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  actor_id UUID,
  event_type TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- ============================
-- AVAILABILITY RULES (for smart scheduling)
-- ============================
CREATE TABLE public.availability_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID,
  day_of_week INTEGER NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  buffer_before INTEGER DEFAULT 0,
  buffer_after INTEGER DEFAULT 0,
  max_appointments INTEGER DEFAULT 10,
  service_type TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.availability_rules ENABLE ROW LEVEL SECURITY;

-- ============================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Apply updated_at triggers
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_call_records_updated_at BEFORE UPDATE ON public.call_records FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_whatsapp_conversations_updated_at BEFORE UPDATE ON public.whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_knowledge_items_updated_at BEFORE UPDATE ON public.knowledge_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================
-- RLS POLICIES
-- ============================

-- Tenants: users can see their own tenant
CREATE POLICY "Users can view own tenant" ON public.tenants
  FOR SELECT TO authenticated
  USING (id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Owners can update tenant" ON public.tenants
  FOR UPDATE TO authenticated
  USING (public.has_tenant_role(auth.uid(), id, 'owner'));

-- Profiles: users in same tenant can see each other
CREATE POLICY "Users can view tenant profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- User Roles: same tenant visibility
CREATE POLICY "Users can view tenant roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'owner'));

-- Call Records: tenant isolation
CREATE POLICY "Tenant users can view calls" ON public.call_records
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Staff can create calls" ON public.call_records
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Staff can update calls" ON public.call_records
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- Appointments: tenant isolation
CREATE POLICY "Tenant users can view appointments" ON public.appointments
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Staff can manage appointments" ON public.appointments
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- WhatsApp Conversations: tenant isolation
CREATE POLICY "Tenant users can view wa conversations" ON public.whatsapp_conversations
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Staff can manage wa conversations" ON public.whatsapp_conversations
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- WhatsApp Messages: tenant isolation
CREATE POLICY "Tenant users can view wa messages" ON public.whatsapp_messages
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Staff can create wa messages" ON public.whatsapp_messages
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

-- Knowledge Items: tenant + visibility
CREATE POLICY "Tenant users can view knowledge" ON public.knowledge_items
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND active = true);

CREATE POLICY "Admins can manage knowledge" ON public.knowledge_items
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_tenant_role(auth.uid(), tenant_id, 'admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'owner')));

-- OTP Challenges: service role only (edge functions)
CREATE POLICY "Service role manages OTP" ON public.otp_challenges
  FOR ALL TO service_role
  USING (true);

-- Internal Messages: tenant isolation
CREATE POLICY "Tenant users can view messages" ON public.internal_messages
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can send messages" ON public.internal_messages
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND sender_id = auth.uid());

-- Message Read Receipts
CREATE POLICY "Users can manage own receipts" ON public.message_read_receipts
  FOR ALL TO authenticated
  USING (user_id = auth.uid());

-- Audit Events: tenant read, service write
CREATE POLICY "Admins can view audit" ON public.audit_events
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND (public.has_tenant_role(auth.uid(), tenant_id, 'admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'owner')));

CREATE POLICY "Service role writes audit" ON public.audit_events
  FOR INSERT TO service_role
  WITH CHECK (true);

-- Availability Rules: tenant isolation
CREATE POLICY "Tenant users can view availability" ON public.availability_rules
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can manage own availability" ON public.availability_rules
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND (user_id = auth.uid() OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')));

-- ============================
-- INDEXES
-- ============================
CREATE INDEX idx_profiles_tenant ON public.profiles(tenant_id);
CREATE INDEX idx_profiles_user ON public.profiles(user_id);
CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX idx_user_roles_tenant ON public.user_roles(tenant_id);
CREATE INDEX idx_call_records_tenant ON public.call_records(tenant_id);
CREATE INDEX idx_call_records_started ON public.call_records(started_at DESC);
CREATE INDEX idx_appointments_tenant ON public.appointments(tenant_id);
CREATE INDEX idx_appointments_start ON public.appointments(start_at);
CREATE INDEX idx_wa_conversations_tenant ON public.whatsapp_conversations(tenant_id);
CREATE INDEX idx_wa_messages_conversation ON public.whatsapp_messages(conversation_id);
CREATE INDEX idx_knowledge_items_tenant ON public.knowledge_items(tenant_id);
CREATE INDEX idx_internal_messages_tenant ON public.internal_messages(tenant_id);
CREATE INDEX idx_internal_messages_channel ON public.internal_messages(channel_id);
CREATE INDEX idx_audit_events_tenant ON public.audit_events(tenant_id);
CREATE INDEX idx_audit_events_created ON public.audit_events(created_at DESC);
CREATE INDEX idx_otp_phone ON public.otp_challenges(phone, expires_at);
