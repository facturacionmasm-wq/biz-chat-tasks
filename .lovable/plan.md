
# Diagnóstico con evidencia real (no inventada)

## Cita analizada
Último appointment del tenant `00000000-...-001` creado desde WhatsApp:

| Campo | Valor real en DB |
|---|---|
| id | `863bc2eb-6e04-4d7b-85d9-c2faf24bf1df` |
| contact_name | `Roberto Carlos` (¿la prueba que llamaste "Marco Sosa" quedó guardada con otro nombre?) |
| start_at | `2026-07-06 16:00:00+00` (10:00 hora local) |
| contact_phone | `+5219993102413` |
| contact_email | `facturacionmasm@gmail.com` |
| user_id | `2f5fa519-...` (Marco Sosa, empleado) |
| calendar_sync_status | `SYNCED` |
| calendar_event_id | `7uc9ubkktqiscjghivtb9m3n88` ← **Google Calendar ID**, no lleva prefijo `calcom:` |
| source | `whatsapp` |

Y en `calcom_integrations`: `status=active`, `default_event_type_id=5780532`, `api_key_encrypted` presente. **No es NULL.**

Y en `audit_events` con filtro `%calcom%`: **0 filas** → no se disparó `calcom_push_skipped`, es decir el código entró al bloque de push real, no a un `else if` de skip.

---

## 1) CAL.COM NO CREA LA RESERVA — causa raíz confirmada

Log real de la edge function `whatsapp-bot`:

```
[APPT] Cal.com push failed: 400
{"status":"error","path":"/v2/bookings","error":{"code":"BadRequestException",
 "message":"User either already has booking at this time or is not available", …}}
```

- **`calcom_skipped_reason` = `api_error_400`** (línea 403 de `tool-executor.ts`).
- No es `missing_default_event_type`, no es `missing_client_email`, no es `no_integration`.
- Cal.com responde 400 porque el owner del `eventTypeId=5780532` **ya está ocupado** a esa hora en su calendario. La causa mecánica es esta secuencia en `tool-executor.ts`:

  1. Línea 301-321 → `calendar-sync` corre **primero** y crea el evento en Google Calendar del empleado (por eso `calendar_event_id` es de Google y `SYNCED=true`).
  2. Línea 326-407 → **después** intenta Cal.com. Cal.com tiene el Google Calendar del owner como *conflict calendar* (comportamiento por defecto), lee el evento que acabamos de crear y devuelve 400 "already has booking / not available".
  3. Como el push falla, la línea 398 nunca ejecuta y `calendar_event_id` queda como el ID de Google, no `calcom:...`.

  Es un **auto-conflicto**: nuestro propio push a Google bloquea el push a Cal.com. La validación de solapamiento local (líneas 190-231) no lo detecta porque solo mira `availability_rules` y `appointments` de la BD, no el calendario de Cal.com.

- Efecto secundario: aunque Cal.com sí es la fuente que envía correo al cliente (`camaranidia1@gmail.com`, `alejandrocetinafuentes@gmail.com`, etc., citas ingresadas por Cal.com aparecen con `calcom:` en el `calendar_event_id`), en este caso el cliente **no recibió correo de confirmación**.

## 2) TELÉFONO "INVENTADO" — causa raíz confirmada

En DB el teléfono guardado es `+5219993102413`, que es exactamente el número que WhatsApp registra como `whatsapp_conversations.contact_phone` del remitente (aparece de primero en el `SELECT` que hice). No está inventado por el modelo; lo escribe el código.

`tool-executor.ts:278`:
```ts
contact_phone: cPhone || contactPhone || null,
```
- `cPhone` viene del argumento `contact_phone` del tool (opcional en `tools.ts:12`).
- `contactPhone` viene de `conversation.contact_phone` (línea 16 y firma 140): **el número del remitente de WhatsApp**.
- Cuando el modelo no manda `contact_phone` (porque el cliente no lo dio), el código **asume que el contacto es el remitente**. En una prueba donde tú (dueño/empleado) agendas a un tercero desde tu WhatsApp, el `contactPhone` de fallback es *tu propio número*, no el del cliente. Eso es lo que ves como "teléfono inventado".
- Además, la descripción del parámetro en `tools.ts:12` (`"Teléfono del contacto en formato +521234567890 (si se tiene)"`) usa un número de ejemplo que puede sesgar al modelo a copiarlo si no tiene dato — vale la pena reforzar el texto pero **el bug real es el fallback silencioso a `contactPhone`**.

Nota: el `contact_phone` **no** se envía a Cal.com (líneas 384-389 solo mandan `name/email/timeZone/language`), así que este bug no contribuye al 400 de Cal.com. Sí ensucia el registro y aparece en las notificaciones/UI.

