# Plan · 3 fixes (Recordatorios + Cal.com WhatsApp)

Cero migraciones · cero cambios en RLS/GRANT · cero cambios en columnas secretas · sin tocar funciones `whatsapp-*` / `twilio-*` ni la config de ElevenLabs.

---

## FIX 2 · Recordatorios personales usan sender del tenant

**Archivo único:** `supabase/functions/send-reminders/index.ts`

1. **Batch-fetch de tenants antes del bucle de reminders** (insertar después de la línea 81, es decir tras armar `profileMap` y antes del `for (const reminder of reminders)`):
   - `tenantIdsR = [...new Set(reminders.map(r => r.tenant_id))]`
   - `SELECT id, whatsapp_config FROM tenants WHERE id IN (...)`
   - Construir `tenantConfigMapR = Map<tenantId, whatsapp_config>` (misma forma que la Parte 2, líneas 193–198, pero variable independiente para no chocar cuando ambas partes corran en la misma invocación).

2. **Dentro del bucle Parte 1** (justo antes de la línea 109, `sendWhatsApp(...)`):
   - Resolver sender EXACTAMENTE como Parte 2 (líneas 224–240):
     ```
     const wa = tenantConfigMapR.get(reminder.tenant_id) as Record<string, any> | null;
     const tFrom = wa?.phone_number ? String(wa.phone_number).replace(/^whatsapp:/i, '') : null;
     const tMsgSvc = wa?.messaging_service_sid ? String(wa.messaging_service_sid).trim() : null;
     const effectiveFrom = tFrom
       ? (tFrom.startsWith('whatsapp:') ? tFrom : `whatsapp:${tFrom}`)
       : fromWA;   // fallback al TWILIO_PHONE_NUMBER global si el tenant no configura nada
     ```
   - Sustituir la llamada actual `sendWhatsApp(basicAuth, TWILIO_ACCOUNT_SID, fromWA, phone, reminderMsg)` por el mismo patrón MsgSvc-primero-luego-From de Parte 2 (líneas 233–240):
     ```
     let sendResult;
     if (tMsgSvc) {
       sendResult = await sendWhatsAppWithMsgSvc(basicAuth, TWILIO_ACCOUNT_SID, phone, reminderMsg, tMsgSvc);
       if (!sendResult.ok) sendResult = await sendWhatsApp(basicAuth, TWILIO_ACCOUNT_SID, effectiveFrom, phone, reminderMsg);
     } else {
       sendResult = await sendWhatsApp(basicAuth, TWILIO_ACCOUNT_SID, effectiveFrom, phone, reminderMsg);
     }
     ```

3. **No modificar**: helpers (`sendWhatsApp`, `sendWhatsAppWithMsgSvc`), Parte 2, manejo de retry/backoff, guardado a `whatsapp_messages`, RPC `claim_due_reminders`, ni la construcción del `reminderMsg`.

**Efecto esperado:** los 3 reminders fallidos del tenant RYBIX volverán a intentarse por `MessagingServiceSid=MG6c…7cfded` (mismo canal que las notificaciones de cita, que ya funcionan) y Twilio dejará de devolver `63007`.

---

## FIX 3a · Selección real de event type en la conexión de Cal.com

### A. `supabase/functions/calcom-sync/index.ts`

Añadir dos sub-acciones dentro del `try` que hoy maneja `connect | disconnect | pull_bookings`:

1. `action === 'list_event_types'`:
   - Body: `{ api_key?: string }`.
   - Si viene `api_key` en el body, usarla directamente (para el momento del wizard antes de guardar). Si no viene, cargar y desencriptar la de `calcom_integrations` del tenant del caller (reutiliza el helper `encrypt/decrypt` ya existente en el archivo).
   - `GET https://api.cal.com/v2/event-types` con `Authorization: Bearer <key>` y `cal-api-version` acorde a la usada hoy en `pull_bookings` (mantener consistencia con el resto del archivo).
   - Si `!res.ok` → `return json({ error: 'Cal.com …' }, 502)`.
   - Mapear la respuesta a `[{ id, title, slug, length }]` — soportando ambas formas típicas de la API (`data.eventTypes[*]` o array plano) sin romperse si el shape cambia (usar acceso defensivo).
   - Responder `json({ ok: true, event_types: [...] })`.

2. `action === 'set_default_event_type'`:
   - Body: `{ default_event_type_id: string | number }`.
   - Validar que exista una integración `active` para el tenant del caller (`.eq('tenant_id', tenantId).maybeSingle()`), sino `400`.
   - `UPDATE public.calcom_integrations SET default_event_type_id = <string>, updated_at = now() WHERE tenant_id = <tenantId>`.
   - Responder `json({ ok: true })`.

