# Diagnóstico

Del último log real (`whatsapp-bot` → AI Gateway `019f319e-2990` a las 09:31:18 UTC + consulta a `appointments`):

1. La cita de Nidia Cámara 11-jul 12:00 **no existe** en la tabla `appointments`. Es decir, el fix de rollback ya deployado en `tool-executor.ts:395-407` **sí se ejecutó**: Cal.com rechazó por conflicto, borré el registro local y devolví `{ success:false, slot_taken:true, calcom_error_snippet:"..." }`.
2. Aun así, la IA respondió *"¡Listo! Ya te agendé..."* y añadió *"no se sincronizó con Google Calendar"*. Es decir, el modelo **ignoró** `success:false` y **inventó** una sincronización con Google Calendar que ya no existe en el código.

Causas raíz:

- **A. Prompt débil ante `success:false**`: la sección "REGLA DE AGENDADO" en `supabase/functions/whatsapp-bot/prompts.ts` describe el flujo `success=true` en detalle; el caso `slot_taken:true` es una sola línea al final y compite con el sesgo del modelo (y con mensajes previos del propio bot en el historial que sí decían "Ya te agendé"). Gemini rellena con el patrón dominante.
- **B. Historial contaminado**: `ai-response.ts` inyecta los últimos 10 mensajes del hilo tal cual. Como el bot ya había dicho antes *"Ya agendé"* y *"no se sincronizó con Google Calendar"*, el modelo copia esas frases aunque la herramienta responda otra cosa.
- **C. `check_availability` no consulta Cal.com**: `voice-scheduling` solo revisa `availability_rules` + `appointments` locales (y hasta consulta Google Calendar, que ya no usamos). Como el slot está "libre" localmente, la IA cree que puede agendar y solo se entera del conflicto cuando Cal.com rechaza. Debería consultar `/v2/slots` de Cal.com y devolver la verdad.
- **D. Prohibición de "Google Calendar" no vinculante**: la regla existe pero el modelo la ignora cuando el historial la contradice; no hay ningún filtro/limpieza del lado del código.

# Plan de corrección (quirúrgico, sin migraciones, sin tocar ElevenLabs / call-transfer / twilio-*)

## 1. `supabase/functions/whatsapp-bot/tool-executor.ts` — respuesta ejecutiva ante fallo

Cuando `schedule_appointment` devuelva `success:false` (slot_taken u otro), añadir un campo `chat_reply` con el texto exacto que debe enviar la IA, y `do_not_confirm:true`:

```json
{
  "success": false,
  "slot_taken": true,
  "do_not_confirm": true,
  "chat_reply": "Ese horario ya está ocupado en la agenda con Nidia Cámara. ¿Te va otro? Te reviso disponibilidad."
}
```

Esto le da al modelo un texto listo para copiar, reduciendo la alucinación.

## 2. `supabase/functions/whatsapp-bot/prompts.ts` — reforzar reglas

Reordenar y elevar a nivel superior:

- Bloque **"CUANDO LA HERRAMIENTA DEVUELVE success:false"** al inicio (antes que el flujo de éxito), con ejemplos: si `slot_taken:true` responder algo como "Ese horario está ocupado, ¿te acomoda…?" y **prohibido** decir "listo", "agendé", "quedó".
- Bloque **"PALABRAS PROHIBIDAS"** explícito: nunca escribir "Google Calendar", "gcal", "no se sincronizó con Google". La única integración es Cal.com.
- Si `chat_reply` existe en el JSON, usarlo casi verbatim.

## 3. `supabase/functions/whatsapp-bot/ai-response.ts` — sanear el historial

Antes de mandar los últimos 10 mensajes al modelo, reemplazar en los `assistant` cualquier ocurrencia de "Google Calendar", "no se sincronizó con Google", etc. por texto neutro ("[sync info omitida]"). Esto rompe el patrón que el modelo está copiando.

## 4. `supabase/functions/voice-scheduling/index.ts` — verificar disponibilidad real en Cal.com

En `action === 'check_availability'`:

- Cargar `calcom_integrations` del tenant (mismo patrón que `tool-executor.ts`: descifra `api_key_encrypted`).
- Si existe integración activa con `default_event_type_id`, llamar `GET https://api.cal.com/v2/slots?eventTypeId=…&startTime=…&endTime=…&timeZone=…` y usar esa lista como fuente de verdad de slots libres.
- Restar los `appointments` locales cancelados/duplicados. Marcar como no disponibles los que Cal.com no devuelva.
- Eliminar el bloque de Google Calendar events (líneas ~71+): ya no es la fuente de verdad.

Efecto: la IA verá el conflicto *antes* de intentar agendar, y no llegará al mensaje ambiguo actual.

## 5. Nada de cambios en RLS/GRANT ni migraciones

Todo el trabajo es en edge functions.

## Archivos que voy a tocar

- `supabase/functions/whatsapp-bot/tool-executor.ts`
- `supabase/functions/whatsapp-bot/prompts.ts`
- `supabase/functions/whatsapp-bot/ai-response.ts`
- `supabase/functions/voice-scheduling/index.ts`

## Verificación post-deploy

1. Redeploy `whatsapp-bot` y `voice-scheduling`.
2. Repetir el mismo caso de prueba (agendar con Nidia en un horario ya reservado en Cal.com).
3. Confirmar en logs que:
  - `check_availability` devuelve el slot como ocupado sin necesidad de intentar reservar.
  - Si aun así se llama `schedule_appointment`, el reply del bot no contiene "Google Calendar" ni "Ya te agendé".
  - La tabla `appointments` no tiene el registro fantasma.