
-- VIP fields on contacts
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS is_vip boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vip_tier text,
  ADD COLUMN IF NOT EXISTS vip_notes text;

-- support_tickets
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'manual',
  subject text NOT NULL,
  description text,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'open',
  assigned_to uuid,
  created_by uuid,
  ai_summary text,
  sentiment_score numeric,
  tags text[] DEFAULT ARRAY[]::text[],
  source_conversation_id uuid,
  source_call_id uuid,
  sla_first_response_at timestamptz,
  sla_resolution_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant ON public.support_tickets(tenant_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned ON public.support_tickets(assigned_to);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read tickets" ON public.support_tickets
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Tenant members insert tickets" ON public.support_tickets
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Tenant staff/admin/owner update tickets" ON public.support_tickets
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'owner')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'staff')
      OR assigned_to = auth.uid()
    )
  );
CREATE POLICY "Owners delete tickets" ON public.support_tickets
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_tenant_role(auth.uid(), tenant_id, 'owner') OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'))
  );

CREATE TRIGGER trg_support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ticket_messages
CREATE TABLE IF NOT EXISTS public.ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  author_type text NOT NULL DEFAULT 'agent',
  author_id uuid,
  body text NOT NULL,
  is_internal_note boolean NOT NULL DEFAULT false,
  attachments jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON public.ticket_messages(ticket_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_messages TO authenticated;
GRANT ALL ON public.ticket_messages TO service_role;
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read ticket messages" ON public.ticket_messages
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Tenant members insert ticket messages" ON public.ticket_messages
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

-- ticket_events
CREATE TABLE IF NOT EXISTS public.ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_id uuid,
  event_type text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket ON public.ticket_events(ticket_id, created_at);
GRANT SELECT, INSERT ON public.ticket_events TO authenticated;
GRANT ALL ON public.ticket_events TO service_role;
ALTER TABLE public.ticket_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read ticket events" ON public.ticket_events
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Tenant members insert ticket events" ON public.ticket_events
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

-- platform_support_channels (tenant ↔ super admin)
CREATE TABLE IF NOT EXISTS public.platform_support_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'normal',
  last_tenant_message_at timestamptz,
  last_admin_message_at timestamptz,
  unread_for_admin int NOT NULL DEFAULT 0,
  unread_for_tenant int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.platform_support_channels TO authenticated;
GRANT ALL ON public.platform_support_channels TO service_role;
ALTER TABLE public.platform_support_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant reads own platform channel" ON public.platform_support_channels
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );
CREATE POLICY "Tenant/super_admin insert platform channel" ON public.platform_support_channels
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );
CREATE POLICY "Tenant/super_admin update platform channel" ON public.platform_support_channels
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE TRIGGER trg_platform_support_channels_updated_at
  BEFORE UPDATE ON public.platform_support_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- platform_support_messages
CREATE TABLE IF NOT EXISTS public.platform_support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.platform_support_channels(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  author_id uuid,
  author_role text NOT NULL DEFAULT 'tenant',
  body text NOT NULL,
  attachments jsonb DEFAULT '[]'::jsonb,
  read_by_admin_at timestamptz,
  read_by_tenant_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_support_msgs_channel ON public.platform_support_messages(channel_id, created_at);
GRANT SELECT, INSERT, UPDATE ON public.platform_support_messages TO authenticated;
GRANT ALL ON public.platform_support_messages TO service_role;
ALTER TABLE public.platform_support_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant/super_admin read platform messages" ON public.platform_support_messages
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );
CREATE POLICY "Tenant/super_admin insert platform messages" ON public.platform_support_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );
CREATE POLICY "Tenant/super_admin update platform messages" ON public.platform_support_messages
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_support_channels;
ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_support_messages;
