
# Diagnóstico y plan de corrección

## 1) Pestaña Equipo → 403 "No autorizado"

**Causa raíz** — `supabase/functions/team-management/index.ts:42-46`:

```ts
const { data: callerRole } = await adminClient
  .from("user_roles")
  .select("role, tenant_id")
  .eq("user_id", caller.id)
  .maybeSingle();   // ← FALLA
```

El usuario `admin@rybixholding.com` tiene **dos filas** en `user_roles` (`super_admin` y `owner` — se ve claramente en el network log del request `user_roles?select=role...`). `.maybeSingle()` de PostgREST devuelve error/`null` cuando hay >1 fila, entonces `callerRole` queda `null` y cae en el 403 de la línea 48.

**Fix quirúrgico:** cambiar a `.select("role, tenant_id")` sin `maybeSingle()`, y validar con `.some(r => ['super_admin','owner'].includes(r.role))`. Usar `callerRole[0].tenant_id` (o preferir la fila de `owner` para el tenant) para el filtro de `list_status`. Sin cambios de RLS/GRANT.

---

## 2) Agente no crea reserva en Cal.com

**Diagnóstico** — `supabase/functions/whatsapp-bot/tool-executor.ts:317-384`:

- El flujo **sí** intenta llamar a `https://api.cal.com/v2/bookings` (línea 347).
- Pero está gateado por `if (calcomInteg?.api_key_encrypted && calcomInteg?.default_event_type_id)` (línea 327). Si `default_event_type_id` es `NULL` en `calcom_integrations`, entra al `else if` de la línea 379 y solo hace `console.warn` sin devolver señal al agente.
- El resultado devuelto al modelo (`success: true`) **nunca** menciona `calcom_pushed=false` ni la razón, así que la IA cree que todo salió bien.

**Fix:**
- (a) Incluir en la respuesta JSON de éxito los flags `calcom_pushed` y `calcom_skipped_reason` (`"missing_default_event_type"`, `"api_error"`, `"no_integration"`) para que el bot pueda avisar al usuario/dueño.
- (b) Añadir un log de auditoría en `audit_events` cuando se salta por `default_event_type_id` faltante, para que el super_admin lo vea en la UI de integraciones.
- **No** setear un event_type_id ficticio. El usuario debe configurarlo en Integraciones → Cal.com (fuera del alcance de este fix de código).

---

## 3) Agente no refleja cita en Google Calendar

**Diagnóstico** — `supabase/functions/whatsapp-bot/tool-executor.ts:296-315` + `supabase/functions/calendar-sync/index.ts:104-142`:

- `schedule_appointment` **sí** invoca `calendar-sync` (línea 299) con `action: 'sync_appointment'`.
- Pero `calendar-sync` solo crea el evento si el `appointments.user_id` está seteado **y** ese `user_id` tiene token activo en `google_calendar_tokens`.
- Si el agente no encontró empleado (porque el cliente no dijo con quién) → `employeeId=null`, y `apt.user_id` puede quedar `null`. `calendar-sync` intenta fallback por `availability_rules` (línea 111) pero si no hay reglas o el empleado encontrado no tiene token → marca `PENDING_SYNC` y sale.
- El bot no recibe señal de esto (el `syncResult.success` se ignora salvo por un `console.log`).

**Fix:**
- (a) Devolver `google_calendar_synced` y `google_calendar_reason` en el JSON del tool para que la IA no diga "ya quedó en tu calendario" si no es cierto.
- (b) Complementa con Fix #5 (forzar `employee_name`), que resuelve la causa mayoritaria.

---

## 4) Cita queda "confirmada" sin confirmación del cliente

**Diagnóstico** — `supabase/functions/whatsapp-bot/tool-executor.ts:286`:

```ts
status: 'scheduled',
```

El estado real en DB se guarda como `scheduled` (correcto — no dice `confirmed`). El problema es **cómo lo comunica el bot**: el prompt actual (`prompts.ts`) tiene reglas de "confirma en UNA línea" y el mensaje automático de WhatsApp que se envía al contacto (línea 395) sí pide `CONFIRMO/CANCELO`, pero la IA le dice al empleado "ya está confirmada".