## 3) EMAIL DEL CLIENTE

En esta prueba llegó bien: `facturacionmasm@gmail.com` (no vacío, no `@wa.local`). El guard de línea 350 no se activó. Aquí no hay bug: el modelo obtuvo el email real del contacto.

---

# Plan de corrección quirúrgico (dentro del alcance permitido)

Sin migraciones, sin RLS/GRANT, sin tocar ElevenLabs ni `call-transfer*`/`elevenlabs-*`/`twilio-*`.

### Fix A — Cal.com push antes que Google, y no ensuciar Google si Cal.com fallará
Archivo: `supabase/functions/whatsapp-bot/tool-executor.ts`

- **Reordenar** el bloque Cal.com (actual líneas 323-411) para que ejecute **antes** del bloque de `calendar-sync` (actual líneas 296-321).
- Si Cal.com responde 200 → Cal.com ya inserta el evento en el Google Calendar del owner vía su propia integración; **saltar** el `calendar-sync` local para no duplicar. Guardar `calendar_event_id = calcom:<uid>` (ya existe la línea 399).
- Si Cal.com falla o se skipea (`no_integration`, `missing_default_event_type`, `missing_client_email`, `api_error_*`) → *entonces* correr `calendar-sync` como respaldo (comportamiento actual). Así, en cuentas sin Cal.com o cuando Cal.com no aplica, seguimos teniendo Google Calendar.
- Devolver en el JSON: `calcom_pushed`, `calcom_skipped_reason`, `google_calendar_synced`, `google_calendar_reason` (ya existen los flags, solo reflejar el nuevo orden). Añadir además `calcom_error_snippet` cuando `api_error_*` para que el prompt pueda avisar al empleado la razón textual ("el calendario ya tiene una cita a esa hora en Cal.com").

Esto elimina el auto-conflicto que hoy convierte el 100% de los agendados con empleado con Google conectado en `api_error_400` en Cal.com.

### Fix B — No inventar el teléfono del contacto con el número del remitente
Archivo: `supabase/functions/whatsapp-bot/tool-executor.ts`

- Línea 278: cambiar `contact_phone: cPhone || contactPhone || null` a:
  - Cliente en modo cliente (el remitente ES el contacto → conocido porque `conversation.bot_context?.role === 'client'`): mantener fallback `cPhone || contactPhone || null`.
  - Empleado en modo empleado (`role === 'employee'`, agendando para un tercero): usar **solo** `cPhone || null` (no heredar el número del empleado).
- Alternativa mínima si no quieres depender del `role`: usar solo `cPhone || null` siempre y dejar que el prompt le pida el teléfono al usuario cuando falte. Es lo más simple y elimina la fabricación de raíz.
- Actualizar `tools.ts:12` para quitar el número de ejemplo y aclarar: `"Teléfono del contacto en E.164 (ej: +52 seguido del número). Deja vacío si el cliente no lo proporcionó — NO inventes ni copies el teléfono del remitente."`

### Fix C — Ajuste al prompt para el nuevo flag `calcom_error_snippet`
Archivo: `supabase/functions/whatsapp-bot/prompts.ts`

Añadir en la regla ya existente sobre `calcom_pushed=false`: "si `calcom_skipped_reason` empieza con `api_error_` y hay `calcom_error_snippet`, cítalo textual al empleado (ej: 'Cal.com rechazó: ya hay una cita a esa hora en el calendario del empleado')". Esto evita que el bot te diga "no pudo crear la reserva en Cal.com" sin más contexto.

### Fuera de este plan (necesita acción del usuario, no código)
- El `eventTypeId 5780532` de Cal.com tiene el Google Calendar del owner como *conflict calendar*. Con Fix A ya no auto-generamos el conflicto, pero **si el owner tiene una cita real en Google a esa hora**, Cal.com seguirá diciendo 400. Ese caso sí es correcto y el bot debe ofrecer otro horario. Nada que arreglar en código.

## Archivos a tocar (build futuro)
| Archivo | Cambio |
|---|---|
| `supabase/functions/whatsapp-bot/tool-executor.ts` | Reordenar Cal.com antes de calendar-sync (Fix A) + no heredar phone del sender (Fix B) + exponer `calcom_error_snippet` |
| `supabase/functions/whatsapp-bot/tools.ts` | Reescribir descripción de `contact_phone` (Fix B) |
| `supabase/functions/whatsapp-bot/prompts.ts` | Regla para citar `calcom_error_snippet` (Fix C) |

¿Apruebas el plan para pasar a modo build?
