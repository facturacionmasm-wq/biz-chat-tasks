import { useState, useCallback } from 'react';
import { Database, Shield, Zap, FileCode, Copy, Check, ChevronDown, ChevronRight, Search, FileDown } from 'lucide-react';
import { toast } from 'sonner';

/* ─────────────────────────────── DATA ─────────────────────────────── */

interface Column { name: string; type: string; nullable: boolean; default_val: string | null; }
interface RlsPolicy { name: string; command: string; using?: string; check?: string; }
interface ForeignKey { column: string; ref_table: string; ref_column: string; }
interface TableDoc { name: string; description: string; columns: Column[]; rls: RlsPolicy[]; fks: ForeignKey[]; blockedActions?: string[]; }

const tables: TableDoc[] = [
  {
    name: 'tenants',
    description: 'Entidad raíz multi-tenant. Cada organización tiene un registro único.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'name', type: 'text', nullable: false, default_val: null },
      { name: 'settings_json', type: 'jsonb', nullable: true, default_val: '{}' },
      { name: 'created_at', type: 'timestamptz', nullable: false, default_val: 'now()' },
    ],
    rls: [{ name: 'Tenant isolation', command: 'ALL', using: 'id = get_user_tenant_id(auth.uid())' }],
    fks: [],
  },
  {
    name: 'profiles',
    description: 'Perfil de usuario vinculado a auth.users. Nunca almacena roles (ver user_roles).',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'user_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'name', type: 'text', nullable: false, default_val: null },
      { name: 'email', type: 'text', nullable: true, default_val: null },
      { name: 'phone', type: 'text', nullable: true, default_val: null },
      { name: 'whatsapp_number', type: 'text', nullable: true, default_val: null },
      { name: 'avatar_url', type: 'text', nullable: true, default_val: null },
      { name: 'pin_hash', type: 'text', nullable: true, default_val: null },
      { name: 'status', type: 'text', nullable: false, default_val: "'active'" },
      { name: 'onboarding_completed', type: 'boolean', nullable: true, default_val: 'false' },
      { name: 'created_at', type: 'timestamptz', nullable: false, default_val: 'now()' },
      { name: 'updated_at', type: 'timestamptz', nullable: false, default_val: 'now()' },
    ],
    rls: [
      { name: 'Users can view own profile', command: 'SELECT', using: 'user_id = auth.uid()' },
      { name: 'Users can update own profile', command: 'UPDATE', using: 'user_id = auth.uid()' },
      { name: 'Tenant members can view profiles', command: 'SELECT', using: 'tenant_id = get_user_tenant_id(auth.uid())' },
    ],
    fks: [{ column: 'tenant_id', ref_table: 'tenants', ref_column: 'id' }],
  },
  {
    name: 'user_roles',
    description: 'Tabla RBAC separada. Roles: super_admin, owner, admin, moderator, user. NUNCA almacenar roles en profiles.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'user_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'role', type: 'app_role (enum)', nullable: false, default_val: null },
    ],
    rls: [
      { name: 'Users can view own roles', command: 'SELECT', using: 'user_id = auth.uid()' },
    ],
    fks: [],
  },
  {
    name: 'appointments',
    description: 'Citas agendadas por voz o app. Se vinculan opcionalmente a call_records.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'user_id', type: 'uuid', nullable: true, default_val: null },
      { name: 'call_record_id', type: 'uuid', nullable: true, default_val: null },
      { name: 'contact_name', type: 'text', nullable: false, default_val: null },
      { name: 'contact_phone', type: 'text', nullable: true, default_val: null },
      { name: 'contact_email', type: 'text', nullable: true, default_val: null },
      { name: 'service_type', type: 'text', nullable: true, default_val: null },
      { name: 'start_at', type: 'timestamptz', nullable: false, default_val: null },
      { name: 'end_at', type: 'timestamptz', nullable: false, default_val: null },
      { name: 'status', type: 'text', nullable: false, default_val: "'scheduled'" },
      { name: 'source', type: 'text', nullable: true, default_val: "'app'" },
      { name: 'calendar_sync_status', type: 'text', nullable: false, default_val: "'CREATED_LOCAL'" },
      { name: 'deleted_at', type: 'timestamptz', nullable: true, default_val: null },
    ],
    rls: [
      { name: 'Staff can manage appointments', command: 'ALL', using: 'tenant_id = get_user_tenant_id(auth.uid())' },
      { name: 'Tenant users can view appointments', command: 'SELECT', using: 'tenant_id = get_user_tenant_id(auth.uid())' },
    ],
    fks: [
      { column: 'tenant_id', ref_table: 'tenants', ref_column: 'id' },
      { column: 'call_record_id', ref_table: 'call_records', ref_column: 'id' },
    ],
  },
  {
    name: 'appointment_notifications',
    description: 'Notificaciones enviadas para recordar citas (WhatsApp / SMS).',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'appointment_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'notification_type', type: 'text', nullable: false, default_val: null },
      { name: 'status', type: 'text', nullable: false, default_val: "'pending'" },
      { name: 'scheduled_at', type: 'timestamptz', nullable: false, default_val: null },
      { name: 'sent_at', type: 'timestamptz', nullable: true, default_val: null },
    ],
    rls: [{ name: 'Tenant users can view', command: 'SELECT', using: 'tenant_id = get_user_tenant_id(auth.uid())' }],
    fks: [
      { column: 'appointment_id', ref_table: 'appointments', ref_column: 'id' },
      { column: 'tenant_id', ref_table: 'tenants', ref_column: 'id' },
    ],
    blockedActions: ['INSERT', 'UPDATE', 'DELETE'],
  },
  {
    name: 'call_records',
    description: 'Registro maestro de llamadas (inbound/outbound). Incluye transcripción, resumen y datos extraídos.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'status', type: 'text', nullable: false, default_val: "'pending'" },
      { name: 'from_number', type: 'text', nullable: true, default_val: null },
      { name: 'to_number', type: 'text', nullable: true, default_val: null },
      { name: 'channel', type: 'text', nullable: true, default_val: "'phone'" },
      { name: 'duration', type: 'integer', nullable: true, default_val: '0' },
      { name: 'transcript', type: 'text', nullable: true, default_val: null },
      { name: 'transcript_status', type: 'text', nullable: false, default_val: "'pending'" },
      { name: 'summary_system', type: 'text', nullable: true, default_val: null },
      { name: 'summary_status', type: 'text', nullable: false, default_val: "'pending'" },
      { name: 'extracted_data', type: 'jsonb', nullable: true, default_val: '{}' },
      { name: 'audio_url', type: 'text', nullable: true, default_val: null },
      { name: 'tags', type: 'text[]', nullable: true, default_val: '{}' },
      { name: 'deleted_at', type: 'timestamptz', nullable: true, default_val: null },
    ],
    rls: [
      { name: 'Staff can create calls', command: 'INSERT', check: 'tenant_id = get_user_tenant_id(auth.uid())' },
      { name: 'Staff can update calls', command: 'UPDATE', using: 'tenant_id = get_user_tenant_id(auth.uid())' },
      { name: 'Tenant users can view calls', command: 'SELECT', using: 'tenant_id = get_user_tenant_id(auth.uid())' },
    ],
    fks: [{ column: 'tenant_id', ref_table: 'tenants', ref_column: 'id' }],
    blockedActions: ['DELETE'],
  },
  {
    name: 'call_costs',
    description: 'Costos desglosados por llamada: Twilio, IA, infra, margen y cobro.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'call_record_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'duration_minutes', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'cost_twilio', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'cost_ai', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'cost_infra', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'cost_total', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'revenue_charged', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'margin', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'margin_pct', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'ai_tokens_used', type: 'integer', nullable: false, default_val: '0' },
    ],
    rls: [{ name: 'Admins can view call costs', command: 'SELECT', using: 'tenant_id = get_user_tenant_id(auth.uid()) AND (has_tenant_role(…, admin/owner/super_admin))' }],
    fks: [
      { column: 'call_record_id', ref_table: 'call_records', ref_column: 'id' },
      { column: 'tenant_id', ref_table: 'tenants', ref_column: 'id' },
    ],
    blockedActions: ['INSERT', 'UPDATE', 'DELETE'],
  },
  {
    name: 'call_events',
    description: 'Eventos granulares de llamada (ring, answer, hangup, transfer, etc).',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'call_record_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'event_type', type: 'text', nullable: false, default_val: null },
      { name: 'event_data', type: 'jsonb', nullable: true, default_val: '{}' },
    ],
    rls: [{ name: 'Tenant users can view', command: 'SELECT', using: 'tenant_id = get_user_tenant_id(auth.uid())' }],
    fks: [
      { column: 'call_record_id', ref_table: 'call_records', ref_column: 'id' },
      { column: 'tenant_id', ref_table: 'tenants', ref_column: 'id' },
    ],
    blockedActions: ['INSERT', 'UPDATE', 'DELETE'],
  },
  {
    name: 'call_sessions',
    description: 'Sesiones de agente IA por llamada. Maneja routing, reintentos y estado de conexión ElevenLabs.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'call_record_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'call_sid', type: 'text', nullable: false, default_val: null },
      { name: 'state', type: 'text', nullable: false, default_val: "'routing_to_agent'" },
      { name: 'agent_mode', type: 'text', nullable: false, default_val: "'elevenlabs'" },
      { name: 'routing_method', type: 'text', nullable: false, default_val: "'stream'" },
      { name: 'retry_count', type: 'integer', nullable: false, default_val: '0' },
    ],
    rls: [
      { name: 'Admins can manage', command: 'ALL', using: 'has_tenant_role(…, admin/owner) OR has_role(…, super_admin)' },
      { name: 'Tenant users can view', command: 'SELECT', using: 'tenant_id = get_user_tenant_id(auth.uid())' },
    ],
    fks: [
      { column: 'call_record_id', ref_table: 'call_records', ref_column: 'id' },
      { column: 'tenant_id', ref_table: 'tenants', ref_column: 'id' },
    ],
  },
  {
    name: 'call_jobs',
    description: 'Cola de trabajos async post-llamada (transcripción, resumen, costos).',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'call_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'job_type', type: 'text', nullable: false, default_val: null },
      { name: 'status', type: 'text', nullable: false, default_val: "'queued'" },
      { name: 'attempts', type: 'integer', nullable: false, default_val: '0' },
      { name: 'max_attempts', type: 'integer', nullable: false, default_val: '3' },
    ],
    rls: [{ name: 'Admins can view jobs', command: 'SELECT', using: 'tenant_id = get_user_tenant_id(auth.uid()) AND has_tenant_role(…, admin/owner/super_admin)' }],
    fks: [
      { column: 'call_id', ref_table: 'call_records', ref_column: 'id' },
      { column: 'tenant_id', ref_table: 'tenants', ref_column: 'id' },
    ],
    blockedActions: ['INSERT', 'UPDATE', 'DELETE'],
  },
  {
    name: 'contacts',
    description: 'Directorio de contactos por tenant (WhatsApp, llamadas, email).',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'name', type: 'text', nullable: true, default_val: null },
      { name: 'phone', type: 'text', nullable: false, default_val: null },
      { name: 'email', type: 'text', nullable: true, default_val: null },
      { name: 'company', type: 'text', nullable: true, default_val: null },
      { name: 'source', type: 'text', nullable: true, default_val: "'whatsapp'" },
    ],
    rls: [
      { name: 'Tenant staff can manage', command: 'ALL', using: 'tenant_id = get_user_tenant_id(auth.uid())' },
      { name: 'Tenant users can view', command: 'SELECT', using: 'tenant_id = get_user_tenant_id(auth.uid())' },
    ],
    fks: [{ column: 'tenant_id', ref_table: 'tenants', ref_column: 'id' }],
  },
  {
    name: 'expenses',
    description: 'Gastos/ingresos con workflow de aprobación, OCR y vinculación a Google Drive.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'user_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'amount', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'currency', type: 'text', nullable: false, default_val: "'MXN'" },
      { name: 'type', type: 'text', nullable: false, default_val: "'expense'" },
      { name: 'status', type: 'text', nullable: false, default_val: "'pending'" },
      { name: 'category', type: 'text', nullable: true, default_val: null },
      { name: 'vendor_name', type: 'text', nullable: true, default_val: null },
      { name: 'approval_required', type: 'boolean', nullable: false, default_val: 'false' },
      { name: 'ocr_data', type: 'jsonb', nullable: true, default_val: '{}' },
    ],
    rls: [
      { name: 'Users can insert own', command: 'INSERT', check: 'user_id = auth.uid() OR tenant_id = get_user_tenant_id(auth.uid())' },
      { name: 'Users can update own', command: 'UPDATE', using: 'user_id = auth.uid()' },
      { name: 'Users can view own/tenant', command: 'SELECT', using: 'user_id = auth.uid() OR tenant_id = get_user_tenant_id(auth.uid())' },
    ],
    fks: [{ column: 'tenant_id', ref_table: 'tenants', ref_column: 'id' }],
    blockedActions: ['DELETE'],
  },
  {
    name: 'knowledge_items',
    description: 'Base de conocimiento con versionado, visibilidad y soft-delete.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'title', type: 'text', nullable: false, default_val: null },
      { name: 'content', type: 'text', nullable: false, default_val: "''" },
      { name: 'category', type: 'text', nullable: true, default_val: null },
      { name: 'tags', type: 'text[]', nullable: true, default_val: '{}' },
      { name: 'visibility', type: 'text', nullable: false, default_val: "'internal'" },
      { name: 'version', type: 'integer', nullable: true, default_val: '1' },
      { name: 'active', type: 'boolean', nullable: true, default_val: 'true' },
    ],
    rls: [
      { name: 'Admins can manage', command: 'ALL', using: 'tenant_id = get_user_tenant_id(auth.uid()) AND has_tenant_role(…, admin/owner)' },
      { name: 'Tenant users can view', command: 'SELECT', using: 'tenant_id = get_user_tenant_id(auth.uid()) AND active = true' },
    ],
    fks: [{ column: 'tenant_id', ref_table: 'tenants', ref_column: 'id' }],
  },
  {
    name: 'internal_messages',
    description: 'Mensajes del chat interno entre miembros del tenant.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'sender_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'channel_id', type: 'text', nullable: true, default_val: null },
      { name: 'body', type: 'text', nullable: false, default_val: null },
      { name: 'attachments', type: 'jsonb', nullable: true, default_val: '[]' },
    ],
    rls: [
      { name: 'Tenant users can view', command: 'SELECT', using: 'tenant_id = get_user_tenant_id(auth.uid())' },
      { name: 'Users can send', command: 'INSERT', check: 'tenant_id = get_user_tenant_id(auth.uid()) AND sender_id = auth.uid()' },
    ],
    fks: [{ column: 'tenant_id', ref_table: 'tenants', ref_column: 'id' }],
    blockedActions: ['UPDATE', 'DELETE'],
  },
  {
    name: 'assistant_conversations',
    description: 'Conversaciones del AI Copilot por usuario.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'user_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'title', type: 'text', nullable: true, default_val: "'Nueva conversación'" },
    ],
    rls: [
      { name: 'Users can manage own', command: 'ALL', using: 'user_id = auth.uid()' },
      { name: 'Admins can view tenant', command: 'SELECT', using: 'tenant_id = get_user_tenant_id(auth.uid()) AND has_tenant_role(…, admin/owner/super_admin)' },
    ],
    fks: [{ column: 'tenant_id', ref_table: 'tenants', ref_column: 'id' }],
  },
  {
    name: 'assistant_messages',
    description: 'Mensajes dentro de conversaciones del copilot (user/assistant).',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'conversation_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'role', type: 'text', nullable: false, default_val: "'user'" },
      { name: 'content', type: 'text', nullable: false, default_val: "''" },
      { name: 'metadata', type: 'jsonb', nullable: true, default_val: '{}' },
    ],
    rls: [
      { name: 'Users can manage own', command: 'ALL', using: 'conversation_id IN (SELECT id FROM assistant_conversations WHERE user_id = auth.uid())' },
    ],
    fks: [{ column: 'conversation_id', ref_table: 'assistant_conversations', ref_column: 'id' }],
  },
  {
    name: 'package_catalog',
    description: 'Catálogo de paquetes prepago (WhatsApp, Voice, Mixtos).',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'name', type: 'text', nullable: false, default_val: null },
      { name: 'package_type', type: 'text', nullable: false, default_val: "'whatsapp'" },
      { name: 'price_mxn', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'price_usd', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'included_messages', type: 'integer', nullable: false, default_val: '0' },
      { name: 'included_minutes', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'validity_days', type: 'integer', nullable: false, default_val: '30' },
      { name: 'active', type: 'boolean', nullable: false, default_val: 'true' },
      { name: 'sort_order', type: 'integer', nullable: false, default_val: '0' },
    ],
    rls: [
      { name: 'Authenticated users can view catalog', command: 'SELECT', using: 'active = true' },
      { name: 'Super admins manage catalog', command: 'ALL', using: 'has_role(auth.uid(), super_admin)' },
    ],
    fks: [],
  },
  {
    name: 'pricing_rules',
    description: 'Reglas de pricing por minuto/volumen con markup configurable.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'name', type: 'text', nullable: false, default_val: null },
      { name: 'rule_type', type: 'text', nullable: false, default_val: "'per_minute'" },
      { name: 'base_rate', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'markup_pct', type: 'numeric', nullable: false, default_val: '30' },
      { name: 'min_charge', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'volume_tiers', type: 'jsonb', nullable: true, default_val: '[]' },
      { name: 'conditions', type: 'jsonb', nullable: true, default_val: '{}' },
      { name: 'active', type: 'boolean', nullable: false, default_val: 'true' },
      { name: 'priority', type: 'integer', nullable: false, default_val: '0' },
    ],
    rls: [{ name: 'Super admins can view', command: 'SELECT', using: 'has_role(auth.uid(), super_admin)' }],
    fks: [],
    blockedActions: ['INSERT', 'UPDATE', 'DELETE'],
  },
  {
    name: 'fx_rates',
    description: 'Tasas de cambio diarias (USD/MXN, etc.) para normalización financiera.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'base_currency', type: 'text', nullable: false, default_val: "'USD'" },
      { name: 'target_currency', type: 'text', nullable: false, default_val: null },
      { name: 'rate', type: 'numeric', nullable: false, default_val: '1' },
      { name: 'rate_date', type: 'date', nullable: false, default_val: 'CURRENT_DATE' },
      { name: 'source', type: 'text', nullable: false, default_val: "'manual'" },
    ],
    rls: [{ name: 'Super admins view', command: 'SELECT', using: 'has_role(auth.uid(), super_admin)' }],
    fks: [],
    blockedActions: ['INSERT', 'UPDATE', 'DELETE'],
  },
  {
    name: 'global_metrics_daily',
    description: 'Métricas SaaS consolidadas: MRR, ARR, Churn, ARPU, LTV, CAC por región.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'metric_date', type: 'date', nullable: false, default_val: 'CURRENT_DATE' },
      { name: 'mrr', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'arr', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'total_tenants', type: 'integer', nullable: false, default_val: '0' },
      { name: 'active_tenants', type: 'integer', nullable: false, default_val: '0' },
      { name: 'churn_rate_pct', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'arpu', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'ltv_avg', type: 'numeric', nullable: false, default_val: '0' },
      { name: 'region', type: 'text', nullable: false, default_val: "'GLOBAL'" },
      { name: 'country_code', type: 'text', nullable: false, default_val: "'ALL'" },
    ],
    rls: [{ name: 'Super admins view', command: 'SELECT', using: 'has_role(auth.uid(), super_admin)' }],
    fks: [],
    blockedActions: ['INSERT', 'UPDATE', 'DELETE'],
  },
  {
    name: 'audit_events',
    description: 'Log de auditoría inmutable por tenant.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'actor_id', type: 'uuid', nullable: true, default_val: null },
      { name: 'event_type', type: 'text', nullable: false, default_val: null },
      { name: 'resource_type', type: 'text', nullable: true, default_val: null },
      { name: 'resource_id', type: 'text', nullable: true, default_val: null },
      { name: 'payload', type: 'jsonb', nullable: true, default_val: '{}' },
    ],
    rls: [{ name: 'Admins can view audit', command: 'SELECT', using: 'tenant_id = get_user_tenant_id(auth.uid()) AND has_tenant_role(…, admin/owner)' }],
    fks: [{ column: 'tenant_id', ref_table: 'tenants', ref_column: 'id' }],
    blockedActions: ['INSERT', 'UPDATE', 'DELETE'],
  },
  {
    name: 'fraud_detection_logs',
    description: 'Alertas de fraude detectadas automáticamente.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'detection_type', type: 'text', nullable: false, default_val: null },
      { name: 'severity', type: 'text', nullable: false, default_val: "'warning'" },
      { name: 'details', type: 'jsonb', nullable: false, default_val: '{}' },
      { name: 'resolved', type: 'boolean', nullable: false, default_val: 'false' },
    ],
    rls: [{ name: 'Super admins can view', command: 'SELECT', using: 'has_role(auth.uid(), super_admin)' }],
    fks: [{ column: 'tenant_id', ref_table: 'tenants', ref_column: 'id' }],
    blockedActions: ['INSERT', 'UPDATE', 'DELETE'],
  },
  {
    name: 'availability_rules',
    description: 'Reglas de disponibilidad horaria por día de la semana, con buffers y límites.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'user_id', type: 'uuid', nullable: true, default_val: null },
      { name: 'day_of_week', type: 'integer', nullable: false, default_val: null },
      { name: 'start_time', type: 'time', nullable: false, default_val: null },
      { name: 'end_time', type: 'time', nullable: false, default_val: null },
      { name: 'buffer_before', type: 'integer', nullable: true, default_val: '0' },
      { name: 'buffer_after', type: 'integer', nullable: true, default_val: '0' },
      { name: 'max_appointments', type: 'integer', nullable: true, default_val: '10' },
    ],
    rls: [
      { name: 'Tenant users can view', command: 'SELECT', using: 'tenant_id = get_user_tenant_id(auth.uid())' },
      { name: 'Users can manage own', command: 'ALL', using: 'tenant_id = get_user_tenant_id(auth.uid()) AND (user_id = auth.uid() OR has_tenant_role(…, admin))' },
    ],
    fks: [{ column: 'tenant_id', ref_table: 'tenants', ref_column: 'id' }],
  },
  {
    name: 'otp_challenges',
    description: 'Desafíos OTP con hashing. RLS bloquea acceso directo — solo via edge functions.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default_val: 'gen_random_uuid()' },
      { name: 'tenant_id', type: 'uuid', nullable: false, default_val: null },
      { name: 'phone', type: 'text', nullable: false, default_val: null },
      { name: 'code_hash', type: 'text', nullable: false, default_val: null },
      { name: 'expires_at', type: 'timestamptz', nullable: false, default_val: null },
      { name: 'attempts', type: 'integer', nullable: true, default_val: '0' },
      { name: 'max_attempts', type: 'integer', nullable: true, default_val: '3' },
    ],
    rls: [{ name: 'Deny all direct access', command: 'ALL', using: 'false' }],
    fks: [{ column: 'tenant_id', ref_table: 'tenants', ref_column: 'id' }],
  },
];

