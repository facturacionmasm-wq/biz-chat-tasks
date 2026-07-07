## Diagnóstico confirmado

**Causa raíz real:** ElevenLabs sí tiene el `call_sid` en la conversación y en `conversation_initiation_client_data.dynamic_variables`, pero **NO lo envía dentro del body del webhook `transfer_call`**. El webhook actual solo busca `call_sid` en `body.parameters/body.data/body.dynamic_variables`, por eso responde antes de llamar a `call-transfer`:

```json
{"success":false,"message":"No se pudo identificar la llamada en curso (call_sid ausente)."}
```

No es un problema de `x-elevenlabs-secret`, ni de `voice-scheduling`, ni de credenciales Twilio en esta prueba. `call-transfer` ni siquiera se invoca porque `elevenlabs-actions-webhook` corta en validación por falta de `callSid`.

## Evidencia runtime exacta

### Logs de funciones

- `elevenlabs-actions-webhook`: la herramienta de logs no devolvió entradas recientes directas.
- `call-transfer`: sin entradas recientes; consistente con que no fue invocada.
- `voice-scheduling`: sin entradas relevantes; `transfer_call` no usa este flujo.
- `function_edge_logs` de los últimos 8h: no muestra requests a esas funciones, aunque ElevenLabs sí registra la llamada webhook y su respuesta. La evidencia más completa viene del detalle de conversación de ElevenLabs.

### Conversación real ElevenLabs

Conversación reciente: `conv_9401kwz1m1e6fj0sabecftr1azc1`

- `metadata.phone_call.call_sid`: `CA4dfcf50052edebdecd52701d2f9b5c87`
- `conversation_initiation_client_data.dynamic_variables.call_sid`: `CA4dfcf50052edebdecd52701d2f9b5c87`
- `conversation_initiation_client_data.dynamic_variables.system__call_sid`: `CA4dfcf50052edebdecd52701d2f9b5c87`
- `tenant_id`: `00000000-0000-0000-0000-000000000001`
- `call_record_id`: `00dd286e-5bb3-4399-be85-e3dacf1e83c2`

Webhook llamado por ElevenLabs:

```json
{
  "method": "POST",
  "url": "https://.../functions/v1/elevenlabs-actions-webhook",
  "headers": {
    "Content-Type": "application/json",
    "x-elevenlabs-secret": "<presente>"
  },
  "body": {
    "tool_name": "transfer_call",
    "target_phone": "+1 3233089067",
    "target_name": "Nidia Camara",
    "department": "REMATES HIPOTECARIOS",
    "reason": "Cliente solicita hablar con Nidia Cámara"
  }
}
```

Respuesta del tool:

```json
{"success":false,"message":"No se pudo identificar la llamada en curso (call_sid ausente)."}
```

Hubo dos intentos en la misma llamada y ambos devolvieron exactamente ese mensaje.

## Código afectado

### `supabase/functions/elevenlabs-actions-webhook/index.ts`

- Líneas 32-45: valida `x-elevenlabs-secret`. En esta prueba el header está presente; no es la causa.
- Líneas 52-58: parsea el body y normaliza `toolName/toolParams`.
- Líneas 59-64: extrae `dynamicVars` solo desde:

```ts
body.dynamic_variables || body.conversation_initiation_client_data?.dynamic_variables || {}
```

y luego:

```ts
const callSid = toolParams.call_sid || dynamicVars.call_sid || null;
```

**Problema:** el body real enviado por ElevenLabs no incluye `dynamic_variables`, `conversation_initiation_client_data`, `call_sid` ni `system__call_sid`; solo incluye `tool_name`, `target_phone`, `target_name`, `department`, `reason`.

- Líneas 154-166: en `transfer_call`, valida `targetPhone` y `callSid`. Falla en línea 164-166 con `callSid` ausente.
- Líneas 181-206: llamada a `call-transfer`; **no se alcanza** en la prueba real.

### `supabase/functions/call-transfer/index.ts`

- Líneas 129-135: requiere `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`.
- Líneas 147-164: modo interno requiere `tenant_id`, `target_phone`, `target_name`, `call_sid`.
- Líneas 182-190: llama a Twilio para actualizar la llamada viva.
- Líneas 105-117: ejecuta `POST /Calls/{callSid}.json` con `Twiml=...`.

Este diseño es correcto para transferencia de llamada viva, pero depende de recibir `call_sid`. En esta prueba no se llega a Twilio.

### `supabase/functions/call-inbound-webhook/index.ts`

- Líneas 306-320: sí registra la llamada con ElevenLabs incluyendo:

```ts
conversation_initiation_client_data: {
  dynamic_variables: {
    tenant_id,
    call_record_id,
    call_sid,
    company_name,
  }
}
```

Esto funcionó: ElevenLabs conserva esas variables en la conversación. El problema es que la configuración del webhook tool no las inyecta al request body.

### `supabase/functions/elevenlabs-staff-sync/index.ts`

- Líneas 145-185: genera la configuración del tool `transfer_call`.
- Línea 157: `required: ["tool_name", "target_phone", "target_name"]`.
- Líneas 159-181: define propiedades, pero **no define `call_sid`, `call_record_id`, `tenant_id` ni `caller_phone` como dynamic variables/system-provided fields**.

Por eso ElevenLabs solo manda los campos que el LLM rellena, no el contexto de llamada.

## Configuración actual del agente RYBIX

