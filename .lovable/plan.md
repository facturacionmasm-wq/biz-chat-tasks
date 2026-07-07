# Diagnóstico (solo lectura) — 3 problemas del Voice Agent

## Problema 1 · No transfiere llamadas

**Flujo actual**
- Herramienta `transfer_call` registrada por `supabase/functions/elevenlabs-staff-sync/index.ts` L118–L163 (`buildTransferTool`). Apunta directo a `${SUPABASE_URL}/functions/v1/call-transfer` con `POST` y body `{ target_user_id (enum), department (enum), reason }`. **No incluye `Authorization` en `request_headers`** (solo `Content-Type`).
- Directorio de personal y `enum` de `target_user_id` se construyen en `loadTenantDirectory` (L165–L206) desde `profiles` del tenant. La sección "CONTACTO Y ÁREA PARA TRANSFERENCIAS" que ve el usuario en Configuración/Equipo alimenta `profiles.department` + `profiles.phone`, que a su vez pobla el enum y el prompt (`STAFF_DIRECTORY` L47–L82).
- `supabase/functions/call-transfer/index.ts`:
  - **MODE A (interno)** L145–L243: requiere `Authorization: Bearer <SERVICE_ROLE_KEY>` y espera `{ tenant_id, target_phone, target_name, call_sid, caller_phone, ... }`.
  - **MODE B (JWT usuario)** L246–L410: requiere `Authorization` de usuario y espera `{ target_user_id, caller_phone }`.

**Causa raíz (dos bugs concatenados)**
1. La tool registrada NO manda ninguna cabecera `Authorization` → cae fuera de MODE A. Al no haber `authHeader`, MODE B devuelve `401 "No autorizado"` (L249–L251).
2. Aunque llegara a MODE B, la tool sólo envía `target_user_id`/`department`/`reason`. **Faltan `caller_phone` y `call_sid`**, por lo que la validación L270 devolvería `400 "target_user_id y caller_phone son requeridos"` y no habría forma de redirigir la llamada Twilio en vivo (MODE B necesita `caller_phone` para lanzar el segundo leg; MODE A necesita `call_sid` para el redirect en vivo).

Confirmado con logs: `call-transfer` sólo muestra boots/shutdowns sin logs de request procesada; `elevenlabs-actions-webhook` (que sí resolvería `call_sid`/`caller_phone` desde `call_records` y usaría MODE A vía service-role, L156–L206) **no tiene ni un solo log** → el agente NUNCA la invoca porque no está registrada como tool.

**Fix mínimo propuesto** (solo `elevenlabs-staff-sync/index.ts`, sin tocar prompts, RLS, ni pin-service):
- En `buildTransferTool` (L118–L163) cambiar `api_schema.url` a `${SUPABASE_URL}/functions/v1/elevenlabs-actions-webhook`.
- Cambiar `name` a `transfer_call` (queda igual) y `request_body_schema.properties` para que sean los que espera `elevenlabs-actions-webhook`:
  - `tool_name: "transfer_call"` (constante, para el switch de L86 en actions-webhook), 
  - `target_phone` (string) y `target_name` (string) — resolver el teléfono desde el directorio del prompt en lugar de `target_user_id`.
- Añadir en `request_headers` la cabecera `x-elevenlabs-secret` con `{{ELEVENLABS_WEBHOOK_SECRET}}` (secreto ya existente) para pasar el guard L28–L40 de actions-webhook.
- Actualizar el bloque del prompt (`buildStaffBlock` L47–L82) para instruir al agente a pasar `target_phone`+`target_name` en vez de `target_user_id` (edición mínima, no toca personalidad).
- `elevenlabs-actions-webhook` ya extrae `call_sid`/`call_record_id`/`tenant_id` desde `dynamic_variables` inyectadas por `call-inbound-webhook/register-call` (ver L59–L74 y L156–L206) y llama a `call-transfer` en MODE A con service-role — no requiere cambios.

Después: correr manualmente `elevenlabs-staff-sync` para el tenant afectado para re-publicar la tool corregida.

---

## Problema 2 · No agenda citas

**Flujo esperado**
- `elevenlabs-actions-webhook` L91–L136 traduce `check_availability` / `book_appointment` / `reschedule_appointment` / `cancel_appointment` a llamadas a `voice-scheduling` con service-role. La inserción real se hace en `voice-scheduling/index.ts` L232–L358 (insert a `appointments` con service-role → bypass de RLS).

**Causa raíz**
- **Las tools de agendamiento nunca se registran en el agente.** `elevenlabs-staff-sync` solo publica `transfer_call` (L347–L350). `elevenlabs-agent-provision` L106–L124 crea el agente sólo con `agent.prompt/first_message/language/tts` — **sin ningún `tools[]`**. No hay ninguna función que haga `PATCH` para añadir `check_availability`/`book_appointment` al `conversation_config.agent.prompt.tools`.
- Logs confirman el diagnóstico: `voice-scheduling` no tiene NINGÚN log de ejecución, y `elevenlabs-actions-webhook` tampoco → el agente jamás dispara el webhook porque no conoce la tool.
- Además, aunque estuviera registrada, `elevenlabs-actions-webhook` L88 espera `date`+`time` (strings), construye `start_at = ${date}T${time}:00`. Si el agente enviara sólo `start_at` (formato usado por `voice-scheduling`), fallaría con "Necesito la fecha y hora". Es un riesgo secundario a alinear.

