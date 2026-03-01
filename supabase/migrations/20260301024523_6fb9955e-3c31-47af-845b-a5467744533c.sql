
-- Assistant conversations table
CREATE TABLE public.assistant_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  title text DEFAULT 'Nueva conversación',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.assistant_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own conversations"
  ON public.assistant_conversations FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Assistant messages table
CREATE TABLE public.assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.assistant_conversations(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'user',
  content text NOT NULL DEFAULT '',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own messages"
  ON public.assistant_messages FOR ALL TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM public.assistant_conversations WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM public.assistant_conversations WHERE user_id = auth.uid()
    )
  );

-- Admin view policy: super_admin/owner/admin can view all conversations in their tenant
CREATE POLICY "Admins can view tenant conversations"
  ON public.assistant_conversations FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id(auth.uid()) AND (
      has_tenant_role(auth.uid(), tenant_id, 'super_admin') OR
      has_tenant_role(auth.uid(), tenant_id, 'owner') OR
      has_tenant_role(auth.uid(), tenant_id, 'admin')
    )
  );

CREATE POLICY "Admins can view tenant messages"
  ON public.assistant_messages FOR SELECT TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM public.assistant_conversations
      WHERE tenant_id = get_user_tenant_id(auth.uid()) AND (
        has_tenant_role(auth.uid(), tenant_id, 'super_admin') OR
        has_tenant_role(auth.uid(), tenant_id, 'owner') OR
        has_tenant_role(auth.uid(), tenant_id, 'admin')
      )
    )
  );

-- Assistant settings per tenant
CREATE TABLE public.assistant_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) UNIQUE,
  autonomy_level text NOT NULL DEFAULT 'guided',
  auto_execute boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  custom_instructions text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.assistant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage assistant settings"
  ON public.assistant_settings FOR ALL TO authenticated
  USING (
    tenant_id = get_user_tenant_id(auth.uid()) AND (
      has_tenant_role(auth.uid(), tenant_id, 'super_admin') OR
      has_tenant_role(auth.uid(), tenant_id, 'owner') OR
      has_tenant_role(auth.uid(), tenant_id, 'admin')
    )
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id(auth.uid()) AND (
      has_tenant_role(auth.uid(), tenant_id, 'super_admin') OR
      has_tenant_role(auth.uid(), tenant_id, 'owner') OR
      has_tenant_role(auth.uid(), tenant_id, 'admin')
    )
  );

-- Trigger for updated_at
CREATE TRIGGER update_assistant_conversations_updated_at
  BEFORE UPDATE ON public.assistant_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_assistant_settings_updated_at
  BEFORE UPDATE ON public.assistant_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
