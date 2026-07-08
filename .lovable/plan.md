## Diagnóstico: 24h por Email + 1h por Llamada saliente del agente

### 1) Trigger `schedule_appointment_reminders` sobre `appointments`

Archivo: `supabase/migrations/20260708002855_18a08cc6-8f59-43c8-b678-7ea47770e09c.sql` (función `public.schedule_appointment_reminders`, listada en el prompt como db-function activa).

- Líneas 96-97: calcula `_reminder_24h := NEW.start_at - interval '24 hours'` y `_reminder_1h := NEW.start_at - interval '1 hour'`.
- Líneas 118-125: si `_reminder_24h > now()` inserta en `public.appointment_notifications` con `notification_type = 'reminder_24h'`, `status = 'pending'`, `scheduled_at = _reminder_24h`, `message_body = _msg_24h`.
- Líneas 128-135 (rama análoga): inserta `'reminder_1h'` con `scheduled_at = _reminder_1h`, `message_body = _msg_1h`.
- Columnas rellenadas (mismo INSERT en ambos casos): `appointment_id, tenant_id, target_phone, target_email, notification_type, status, scheduled_at, message_body`. `target_phone` = `NEW.contact_phone` si `_has_phone`; `target_email` = `NEW.contact_email` si `_has_email`. **No** se guarda `target_user_id` para el cliente (queda NULL). Cancelaciones/updates limpian las filas pending existentes (líneas 56 y 70) y reprograman.

Esquema `public.appointment_notifications` (verificado en DB): `notification_type text NOT NULL` (sin CHECK), permite cualquier string; ya existe columna `response`, `responded_at` (útil para guardar el resultado de la llamada) y `target_email`.

### 2) `send-reminders/index.ts` — procesamiento actual de `appointment_notifications`

- Líneas 233-243: `select` de `appointment_notifications` con `status='pending'` y `scheduled_at <= now()`, marca como `processing` (250-253).
- Líneas 269-286: resuelve `target_phone` / `target_email` (si falta phone usa `profiles.whatsapp_number/phone` del `target_user_id`).
- **La decisión de canal hoy NO usa `notification_type`.** Se decide por presencia de datos:
  - Líneas 300-317: si hay `targetPhone` y Twilio configurado → intenta WhatsApp (msg service SID primero, `From` como fallback).
  - Líneas 320-327: **fallback** a email vía Resend solo si WhatsApp falló y hay `targetEmail`.
- `notification_type` sólo se usa para elegir el asunto del email (líneas 321-326: `reminder_1h` → "Tu cita es en 1 hora", `reminder_24h` → "Recordatorio de tu cita para mañana"). Nunca ramifica por tipo.

Cómo diferenciaríamos `email` vs `voice_call`: hoy no existe rama. Habría que ramificar al inicio del loop (después de línea 289) por `notification_type`:
- `notification_type === 'email_24h'` (o `reminder_24h` reinterpretado) → sólo Resend, sin WhatsApp.
- `notification_type === 'voice_call_1h'` (o `reminder_1h` reinterpretado) → invocar función outbound-call (nueva). No tocar WhatsApp.

### 3) Infraestructura de LLAMADAS SALIENTES del agente

**Búsqueda exhaustiva de outbound calls (`rg` sobre `supabase/functions`):**

- `elevenlabs-twilio-setup/index.ts` (líneas 200-330): sólo **importa un número Twilio a ElevenLabs** (`POST /v1/convai/phone-numbers/create`) y **asigna el agente al inbound** (`PATCH /v1/convai/phone-numbers/{id}` con `agent_id`). No inicia llamadas.
- `call-inbound-webhook/index.ts` (línea 325): usa `POST https://api.elevenlabs.io/v1/convai/twilio/register-call` — es la ruta de **entrantes**, no outbound.
- `elevenlabs-bridge/index.ts`: WebSocket bridge para audio entrante, no inicia llamada.
- `call-transfer/index.ts` (líneas 246+): sí crea conferencias Twilio con dos legs outbound, pero **es para transferir una llamada activa a un empleado**, no para arrancar una llamada nueva del agente al cliente.
- `call-job-worker`, `call-webhook`, `call-status-webhook`, `elevenlabs-actions-webhook`, `elevenlabs-post-call`: sólo procesan estados/tools/post-call, no outbound.
- `voice-scheduling/index.ts`: sólo `check_availability` / `book`; no llama a nadie.