Ambas sub-acciones respetan la misma verificación de sesión que ya hace el resto de la función (bloque de resolución de `user` y `tenantId`). Cero cambios en RLS/GRANT: el update lo hace el service-role client que ya se usa allí, filtrando por el `tenantId` derivado del JWT del caller.

### B. `src/pages/IntegrationsPage.tsx` (diálogo Cal.com, alrededor de líneas 322–339)

Estado nuevo local al diálogo:
- `calcomEventTypes: Array<{ id: string|number; title: string; slug?: string; length?: number }>`
- `calcomSelectedEventType: string`
- `calcomLoadingTypes: boolean`

Flujo del diálogo:
1. Campo API key existente.
2. Nuevo botón/acción "Buscar tipos de evento":
   - Llama `supabase.functions.invoke('calcom-sync', { body: { action: 'list_event_types', api_key: calcomApiKey.trim() } })`.
   - Setea `calcomEventTypes` en éxito; toast.error en fallo. Limpia `calcomSelectedEventType` cuando cambia la api key.
3. `<Select>` (shadcn) con los tipos: label = `"{title} · {length} min"`, value = `String(id)`. Deshabilitado si `calcomEventTypes.length === 0`.
4. Botón "Conectar":
   - `disabled` cuando `!calcomApiKey.trim() || !calcomSelectedEventType`.
   - En `handleConnectCalcom`, agregar `default_event_type_id: calcomSelectedEventType` al body del `connect`.
5. Al cerrar el diálogo o abrirlo de nuevo, resetear `calcomEventTypes` y `calcomSelectedEventType` (para no filtrar tipos de una key vieja).

Nota UX: el `connect` ya persiste `default_event_type_id` (línea 118 de `calcom-sync/index.ts`) — no hace falta llamar `set_default_event_type` en el wizard nuevo. La sub-acción `set_default_event_type` queda disponible como API para futuras pantallas de "Cambiar tipo por defecto" sin reingresar la key.

**No cambia**: dedup en `calcom-webhook/index.ts:255–258` (sigue merging por `calcom_event_id`), status de la integración, encriptación del api key, ni el flujo `disconnect`/`pull_bookings`.

---

## FIX 3b · Log de diagnóstico en whatsapp-bot (sin cambio funcional)

**Archivo único:** `supabase/functions/whatsapp-bot/tool-executor.ts`

- Alrededor de la línea 376 (rama del `if (calcomInteg?.api_key_encrypted && calcomInteg?.default_event_type_id)`), añadir un `else if` que dispare únicamente un `console.warn`:
  ```
  } else if (calcomInteg?.status === 'active' && calcomInteg?.api_key_encrypted && !calcomInteg?.default_event_type_id) {
    console.warn('[APPT] Cal.com integration active but default_event_type_id missing — skipping push', { tenantId });
  }
  ```
- Nada más: no retornos nuevos, no cambios en `calcomPushed`, no cambios en el response del tool, no cambios en `appointments.calendar_event_id`. Solo un log para que en logs de la función quede la razón exacta si vuelve a pasar.

---

## Verificaciones post-cambio

1. `tsgo --noEmit` limpio.
2. `supabase/functions/send-reminders`: invocar manualmente con `supabase.functions.invoke('send-reminders')` — los reminders fallidos vuelven a intentarse; los que no tienen `messaging_service_sid` ni `phone_number` en el tenant siguen usando `fromWA` (fallback).
3. UI `/integrations`:
   - Desconectar Cal.com de RYBIX, reconectar con la misma key → aparece el select con event types, "Conectar" queda bloqueado hasta elegir uno.
   - Tras conectar: `SELECT default_event_type_id FROM calcom_integrations WHERE tenant_id='…-0001'` deja de ser NULL.
4. Prueba WhatsApp: agendar cita → `appointments.calendar_event_id` empieza con `calcom:` y aparece en Cal.com. Si vuelve a estar sin event type, los logs de `whatsapp-bot` mostrarán la línea `[APPT] Cal.com integration active but default_event_type_id missing`.
5. Dedup Cal.com intacto: si el webhook llega antes que el push, `calcom-webhook/index.ts:255` sigue marcando `booking_merged`.

## No-regresión confirmada

- Cero migraciones, cero cambios de RLS/GRANT.
- Sin tocar `whatsapp-webhook`, `whatsapp-*`, `twilio-*`, `elevenlabs-*`, `call-transfer*`, ni la configuración del agente de voz.
- Sin cambios en columnas secretas (`pin_hash`, `access_token`, `refresh_token`) ni en las restricciones de columna aplicadas por la migración de seguridad reciente.
- Parte 2 de `send-reminders` (notificaciones de cita) se deja idéntica.
- Ningún archivo distinto a los tres listados se modifica: `supabase/functions/send-reminders/index.ts`, `supabase/functions/calcom-sync/index.ts`, `src/pages/IntegrationsPage.tsx`, `supabase/functions/whatsapp-bot/tool-executor.ts`.
