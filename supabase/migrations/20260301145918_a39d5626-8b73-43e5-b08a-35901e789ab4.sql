-- AUDITORÍA CTO: ÍNDICES DE RENDIMIENTO CRÍTICOS

-- Reminders: query principal del cron (status + remind_at)
CREATE INDEX IF NOT EXISTS idx_reminders_status_remind_at 
  ON public.reminders (status, remind_at) 
  WHERE status IN ('pending', 'failed');

-- Reminders: búsqueda por usuario
CREATE INDEX IF NOT EXISTS idx_reminders_user_tenant 
  ON public.reminders (user_id, tenant_id);

-- Appointments: búsqueda por fecha y tenant
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_start 
  ON public.appointments (tenant_id, start_at) 
  WHERE deleted_at IS NULL;

-- Appointments: búsqueda por usuario y fecha
CREATE INDEX IF NOT EXISTS idx_appointments_user_start 
  ON public.appointments (user_id, start_at) 
  WHERE deleted_at IS NULL AND status != 'cancelled';

-- WhatsApp conversations: lookup por teléfono (webhook hot path)
CREATE INDEX IF NOT EXISTS idx_wa_conversations_phone_tenant 
  ON public.whatsapp_conversations (contact_phone, tenant_id) 
  WHERE status != 'closed';

-- WhatsApp messages: mensajes recientes por conversación
CREATE INDEX IF NOT EXISTS idx_wa_messages_conv_created 
  ON public.whatsapp_messages (conversation_id, created_at DESC);

-- Knowledge items: consulta del bot
CREATE INDEX IF NOT EXISTS idx_knowledge_tenant_active 
  ON public.knowledge_items (tenant_id, active, category) 
  WHERE active = true AND deleted_at IS NULL;

-- Audit events: consulta por tenant y fecha
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created 
  ON public.audit_events (tenant_id, created_at DESC);

-- Profiles: lookup por whatsapp_number
CREATE INDEX IF NOT EXISTS idx_profiles_whatsapp_tenant 
  ON public.profiles (whatsapp_number, tenant_id) 
  WHERE whatsapp_number IS NOT NULL AND status = 'active';

-- Contacts: lookup por teléfono
CREATE INDEX IF NOT EXISTS idx_contacts_phone_tenant 
  ON public.contacts (phone, tenant_id);

-- Función helper: exponential backoff
CREATE OR REPLACE FUNCTION public.calculate_next_retry(
  _retry_count integer,
  _base_delay_minutes integer DEFAULT 5
)
RETURNS timestamp with time zone
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT now() + ((_base_delay_minutes * power(2, _retry_count)) || ' minutes')::interval;
$$;