interface HelperFunction { name: string; returns: string; security: string; description: string; signature: string; }

const helperFunctions: HelperFunction[] = [
  { name: 'get_user_tenant_id', returns: 'uuid', security: 'SECURITY DEFINER', description: 'Retorna el tenant_id del usuario. Usado en todas las políticas RLS de aislamiento.', signature: 'get_user_tenant_id(_user_id uuid) → uuid' },
  { name: 'has_role', returns: 'boolean', security: 'SECURITY DEFINER', description: 'Verifica si un usuario tiene un rol global (ej: super_admin). Previene recursión RLS.', signature: 'has_role(_user_id uuid, _role app_role) → boolean' },
  { name: 'has_tenant_role', returns: 'boolean', security: 'SECURITY DEFINER', description: 'Verifica si un usuario tiene un rol específico dentro de un tenant.', signature: 'has_tenant_role(_user_id uuid, _tenant_id uuid, _role app_role) → boolean' },
  { name: 'get_tenant_branding', returns: 'json', security: 'SECURITY DEFINER', description: 'Retorna nombre y settings_json del tenant para personalización de marca.', signature: 'get_tenant_branding(_tenant_id uuid) → json' },
  { name: 'get_tenant_subscription_status', returns: 'jsonb', security: 'SECURITY DEFINER', description: 'Retorna estado de suscripción, plan, días restantes y si está bloqueado.', signature: 'get_tenant_subscription_status(_user_id uuid) → jsonb' },
  { name: 'block_expired_trials', returns: 'void', security: 'SECURITY DEFINER', description: 'Bloquea suscripciones con trial expirado. Invocada por cron.', signature: 'block_expired_trials() → void' },
  { name: 'calculate_next_retry', returns: 'timestamptz', security: 'IMMUTABLE', description: 'Calcula siguiente intento con backoff exponencial para jobs.', signature: 'calculate_next_retry(_retry_count int, _base_delay_minutes int) → timestamptz' },
  { name: 'handle_new_user', returns: 'trigger', security: 'SECURITY DEFINER', description: 'Trigger en auth.users. Crea tenant, profile y asigna rol automáticamente al registrarse.', signature: 'handle_new_user() → trigger' },
  { name: 'update_updated_at_column', returns: 'trigger', security: 'N/A', description: 'Trigger genérico que actualiza updated_at en cada UPDATE.', signature: 'update_updated_at_column() → trigger' },
];

