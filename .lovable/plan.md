
# Auditoría (solo lectura) — 5 problemas

## PROBLEMA 1 — Recordatorios sin botón "Agregar"

**Archivo:** `src/pages/RemindersPage.tsx` (L31–247).

**Hallazgo:** El componente sólo lista/filtra/reenvía/borra recordatorios. **No existe** ningún botón, form ni modal para crear (`create/insert/add`). En la cabecera (L125–143) sólo hay un botón "Actualizar". La creación hoy ocurre implícitamente desde el bot de WhatsApp o desde `expense-reminders`.

**Tabla y RLS (`reminders`):**
- INSERT policy: `Users can insert own reminders` con `WITH CHECK = null` (permisivo). SELECT/UPDATE/DELETE requieren `user_id = auth.uid()`.
- Columnas relevantes usadas por el proyecto: `id, user_id, tenant_id, message, remind_at, status, source, retry_count, max_retries, error_message, timezone, sent_at, created_at` (más `channel`, `contact_phone` según código de otros módulos).

**Causa raíz:** UI incompleta: nunca se añadió el CTA de crear.

**Fix mínimo:**
1. En `RemindersPage.tsx`, junto al botón "Actualizar" (L135–142) añadir botón "Agregar recordatorio" que abra un `Dialog` con: mensaje (textarea), fecha/hora (input datetime-local), canal (whatsapp/email, opcional), y contacto opcional.
2. Handler `handleCreate`:
   - Resolver `tenant_id` con `supabase.rpc('get_user_tenant_id', { _user_id: user.id })` (patrón ya usado en el proyecto).
   - `insert` en `reminders` con `{ user_id: user.id, tenant_id, message, remind_at: new Date(local).toISOString(), status: 'pending', source: 'manual', retry_count: 0, max_retries: 3, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }`.
   - Toast + `fetchReminders()` (el realtime también lo refresca).
3. No hace falta migración: RLS INSERT ya lo permite y `tenant_id` es nullable en la tabla; se llena explícitamente para consistencia.

---

## PROBLEMA 2 — Panel Super Admin no refleja el conteo real de tenants

**Archivos:**
- `src/pages/SuperAdminPage.tsx` L440: renderiza `latest?.active_tenants ?? 0 / latest?.total_tenants ?? 0`.
- `src/hooks/useGlobalMetrics.ts` L70–83 y L197: `latest` = último snapshot de `global_metrics_daily` (region=GLOBAL, country_code=ALL).
- `src/components/SuperAdminTenantsTab.tsx` L59+ y hook `useSuperAdminData.margins` (`src/hooks/useSuperAdminData.ts` L85–106): la tabla de tenants proviene de `realtime_margin_state`, no de `tenants`.

**Causa raíz:** La UI muestra métricas derivadas (`global_metrics_daily`, `realtime_margin_state`), no la tabla `tenants`. Si `global-metrics-daily` no se ha ejecutado (o el snapshot es viejo) los KPIs de "Tenants" quedan a 0. Si un tenant no tiene llamadas, no existe fila en `realtime_margin_state` y desaparece del listado. Confirmado: hoy hay **11 tenants** en `public.tenants`, pero el panel puede mostrar 1.

**Fix mínimo (dos cambios pequeños):**
1. **KPI "Tenants Activos" (SuperAdminPage.tsx L438–441):** reemplazar la fuente por un contador directo de `tenants`. Añadir al hook `useSuperAdminData` (o a `useGlobalMetrics`) una query:
   ```ts
   const tenantsCount = useQuery({
     queryKey: ['sa-tenants-count'], enabled,
     queryFn: async () => {
       const { count } = await supabase.from('tenants').select('id', { count: 'exact', head: true });
       return count ?? 0;
     },
   });
   ```
   y en el JSX cambiar `latest?.total_tenants` por `tenantsCount.data`. Mantener `active_tenants` (con actividad) como sub-métrica.
2. **Listado de tenants (`SuperAdminTenantsTab`):** ya usa `admin_list_tenants_with_subscription()` RPC en otras partes (existe en la BD y devuelve TODOS los tenants con estado de suscripción). Verificar que el listado principal lo consuma; si sigue usando `margins`, cambiar la fuente al RPC y hacer LEFT JOIN visual con `realtime_margin_state` para las métricas de margen.

Sin migración; se aprovechan RPC ya existentes (`admin_list_tenants_with_subscription`) y RLS actual (super_admin puede leer `tenants`).