Agent: `agent_4301kjgj2fjme5xv9d4ncvcvkgqx`

Tool `transfer_call`:

- `type`: `webhook`
- `method`: `POST`
- `url`: `.../functions/v1/elevenlabs-actions-webhook`
- headers: `Content-Type: application/json`, `x-elevenlabs-secret` presente
- required body fields: `tool_name`, `target_phone`, `target_name`
- optional: `department`, `reason`
- `dynamic_variables.dynamic_variable_placeholders`: `{}`

No hay mapeo del body hacia `call_sid`, `system__call_sid`, `call_record_id`, `tenant_id` ni `system__caller_id`.

## Estado de datos

Última llamada real:

- `call_records.id`: `00dd286e-5bb3-4399-be85-e3dacf1e83c2`
- `external_call_id`: `CA4dfcf50052edebdecd52701d2f9b5c87`
- `from_number`: `+12137162417`
- `to_number`: `+12138163815`
- `status`: `completed`
- `transcript_status`: `ready`

`call_sessions` también tiene:

- `call_sid`: `CA4dfcf50052edebdecd52701d2f9b5c87`
- `routing_method`: `register_call_native`
- `state`: `completed`

Nidia existe con teléfono destino:

- `phone`: `+1 3233089067`
- `department`: `REMATES HIPOTECARIOS`

El teléfono destino fue enviado, aunque con espacio (`+1 3233089067`). No fue la causa de este fallo porque no se llegó a Twilio; conviene normalizarlo a E.164 estricto después.

## Fix mínimo propuesto

### 1) Cambiar `elevenlabs-staff-sync/index.ts`

En `buildTransferTool`, agregar al `request_body_schema.properties` campos system/dynamic para que ElevenLabs los incluya en cada llamada del tool:

- `call_sid`: dynamic variable `system__call_sid` o `call_sid`
- `call_record_id`: dynamic variable `call_record_id`
- `tenant_id`: dynamic variable `tenant_id`
- opcional `caller_phone`: dynamic variable `system__caller_id`

Y agregarlos como requeridos para transferencia, al menos `call_sid`.

Ejemplo conceptual:

```ts
call_sid: {
  type: "string",
  description: "Twilio Call SID de la llamada activa.",
  dynamic_variable: "system__call_sid",
  is_system_provided: true,
},
call_record_id: {
  type: "string",
  dynamic_variable: "call_record_id",
  is_system_provided: true,
},
tenant_id: {
  type: "string",
  dynamic_variable: "tenant_id",
  is_system_provided: true,
},
caller_phone: {
  type: "string",
  dynamic_variable: "system__caller_id",
  is_system_provided: true,
}
```

Si ElevenLabs no acepta `is_system_provided` con `dynamic_variable` en este shape, usar el formato exacto que la API ya devuelve para dynamic fields: propiedad con `dynamic_variable: "system__call_sid"` y `is_omitted: false`.

### 2) Hacer más robusto `elevenlabs-actions-webhook/index.ts`

En líneas 59-64, ampliar extracción:

```ts
const callSid =
  toolParams.call_sid ||
  toolParams.system__call_sid ||
  dynamicVars.call_sid ||
  dynamicVars.system__call_sid ||
  body.metadata?.phone_call?.call_sid ||
  null;
```

Y lo mismo para:

- `tenant_id`: `toolParams.tenant_id || dynamicVars.tenant_id`
- `call_record_id`: `toolParams.call_record_id || dynamicVars.call_record_id`
- `caller_phone`: `toolParams.caller_phone || dynamicVars.system__caller_id`

### 3) Fallback seguro por conversación/call session

Si `callSid` todavía falta, pero llega `conversation_id`/`system__conversation_id`, usar el API de ElevenLabs para leer esa conversación y obtener:

- `metadata.phone_call.call_sid`
- `conversation_initiation_client_data.dynamic_variables.call_sid`

Si no llega `conversation_id`, fallback controlado por tenant: buscar en `call_sessions` la llamada `state` activa/reciente del tenant en los últimos minutos. Esto debe ser estricto para no cruzar tenants.

### 4) Normalizar `target_phone` antes de Twilio

Antes de llamar `call-transfer`, limpiar espacios:

```ts
target_phone: targetPhone.replace(/[\s()-]/g, "")
```

Esto evita un segundo fallo potencial con `+1 3233089067`, pero no es la causa primaria actual.

### 5) Ejecutar sincronización del agente

Después de cambiar `elevenlabs-staff-sync`, invocar/deployar lo necesario para que el agente vuelva a recibir el schema actualizado del tool `transfer_call`. Sin esto, el código puede estar bien pero el agente seguirá mandando el body viejo.

## No tocar

- RLS
- `pin-service`
- calendario
- prompts manuales fuera del bloque gestionado
- generated types
- webhook de Stripe
- tablas no relacionadas

## Validación esperada tras fix

En una nueva llamada real, el body del tool debe incluir al menos:

```json
{
  "tool_name": "transfer_call",
  "target_phone": "+13233089067",
  "target_name": "Nidia Camara",
  "call_sid": "CA...",
  "call_record_id": "...",
  "tenant_id": "00000000-0000-0000-0000-000000000001"
}
```

Entonces `elevenlabs-actions-webhook` debe pasar a llamar `call-transfer`; si falla después, el siguiente error real sería Twilio status/body, no `call_sid ausente`.