/* ─────────────────────────────── UI ─────────────────────────────── */

const SchemaDocsPage = () => {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const toggle = (name: string) => setExpanded(prev => ({ ...prev, [name]: !prev[name] }));

  const filtered = tables.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.description.toLowerCase().includes(search.toLowerCase())
  );

  const copyAll = () => {
    let md = '# Documentación Técnica del Schema\n\n';
    md += `Generada: ${new Date().toISOString().split('T')[0]}\n\n`;
    md += `## Tablas (${tables.length})\n\n`;
    tables.forEach(t => {
      md += `### ${t.name}\n${t.description}\n\n`;
      md += '| Columna | Tipo | Nullable | Default |\n|---------|------|----------|---------|\n';
      t.columns.forEach(c => { md += `| ${c.name} | ${c.type} | ${c.nullable ? 'Sí' : 'No'} | ${c.default_val || '—'} |\n`; });
      md += '\n**RLS Policies:**\n';
      t.rls.forEach(r => { md += `- **${r.name}** (${r.command}): ${r.using || r.check || '—'}\n`; });
      if (t.blockedActions?.length) md += `\n⛔ Acciones bloqueadas: ${t.blockedActions.join(', ')}\n`;
      if (t.fks.length) { md += '\n**Foreign Keys:**\n'; t.fks.forEach(f => { md += `- ${f.column} → ${f.ref_table}.${f.ref_column}\n`; }); }
      md += '\n---\n\n';
    });
    md += '## Funciones Helper\n\n';
    helperFunctions.forEach(f => { md += `### ${f.name}\n- **Firma:** \`${f.signature}\`\n- **Seguridad:** ${f.security}\n- ${f.description}\n\n`; });
    md += '## Tipos Enum\n\n- `app_role`: super_admin | owner | admin | moderator | user\n\n';
    md += '## Patrones de Seguridad\n\n';
    md += '1. **Aislamiento por tenant_id** — Todas las tablas usan `get_user_tenant_id()` en RLS\n';
    md += '2. **RBAC separado** — Roles en `user_roles`, nunca en `profiles`\n';
    md += '3. **SECURITY DEFINER** — Funciones helper evitan recursión RLS\n';
    md += '4. **Soft-delete** — Tablas con `deleted_at` (call_records, appointments, knowledge_items)\n';
    md += '5. **OTP sellado** — `otp_challenges` con RLS `false` (solo service_role)\n';
    md += '6. **PIN con PBKDF2** — `profiles.pin_hash` protegido\n';
    md += '7. **Credenciales AES-GCM** — Cifrado en vault de credenciales compartidas\n';

    navigator.clipboard.writeText(md);
    setCopiedId('all');
    toast.success('Documentación completa copiada al portapapeles');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const exportPdf = useCallback(() => {
    // Expand all tables for print
    const allExpanded: Record<string, boolean> = {};
    tables.forEach(t => { allExpanded[t.name] = true; });
    setExpanded(allExpanded);
    setSearch('');
    // Wait for render, then print
    setTimeout(() => {
      window.print();
    }, 300);
  }, []);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6 print:p-2 print:max-w-none" id="schema-docs">
      {/* Print styles */}
      <style>{`
        @media print {
          /* Remove layout constraints */
          html, body { height: auto !important; overflow: visible !important; }
          body { background: white !important; color: black !important; font-size: 9px !important; }
          
          /* Hide chrome */
          nav, aside, header, [data-sidebar], .no-print, [role="banner"] { display: none !important; }
          
          /* Fix the flex layout that clips content */
          .flex.h-screen { height: auto !important; overflow: visible !important; display: block !important; }
          .flex-1.min-h-0.overflow-auto { height: auto !important; overflow: visible !important; min-height: 0 !important; }
          .flex-1.flex.flex-col.min-w-0 { height: auto !important; overflow: visible !important; display: block !important; }
          main { height: auto !important; overflow: visible !important; }
          
          #schema-docs { padding: 0.5cm !important; max-width: 100% !important; }
          .bg-card, .bg-background, [class*="bg-secondary"] { background: white !important; border-color: #ccc !important; }
          code { background: #f0f0f0 !important; color: #333 !important; }
          .text-foreground, h1, h2, h3, h4, span, p, td, th { color: black !important; }
          .text-muted-foreground { color: #555 !important; }
          .text-primary { color: #1d4ed8 !important; }
          button { display: none !important; }
          input { display: none !important; }
          .relative:has(input) { display: none !important; }
          
          @page { margin: 0.8cm; size: A4; }
          .print-break-avoid { break-inside: avoid; }
          .print-page-break { break-before: page; }
        }
      `}</style>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Database size={22} className="text-primary" />
            Documentación Técnica — Schema
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {tables.length} tablas · {helperFunctions.length} funciones helper · RLS completo
          </p>
        </div>
        <div className="flex gap-2 no-print">
          <button onClick={exportPdf} className="flex items-center gap-2 bg-secondary text-foreground text-sm px-4 py-2 rounded-lg hover:bg-secondary/80 transition-opacity font-medium border border-border">
            <FileDown size={16} />
            Descargar PDF
          </button>
          <button onClick={copyAll} className="flex items-center gap-2 bg-primary text-primary-foreground text-sm px-4 py-2 rounded-lg hover:opacity-90 transition-opacity font-medium">
            {copiedId === 'all' ? <Check size={16} /> : <Copy size={16} />}
            {copiedId === 'all' ? 'Copiado' : 'Copiar Markdown'}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar tabla..."
          className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* Security Patterns */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Shield size={16} className="text-primary" /> Patrones de Seguridad
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div className="flex items-start gap-2"><span className="text-primary font-bold">1.</span> Aislamiento estricto por <code className="bg-secondary px-1 rounded">tenant_id</code> en todas las tablas</div>
          <div className="flex items-start gap-2"><span className="text-primary font-bold">2.</span> RBAC separado en <code className="bg-secondary px-1 rounded">user_roles</code> (nunca en profiles)</div>
          <div className="flex items-start gap-2"><span className="text-primary font-bold">3.</span> Funciones <code className="bg-secondary px-1 rounded">SECURITY DEFINER</code> para evitar recursión RLS</div>
          <div className="flex items-start gap-2"><span className="text-primary font-bold">4.</span> Soft-delete con <code className="bg-secondary px-1 rounded">deleted_at</code> en entidades críticas</div>
          <div className="flex items-start gap-2"><span className="text-primary font-bold">5.</span> OTP sellado — <code className="bg-secondary px-1 rounded">otp_challenges</code> con RLS <code className="bg-secondary px-1 rounded">false</code></div>
          <div className="flex items-start gap-2"><span className="text-primary font-bold">6.</span> PINs con PBKDF2, credenciales con AES-GCM, webhooks con HMAC</div>
        </div>
      </div>

      {/* Enum Types */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Zap size={16} className="text-primary" /> Tipos Enum
        </h2>
        <div className="text-sm">
          <code className="bg-secondary px-2 py-1 rounded text-foreground">app_role</code>
          <span className="text-muted-foreground ml-2">= super_admin | owner | admin | moderator | user</span>
        </div>
      </div>

      {/* Helper Functions */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <FileCode size={16} className="text-primary" /> Funciones Helper ({helperFunctions.length})
        </h2>
        <div className="space-y-3">
          {helperFunctions.map(fn => (
            <div key={fn.name} className="p-3 rounded-lg border border-border bg-background">
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-sm font-semibold text-foreground">{fn.name}</code>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">{fn.security}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{fn.description}</p>
              <code className="text-[11px] text-muted-foreground block mt-1">{fn.signature}</code>
            </div>
          ))}
        </div>
      </div>

      {/* Tables */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Database size={16} className="text-primary" /> Tablas ({filtered.length})
        </h2>
        {filtered.map(table => {
          const isOpen = expanded[table.name];
          return (
            <div key={table.name} className="bg-card border border-border rounded-xl overflow-hidden print-break-avoid">
              <button
                onClick={() => toggle(table.name)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-secondary/30 transition-colors"
              >
                {isOpen ? <ChevronDown size={16} className="text-muted-foreground shrink-0" /> : <ChevronRight size={16} className="text-muted-foreground shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm font-semibold text-foreground">{table.name}</code>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">{table.columns.length} cols</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 font-medium">{table.rls.length} RLS</span>
                    {table.fks.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 font-medium">{table.fks.length} FK</span>}
                    {table.blockedActions && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 font-medium">⛔ {table.blockedActions.length} blocked</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{table.description}</p>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-border p-4 space-y-4">
                  {/* Columns */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-left">
                          <th className="py-1.5 px-2 font-medium text-muted-foreground">Columna</th>
                          <th className="py-1.5 px-2 font-medium text-muted-foreground">Tipo</th>
                          <th className="py-1.5 px-2 font-medium text-muted-foreground">Nullable</th>
                          <th className="py-1.5 px-2 font-medium text-muted-foreground">Default</th>
                        </tr>
                      </thead>
                      <tbody>
                        {table.columns.map(col => (
                          <tr key={col.name} className="border-b border-border/50">
                            <td className="py-1.5 px-2 font-mono text-foreground">{col.name}</td>
                            <td className="py-1.5 px-2 text-muted-foreground">{col.type}</td>
                            <td className="py-1.5 px-2">{col.nullable ? <span className="text-amber-600">Sí</span> : <span className="text-green-600">No</span>}</td>
                            <td className="py-1.5 px-2 text-muted-foreground font-mono">{col.default_val || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* RLS */}
                  <div>
                    <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1">
                      <Shield size={12} className="text-green-600" /> RLS Policies
                    </h4>
                    <div className="space-y-2">
                      {table.rls.map((policy, i) => (
                        <div key={i} className="p-2 rounded border border-border bg-secondary/20 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{policy.name}</span>
                            <span className="text-[10px] px-1 rounded bg-muted text-muted-foreground">{policy.command}</span>
                          </div>
                          {policy.using && <p className="text-muted-foreground mt-1 font-mono text-[11px]">USING: {policy.using}</p>}
                          {policy.check && <p className="text-muted-foreground mt-1 font-mono text-[11px]">WITH CHECK: {policy.check}</p>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Blocked */}
                  {table.blockedActions && (
                    <div className="text-xs text-red-600 flex items-center gap-1">
                      ⛔ Acciones bloqueadas (sin política): {table.blockedActions.join(', ')}
                    </div>
                  )}

                  {/* FKs */}
                  {table.fks.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-foreground mb-1">Foreign Keys</h4>
                      {table.fks.map((fk, i) => (
                        <p key={i} className="text-xs text-muted-foreground font-mono">
                          {table.name}.{fk.column} → {fk.ref_table}.{fk.ref_column}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Entity Relationship Diagram */}
      <div className="bg-card border border-border rounded-xl p-5 print-page-break">
        <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Database size={16} className="text-primary" /> Diagrama de Relación de Entidades (ERD)
        </h2>
        <div className="text-xs font-mono text-muted-foreground space-y-1 leading-relaxed">
          <p className="font-semibold text-foreground text-sm mb-3">Relaciones principales:</p>
          
          <div className="space-y-4">
            <div>
              <p className="font-semibold text-foreground mb-1">Core</p>
              <p>tenants ──┬── profiles (tenant_id) → miembros</p>
              <p>{"         "}├── user_roles (tenant_id) → RBAC</p>
              <p>{"         "}├── tenant_settings (tenant_id) → config</p>
              <p>{"         "}└── audit_events (tenant_id) → trazabilidad</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">Comunicación</p>
              <p>tenants ──┬── call_records (tenant_id)</p>
              <p>{"         "}│{"    "}├── call_costs (call_record_id) → costos 1:1</p>
              <p>{"         "}│{"    "}├── call_events (call_record_id) → timeline</p>
              <p>{"         "}│{"    "}├── call_sessions (call_record_id) → sesiones</p>
              <p>{"         "}│{"    "}├── call_jobs (call_id) → async jobs</p>
              <p>{"         "}│{"    "}└── appointments (call_record_id) → citas</p>
              <p>{"         "}├── whatsapp_conversations (tenant_id)</p>
              <p>{"         "}│{"    "}└── whatsapp_messages (conversation_id)</p>
              <p>{"         "}├── contacts (tenant_id) → directorio</p>
              <p>{"         "}└── internal_messages (tenant_id)</p>
              <p>{"              "}└── message_read_receipts (message_id)</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">Agenda</p>
              <p>tenants ──┬── appointments (tenant_id)</p>
              <p>{"         "}│{"    "}└── appointment_notifications (appointment_id)</p>
              <p>{"         "}├── availability_rules (tenant_id)</p>
              <p>{"         "}└── google_calendar_tokens (tenant_id)</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">Billing y Consumo</p>
              <p>tenants ──┬── stripe_customers (tenant_id)</p>
              <p>{"         "}├── tenant_subscriptions (tenant_id)</p>
              <p>{"         "}│{"    "}└── subscription_plans (plan_id)</p>
              <p>{"         "}│{"         "}└── global_plan_pricing (plan_id)</p>
              <p>{"         "}├── usage_packages (tenant_id)</p>
              <p>{"         "}│{"    "}└── package_catalog (catalog_id)</p>
              <p>{"         "}├── usage_daily (tenant_id) → métricas diarias</p>
              <p>{"         "}├── realtime_margin_state (tenant_id) → margen live</p>
              <p>{"         "}├── margin_metrics (tenant_id)</p>
              <p>{"         "}└── pricing_evaluations (tenant_id)</p>
              <p>{"              "}└── plan_change_history (evaluation_id)</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">IA y Knowledge</p>
              <p>tenants ──┬── assistant_conversations (tenant_id)</p>
              <p>{"         "}│{"    "}└── assistant_messages (conversation_id)</p>
              <p>{"         "}├── assistant_settings (tenant_id) → 1:1</p>
              <p>{"         "}├── knowledge_items (tenant_id)</p>
              <p>{"         "}└── voice_agent_configs (tenant_id)</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">Operaciones</p>
              <p>tenants ──┬── expenses (tenant_id)</p>
              <p>{"         "}│{"    "}└── expense_reminders (expense_id)</p>
              <p>{"         "}├── reminders (tenant_id)</p>
              <p>{"         "}├── shared_credentials (tenant_id)</p>
              <p>{"         "}├── drive_audit_log (tenant_id)</p>
              <p>{"         "}└── push_subscriptions (tenant_id)</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">Seguridad y Anti-fraude</p>
              <p>tenants ──┬── fraud_detection_logs (tenant_id)</p>
              <p>{"         "}├── otp_challenges (tenant_id)</p>
              <p>{"         "}└── churn_evaluations (tenant_id)</p>
              <p>{"              "}└── retention_offers (tenant_id)</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">Tablas Globales (sin tenant)</p>
              <p>fraud_thresholds → umbrales globales</p>
              <p>pricing_rules → reglas de pricing</p>
              <p>fx_rates → tipos de cambio</p>
              <p>global_metrics_daily → métricas SaaS</p>
              <p>financial_projections → proyecciones IA</p>
              <p>churn_model_metrics → rendimiento modelo churn</p>
              <p>regional_margin_targets → objetivos por región</p>
              <p>service_packages → catálogo público</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SchemaDocsPage;