**Fix:**
- (a) En `prompts.ts` añadir regla explícita: "Una cita recién agendada queda en estado *programada* (pending confirmation). NO digas 'confirmada' hasta que el cliente responda CONFIRMO. Usa lenguaje como '📅 Cita agendada, se le pidió confirmación al cliente'."
- (b) En el JSON de retorno de `executeScheduleAppointment` incluir `status: 'scheduled'` y `awaiting_client_confirmation: true` para reforzar.
- **No** cambiar el valor en DB (correcto tal cual).

---

## 5) No pregunta con quién ni motivo (empleado / service_type)

**Diagnóstico** — `supabase/functions/whatsapp-bot/tools.ts:20`:

```ts
required: ['contact_name', 'date', 'time'],
```

`employee_name` y `service_type` están marcados como **opcionales**. El prompt (`prompts.ts` `buildClientPrompt`) instruye "EJECUCIÓN INMEDIATA: si tienes suficiente info, ejecuta ya". Con solo nombre+fecha+hora, la IA dispara la tool sin preguntar por empleado ni motivo. Además, si `employee_name` viene vacío, `employeeId` queda `null` → cascada al Fix #3.

**Fix:**
- (a) En `prompts.ts` (cliente y empleado), añadir bloque específico de **REGLA DE AGENDADO**: "Antes de llamar `schedule_appointment` DEBES tener: nombre completo del contacto, correo del contacto, fecha, hora, **motivo/servicio** y **con qué empleado**. Si falta CUALQUIERA, pregunta en UN solo mensaje amable (sin robotearlo) por los faltantes. Solo ejecuta cuando tengas los 6."
- (b) Actualizar `description` de `contact_email`, `employee_name` y `service_type` en `tools.ts` explicando que son necesarios para Cal.com/asignación. **No** cambiar `required` en el schema (rompería casos internos), la disciplina se aplica vía prompt.

---

## 6) No captura nombre completo ni email del cliente (bloquea Cal.com)

**Diagnóstico** — mismo `tools.ts:11-13`: `contact_email` es opcional. En `tool-executor.ts:346`, si no hay email, se fabrica uno falso `${phone}@wa.local` que Cal.com aceptará pero no podrá enviar correo real de confirmación.

**Fix:**
- Cubierto por Fix #5 (regla en el prompt exige email antes de ejecutar).
- Adicional en `tool-executor.ts:346`: si el email quedó como `*@wa.local`, no enviar a Cal.com y devolver `calcom_skipped_reason: 'missing_client_email'`. Así el agente sabe que debe pedirlo.

---

## Alcance de archivos a tocar

| Archivo | Cambio |
|---|---|
| `supabase/functions/team-management/index.ts` | Fix #1: reemplazar `.maybeSingle()` por manejo multi-rol |
| `supabase/functions/whatsapp-bot/tool-executor.ts` | Fixes #2, #3, #4, #6: enriquecer respuesta JSON con flags; skip Cal.com si email fake |
| `supabase/functions/whatsapp-bot/prompts.ts` | Fixes #4, #5: REGLA DE AGENDADO + no decir "confirmada" |
| `supabase/functions/whatsapp-bot/tools.ts` | Fix #5: aclarar descripciones de campos (sin tocar `required`) |

**Fuera de alcance (respetado):** ElevenLabs, `call-transfer*`, `elevenlabs-*`, `twilio-*`, RLS, GRANTs, migraciones. El 403 de Equipo **no** requiere cambio de RLS — es lógica de código dentro de la edge function con service_role.

## Detalles técnicos

- El JSON extendido de `schedule_appointment` quedaría:
  ```json
  {
    "success": true,
    "appointment_id": "...",
    "status": "scheduled",
    "awaiting_client_confirmation": true,
    "google_calendar_synced": false,
    "google_calendar_reason": "no_token_for_assigned_user",
    "calcom_pushed": false,
    "calcom_skipped_reason": "missing_default_event_type"
  }
  ```
- La IA, con la nueva regla del prompt, traducirá esto a: "📅 Agendé la cita de Juan para mañana 4pm. Se le pidió confirmación por WhatsApp. Ojo: no se sincronizó con Google Calendar porque el empleado asignado no tiene su calendario conectado."

¿Apruebas el plan para pasar a modo build?