---

## PROBLEMA 3 — Llamadas sin métricas de tokens/costo ni facturación

**Archivos y flujo actual:**
- `supabase/functions/elevenlabs-post-call/index.ts` L249–263: al terminar la llamada llama `calculate-usage-cost` con `ai_tokens_used: Math.ceil(transcript.length / 4)` → **estimación cruda del transcript**, no tokens reales del LLM ni de TTS/STT de ElevenLabs.
- `supabase/functions/calculate-usage-cost/index.ts` L10–14 y L66–70: tarifas hard-coded (`twilio_per_minute=0.013 USD`, `ai_per_1k_tokens=0.00025`, `infra_per_minute=0.002`, markup 35%). Escribe en `call_costs` (L75–91) y agrega en `realtime_margin_state` y `tenant_usage_monthly`.
- Tabla `call_costs` (14 cols): `duration_minutes, ai_tokens_used, cost_twilio, cost_ai, cost_infra, cost_total, revenue_charged, margin, margin_pct`. **No** tiene desglose ElevenLabs (audio in/out, LLM cost, char count).
- `call_records` (28 cols) guarda `duration`, `transcript`, `audio_url`, `extracted_data` (con `conversation_id`, `agent_id`, `analysis`) pero **no** costo ni tokens.
- UI: `src/pages/CallsPage.tsx` sólo lee `call_records` (L180, L328, L376); no muestra ni consulta `call_costs`.
- Stripe: `supabase/functions/stripe-billing/index.ts` L327–378 tiene `report_usage` (INSERT en `stripe_usage_records` y `POST` a `subscription_items/:id/usage_records`). `supabase/functions/billing-monthly-report/index.ts` L49 llama `report_usage`. **Pero** los `tenant_subscriptions` no tienen ítem metered configurado por defecto y no se dispara nada al terminar cada llamada.

**Causa raíz:**
- Tokens del agente de voz no se capturan: sólo se estima con la longitud del transcript.
- No se consulta la API de ElevenLabs para el costo real de la conversación (endpoint `/v1/convai/conversations/:id` retorna duración y charges).
- `CallsPage` no expone `cost_total`, `ai_tokens_used`, `revenue_charged` por llamada, ni un resumen por tenant.
- El puente con Stripe `report_usage` existe pero nadie lo llama al procesar la llamada; el cron mensual reporta agregados sin garantía de coincidencia y sin metered item ligado.

**Fix mínimo (por capas):**
1. **Captura real de uso desde ElevenLabs**
   - Nueva función `supabase/functions/_shared/elevenlabs-usage.ts` que, con `ELEVENLABS_API_KEY` (o el tenant-scoped en `tenants.elevenlabs_config`), haga `GET https://api.elevenlabs.io/v1/convai/conversations/{conversation_id}` y devuelva `{ llm_tokens, llm_cost_usd, tts_chars, stt_secs, total_cost_usd, duration_secs }` (los campos existentes en la respuesta actual de ElevenLabs).
   - En `elevenlabs-post-call/index.ts` L249–263, antes de invocar `calculate-usage-cost`, obtener esos valores y pasarlos: `ai_tokens_used: llm_tokens`, y añadir campos nuevos: `tts_chars`, `stt_secs`, `elevenlabs_cost_usd`.
2. **Persistencia**
   - Migración: `ALTER TABLE public.call_costs ADD COLUMN IF NOT EXISTS tts_chars integer, ADD COLUMN IF NOT EXISTS stt_secs numeric, ADD COLUMN IF NOT EXISTS elevenlabs_cost_usd numeric;`.
   - `ALTER TABLE public.call_records ADD COLUMN IF NOT EXISTS cost_total numeric, ADD COLUMN IF NOT EXISTS ai_tokens_used integer;` y actualizar al final del post-call (para que la lista de llamadas muestre costo por fila sin JOIN).
3. **`calculate-usage-cost/index.ts`**
   - Aceptar y persistir los nuevos campos; si `elevenlabs_cost_usd` viene, usarlo como `cost_ai` en vez del cálculo por tokens (fuente de verdad).
4. **UI de Llamadas** (`src/pages/CallsPage.tsx` L180 y siguientes):
   - Añadir columnas "Duración", "Tokens" y "Costo" leyendo `call_records.cost_total` y `ai_tokens_used`.
   - Un panel superior con `SUM(cost_total)`, `SUM(revenue_charged)` y minutos MTD para el tenant (query a `tenant_usage_monthly`).