**Veredicto: NO existe una función que dispare una llamada saliente del agente RYBIX a un número.** No hay integración con el endpoint outbound de ElevenLabs `POST /v1/convai/twilio/outbound-call` (que espera `agent_id`, `agent_phone_number_id`, `to_number`, opcional `conversation_initiation_client_data` con `dynamic_variables`). Habría que crearla desde cero (p. ej. `supabase/functions/voice-outbound-call/index.ts`).

### 4) Config de telefonía del agente

- `agent_id` del tenant: en `public.tenants.elevenlabs_config->>'agent_id'` (verificado: master tenant tiene `"agent_id": "agent_4301kjgj2fjme5xv9d4ncvcvkgqx"`). Resolver oficial: `_shared/elevenlabs-agent.ts::resolveTenantAgentId`.
- `phone_number` Twilio saliente/entrante del tenant: `public.tenants.whatsapp_config->>'phone_number'` (master: `+12138163815`). También listado en `public.tenant_phone_numbers` (`phone_e164`, `provider='twilio'`, `active=true`, sin `twilio_subaccount_sid`).
- `agent_phone_number_id` de ElevenLabs: **NO se persiste en la BD.** `elevenlabs-twilio-setup/index.ts` línea 321 recibe `phoneNumberId` del import y lo devuelve al frontend pero solo lo guarda en `audit_events.resource_id` (línea 316), no en `tenants.elevenlabs_config` ni en `tenant_phone_numbers`. Para outbound necesitaríamos:
  - persistirlo (p. ej. `tenants.elevenlabs_config.agent_phone_number_id` o columna nueva en `tenant_phone_numbers`), o
  - resolverlo al vuelo llamando `GET /v1/convai/phone-numbers` y buscando por `phone_number` (más lento y frágil).

Secrets ya existentes: `ELEVENLABS_API_KEY` (managed connector), `ELEVENLABS_AGENT_ID`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`. Suficientes para el outbound de ElevenLabs.

### 5) Reagendar / cancelar y aviso a la contraparte

- **Calendario Google:** `calendar-sync/index.ts` expone `action='update_event'` (línea 44) y `'cancel_event'` (línea 49), además de `mirror_appointment/mirror_cancel/mirror_update` (líneas 68-80) para reflejar cambios post-Cal.com. Es la API interna a usar tras un reagendo/cancelación por voz.
- **Cal.com:** `calcom-sync` y `calcom-webhook` sincronizan bookings; `calcom-webhook` (línea 151) marca `status='cancelled'`. Si el tenant tiene `calcom_integrations` habría que llamar a Cal.com API para reprogramar (hoy no hay helper para actualizar booking; sólo lee).
- **Appointments:** columnas relevantes verificadas: `user_id` (el staff dueño de la cita), `contact_name/phone/email`, `start_at/end_at`, `status`, `calendar_event_id`, `calendar_sync_status`, `deleted_at`. Actualizar `start_at/end_at` dispara automáticamente el trigger `schedule_appointment_reminders` que **reprograma** los recordatorios (líneas 43-72 del migration), así que un reagendo emitirá nuevos 24h/1h por sí solo.
- **Aviso a la contraparte (staff):** no existe hoy un notificador dedicado. `appointment_notifications` sí soporta `target_user_id`, pero el trigger nunca lo llena para el cliente ni crea una fila para el staff. Al reagendar/cancelar habría que insertar una notificación con `target_user_id = appointments.user_id` (staff) y `notification_type = 'staff_update'` o similar, que `send-reminders` enviaría al `profiles.whatsapp_number/phone/email` del staff (rama existente en líneas 279-286).

### Mapa "qué existe / qué falta"

**Existe:**
1. Trigger `schedule_appointment_reminders` que ya inserta ambas notificaciones (`reminder_24h`, `reminder_1h`) con `target_email` y `target_phone` del cliente.
2. `send-reminders` con branch de email (Resend) — funcional.
3. `elevenlabs-twilio-setup` para importar/asignar el número al agente (inbound).
4. `elevenlabs-actions-webhook` + tools del agente para ejecutar acciones durante la llamada.
5. `calendar-sync` con `update_event` / `cancel_event` / `mirror_*`.
6. Reprogramación automática de recordatorios si cambian `start_at` (trigger `AFTER UPDATE`).
7. `appointment_notifications` con `response`, `responded_at` (aptos para "confirmada/reagendada/cancelada por el cliente en la llamada").

**Falta construir:**

A. **Ramificar por `notification_type` en `send-reminders`** (línea ~288). Nuevo mapa:
   - `reminder_24h` → sólo `sendEmail(...)` (bloquear rama WhatsApp).
   - `reminder_1h`  → invocar nueva función `voice-outbound-call` con `{ appointment_id, to_number: target_phone }`. Sin fallback a WhatsApp.

B. **Nueva edge function `voice-outbound-call`**: `POST https://api.elevenlabs.io/v1/convai/twilio/outbound-call` con headers `xi-api-key: ELEVENLABS_API_KEY` y body `{ agent_id, agent_phone_number_id, to_number, conversation_initiation_client_data: { dynamic_variables: { appointment_id, contact_name, date, time, service_type } } }`. Registrar el `call_sid` retornado en `appointment_notifications.response` (o metadata) para trazabilidad.