**Tablas/RLS relevantes**
- `appointments`: la escritura en `voice-scheduling` usa service-role, así que RLS no bloquea. Requiere `tenant_id`, `contact_name`, `start_at` (validado L235–L237). No hay problema de RLS aquí.

**Fix mínimo propuesto** (dos archivos, sin tocar RLS, prompts base, ni Stripe webhook):
1. `supabase/functions/elevenlabs-staff-sync/index.ts` (~L341–L358 y `buildTransferTool` cercano): añadir builders `buildCheckAvailabilityTool`, `buildBookAppointmentTool`, `buildRescheduleTool`, `buildCancelTool` — todos webhook → `elevenlabs-actions-webhook` con:
   - Header `Content-Type: application/json` + `x-elevenlabs-secret: {{ELEVENLABS_WEBHOOK_SECRET}}`
   - `request_body_schema` idéntico a lo que consume `elevenlabs-actions-webhook` L91–L136 (`date`, `time`, `contact_name`, `contact_phone`, `service_type`, `appointment_id`, etc.).
   - Incluir `tool_name` constante para que el switch de actions-webhook resuelva la acción.
   - Incluir en el `nextToolsRaw` (L354–L357) el filtrado `t.name !== <cada tool>` antes de reinsertar (mismo patrón que `transfer_call`).
2. En `buildStaffBlock` o un nuevo bloque delimitado del prompt, instruir cuándo llamar cada tool (mínimo textual, no reescribir personalidad).

No se requiere cambio en `voice-scheduling` ni en `appointments` (tabla, RLS o columnas).

---

## Problema 3 · Duración máxima de llamada = 5000 s

**Dónde vive hoy**
- `conversation_config.conversation.max_duration_seconds` es una propiedad del agente en ElevenLabs. Búsqueda en el repo: **no está seteada por código** (`rg max_duration_seconds` → 0 resultados). Ni `elevenlabs-agent-provision/index.ts` L106–L124 ni `elevenlabs-staff-sync/index.ts` L390–L399 tocan ese campo.
- Por lo tanto el valor actual está **en la config del agente en el Dashboard de ElevenLabs**, no en Supabase. Cada tenant tiene su propio `agent_id` en `tenants.elevenlabs_config.agent_id` (ver `_shared/elevenlabs-agent.ts`).

**Fix mínimo propuesto**
- Añadir al `PATCH` de `elevenlabs-staff-sync/index.ts` en `patchBody.conversation_config` (L391–L399) un bloque nuevo:
  ```
  conversation_config.conversation = { max_duration_seconds: 5000 }
  ```
  (misma llamada existente, no requiere endpoint nuevo). Con `elevenlabs-staff-sync` ejecutándose ya tras cualquier cambio de personal, el valor se propaga.
- Alternativa aditiva (opcional, para nuevos tenants): incluirlo también en `elevenlabs-agent-provision/index.ts` en `conversationConfig` (L112–L120) al momento de crear.

No requiere migraciones, secretos nuevos, ni cambios en RLS.

---

## Resumen de archivos y líneas a tocar (sin aplicar)

| # | Archivo | Líneas | Cambio |
|---|---|---|---|
| 1 | `supabase/functions/elevenlabs-staff-sync/index.ts` | 118–163 | Reapuntar `transfer_call` a `elevenlabs-actions-webhook`, cambiar payload a `target_phone`+`target_name`, añadir header `x-elevenlabs-secret` |
| 2 | `supabase/functions/elevenlabs-staff-sync/index.ts` | 47–82 | Ajustar texto del bloque STAFF para pedir `target_phone`/`target_name` |
| 3 | `supabase/functions/elevenlabs-staff-sync/index.ts` | ~340–360 | Añadir tools `check_availability`, `book_appointment`, `reschedule_appointment`, `cancel_appointment` apuntando a `elevenlabs-actions-webhook` |
| 4 | `supabase/functions/elevenlabs-staff-sync/index.ts` | 390–399 | Añadir `conversation_config.conversation.max_duration_seconds = 5000` en el PATCH |
| 5 | (opcional) `supabase/functions/elevenlabs-agent-provision/index.ts` | 106–124 | Sembrar `max_duration_seconds=5000` al crear |

**No se tocan**: RLS, `appointments` schema, `pin-service`, vista Calendario, `stripe-webhook`, `voice-scheduling`, prompts fuera de los bloques delimitados `STAFF_DIRECTORY_*`, tipos generados de Supabase.

Confirmado por logs: `voice-scheduling` y `elevenlabs-actions-webhook` sin ejecuciones registradas → las tools nunca se disparan porque no están en el agente. Al aplicar los cambios y reejecutar `elevenlabs-staff-sync` por tenant, el agente pasa a tener transfer_call funcional + scheduling + timeout de 5000 s.