5. **Facturación Stripe por consumo**
   - En `elevenlabs-post-call` (después del cost calc), si `tenant_subscriptions.plan` tiene metered item (`stripe_subscription_id` + `stripe_item_id_voice`), llamar `stripe-billing` con `action: 'report_usage'` y `quantity = ceil(duration_minutes)`.
   - Migración: `ALTER TABLE public.stripe_customers ADD COLUMN IF NOT EXISTS stripe_item_id_voice text, ADD COLUMN IF NOT EXISTS stripe_item_id_whatsapp text;` y usarlos en `report_usage` (hoy se pasa `subscription_item_id` como argumento y no se sabe de dónde).
   - Configurar en `admin_manage_tenant_subscription`/onboarding la creación del item metered al crear la Subscription; alternativa mínima: si no hay metered item, hacer `invoice item` (`POST /v1/invoiceitems`) por llamada, que ya está soportado en el proyecto para números y consultas.

Nada de esto altera prompts, calendario, ni el webhook actual de Stripe; sólo suma columnas y lecturas.

---

## PROBLEMA 4 — Proyecciones lanza error

**Archivos:**
- `supabase/functions/financial-projections/index.ts` L110: `model: "google/gemini-3-flash-preview"`.
- Invocación desde UI: `src/hooks/useSuperAdminData.ts` L189–203 (`supabase.functions.invoke('financial-projections')`), y `SuperAdminPage.tsx` L389.
- Tabla `financial_projections` con columna `input_data jsonb` (verificado en BD) — el insert L215–230 sí matchea el esquema, así que **no es error de columna**.

**Causa raíz:** El identificador de modelo **no existe** en Lovable AI Gateway. Los modelos válidos son `google/gemini-2.5-flash`, `google/gemini-2.5-flash-lite`, `google/gemini-2.5-pro`. Con `google/gemini-3-flash-preview` el gateway responde 400/404, se cae al branch L176–194 y el hook muestra el `toast.error(...)` (L200–202). El manejo actual sólo diferencia 429/402, cualquier otro código devuelve "AI projection failed".

**Fix mínimo:**
1. `supabase/functions/financial-projections/index.ts` L110: cambiar a `"google/gemini-2.5-flash"` (mismo tool-calling, sin cambios de esquema).
2. L228 opcional: actualizar `model_version` a `"v1-gemini-2.5-flash"` para trazabilidad.
3. En L176–194 propagar el mensaje real del gateway (`errText.slice(0, 300)`) para que futuros errores sean diagnosticables desde el toast.

No requiere migración ni cambios en RLS.

---

## PROBLEMA 5 — Eliminar tenant lanza error

**Archivos:**
- Botón/handler: `src/components/SuperAdminTenantsTab.tsx` L101–121 y confirmación L419–450.
- Edge function: `supabase/functions/admin-delete-tenant/index.ts` L15–172.
- FKs a `public.tenants`: 21 tablas con `ON DELETE NO ACTION` (todas ya listadas en `preTenantCleanupTables` L92–114). El resto son CASCADE.

**Causa raíz probable (en orden de probabilidad, verificable en logs):**
1. **Trigger `audit_role_changes`** dispara `INSERT INTO audit_events (tenant_id, ...)` durante el CASCADE de `user_roles` (línea del trigger). `audit_events` tiene FK a `tenants` (`ON DELETE CASCADE`), pero la inserción ocurre **después** de que se están cascadeando filas del tenant y **antes** de que el DELETE al `tenants` termine, generando `foreign_key_violation` intermitente o filas huérfanas. Además, para operaciones ejecutadas por `service_role`, `auth.uid()` es `NULL` y el `INSERT` puede fallar si algún NOT NULL de columna existe (no lo hay, pero el trigger añade ruido).
2. **Tablas nuevas no listadas** en `preTenantCleanupTables`: revisando policy list, no vi cleanup de `document_alerts`, `document_jobs`, `bot_adaptive_profiles`, `voice_call_logs`, `webhook_logs`, `byon_requests`, `calcom_integrations`, `chat_channels`, `chat_messages`, `message_read_receipts`, `project_*`, `stripe_usage_records`, `phone_number_invoices`, `support_tickets`, `ticket_events`, `ticket_messages`, `platform_support_channels`, `platform_support_messages`, `support_consult_purchases`, `tenant_drive_settings`, `drive_audit_log`, `tenant_phone_numbers`, `expense_reminders`, `tenant_rate_limits`, `tenant_offer_history`, `plan_change_history`. La mayoría son CASCADE, pero cualquiera con NO ACTION y datos rompe el DELETE final (L124).
3. **`tenant_id` en `audit_events` de la propia acción** (L152–162): si `auditTenantId` cae al MASTER pero el actor no tiene profile en otro tenant y el super_admin fue creado sin profile en master, `auditTenant?.tenant_id` es null → se usa MASTER que existe, OK. No suele fallar aquí.
4. **Cancelación Stripe** L72–79: si la key no tiene permisos falla silencioso (warn). No bloquea.