C. **Persistir `agent_phone_number_id`** por tenant (opción menos invasiva: `tenants.elevenlabs_config.agent_phone_number_id`). Actualizar `elevenlabs-twilio-setup/index.ts` línea ~321 para escribirlo (o hacer lookup diferido).

D. **Tools ElevenLabs para confirmar/reagendar/cancelar en la llamada** (añadir a `elevenlabs-actions-webhook`):
   - `confirm_appointment(appointment_id)` → `appointments.status='confirmed'`, `appointment_notifications.response='confirmed'`.
   - `reschedule_appointment(appointment_id, new_start_at)` → `UPDATE appointments SET start_at=..., end_at=...` (el trigger reprograma recordatorios) + `calendar-sync {action:'update_event'}` + `calcom` update (si aplica) + insertar notificación al staff.
   - `cancel_appointment(appointment_id, reason?)` → `UPDATE appointments SET status='cancelled', deleted_at=...` (el trigger cancela pendings) + `calendar-sync {action:'cancel_event'}` + notificación al staff.
   Con estas ya existe framework; sólo se registran como Server-Side Tools del agente.

E. **Notificación al staff (contraparte)** en reschedule/cancel: `INSERT INTO appointment_notifications (appointment_id, tenant_id, target_user_id=user_id, notification_type='staff_update', message_body=..., scheduled_at=now())` — `send-reminders` ya sabe resolverlo por `target_user_id` (líneas 279-286). Podría enviarse por email si prefieres uniformidad.

F. **Bloquear reintentos WhatsApp** para los tipos nuevos (evita regresar al bug 63007 actual).

G. Opcional: bandera `reminder_channel` en `appointments` o `tenants.notification_rules` para permitir apagar la llamada de 1h por tenant.

### Riesgos / notas
- La llamada saliente cuesta minutos Twilio + créditos ElevenLabs; conviene respetar `assertVoicePlan` (ya usado en `voice-scheduling`) antes de disparar.
- Si el `contact_phone` no está en E.164 correcto, ElevenLabs rechaza el outbound; reusar la normalización que ya vive en `twilio-send` (regex `+521…`).
- Si el tenant no tiene `agent_phone_number_id` persistido y no encontramos el número en `/v1/convai/phone-numbers`, hay que fallback a email para no perder el aviso.

Ningún cambio realizado. Este plan es sólo diagnóstico + mapa de lo que faltaría.