**Fix mínimo:**
1. **Eliminar la fila de `user_roles` primero explícitamente** en `admin-delete-tenant/index.ts` (antes del loop L116) para evitar el trigger `audit_role_changes` en cascada:
   ```ts
   await admin.from('audit_events').delete().eq('tenant_id', tenant_id);
   await admin.from('user_roles').delete().eq('tenant_id', tenant_id);
   ```
   Insertar el audit final en un tenant distinto (ya se hace en L143–163).
2. **Ampliar `preTenantCleanupTables`** con la lista completa de tablas con FK NO ACTION (query ya ejecutada da: `expenses, contacts, shared_credentials, call_events, transfer_notifications, push_subscriptions, assistant_conversations, assistant_settings, reminders, google_calendar_tokens, call_jobs, tenant_ltv_estimates, whatsapp_usage_events, usage_costs_reconciled, tenant_package_balances, call_sessions, appointment_notifications, document_chunks, document_memory, document_workflow_rules, document_workflow_log`). Verificar que el listado hard-coded coincida con esta query y ordenarlas de forma segura (hijas antes que padres). El listado actual coincide; añadir cualquier tabla nueva creada después.
3. **Migración opcional (recomendada) mínima**: convertir esas 21 FKs a `ON DELETE CASCADE` (usar `ALTER TABLE ... DROP CONSTRAINT ...; ADD CONSTRAINT ... FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;`). Elimina la necesidad de mantener `preTenantCleanupTables`.
4. **Devolver el detalle del error al frontend**: en L120 y L125 hoy ya se devuelve `error: err.message`, pero el toast del cliente (L119 del componente) muestra sólo `err.message` — validar que la respuesta 500 se propague; con supabase-js v2 hay que leer `error.context?.body`. Añadir en `SuperAdminTenantsTab.handleDeleteTenant`:
   ```ts
   const msg = (data as any)?.error || (error as any)?.context?.responseJson?.error || error?.message || 'Error al eliminar tenant';
   ```
   para ver la causa real en pantalla.
5. **Sanity check de super_admin**: el `handle_new_user` deja al primer super_admin con `profiles.tenant_id = MASTER_TENANT`. Confirmar que su propio tenant no sea el que intenta borrar (L47–49 ya bloquea master, OK).

---

## Resumen de fixes (sin aplicar aún)

| # | Cambios |
|---|---------|
| 1 | Añadir botón + modal "Agregar recordatorio" en `RemindersPage.tsx` L125-142; insert en `reminders` con `user_id`, `tenant_id`. |
| 2 | Añadir query directa a `tenants` (count) en `useSuperAdminData`/`useGlobalMetrics`; usar `admin_list_tenants_with_subscription()` para la tabla de tenants; JSX L440 usa el count real. |
| 3 | Nuevo helper `elevenlabs-usage.ts`; pasar tokens/costo reales desde `elevenlabs-post-call` L249; migración de columnas en `call_costs`/`call_records`/`stripe_customers`; UI de columnas de costo en `CallsPage.tsx`; disparar `stripe-billing report_usage` post-call. |
| 4 | Cambiar `model` a `google/gemini-2.5-flash` en `financial-projections/index.ts` L110; mejorar propagación del error del gateway L176-194. |
| 5 | Añadir `DELETE user_roles/audit_events` explícito antes del cleanup en `admin-delete-tenant/index.ts` L115; opcionalmente migrar FKs a `ON DELETE CASCADE`; devolver detalle de error al UI en `SuperAdminTenantsTab.tsx` L118. |

Todos los cambios son mínimos, preservan aislamiento por tenant y no tocan pin-service, calendario, ni el webhook de Stripe salvo por la ruta `report_usage` que ya existe.
