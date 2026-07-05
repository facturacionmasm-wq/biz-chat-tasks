# Auditoría integral del prompt del bot WhatsApp (solo lectura)

Fuentes revisadas: `supabase/functions/whatsapp-bot/prompts.ts` (completo, 162 líneas), `ai-response.ts` líneas 20-95 (ensamblaje), `tools.ts` (30 tools en `AI_TOOLS`). Cruce: cada nombre citado en el prompt contra `AI_TOOLS[*].function.name` y contra los handlers de `tool-executor.ts`.

## Resumen

- **No hay tools inexistentes citados** ni tools existentes que el modelo "no vea": los 17 nombres del prompt cliente y los 27 del prompt empleado existen en `tools.ts`.
- **No hay template literal roto, comilla mal escapada ni placeholder vacío por sintaxis.** Todas las `${...}` se pasan desde `ai-response.ts`.
- Los defectos reales son de **semántica, zona horaria y fuga de datos**, no de estructura.

---

## Críticos

### C1 — Fuga de emails de empleados a clientes externos
- Archivo: `prompts.ts:67-68` (cliente) + `ai-response.ts:57-60` y `:66`.
- Hecho: en modo **cliente** se inyecta `Empleados disponibles:\n- Nombre (email)` construido en `ai-response.ts:66` (`\`- ${e.name} (${e.email || 'sin email'})\``). Un contacto externo por WhatsApp que pregunte "¿con quién puedo agendar?" recibe el email interno del staff — dato PII no público.
- Corrección quirúrgica:
  1. En `ai-response.ts:66`, generar `employeeListForClient` (solo nombres) y `employeeListForEmployee` (nombre + email), y pasar el adecuado según `mode`.
  2. Alternativa mínima si se quiere tocar solo `prompts.ts`: cambiar el bloque en `ai-response.ts:66` a `\`- ${e.name}\`` cuando `mode === 'client'`. Requiere un pequeño ajuste en `ai-response.ts`, no en `prompts.ts`.

### C2 — Zona horaria del servidor vs. tenant (fechas y hora "actuales" incorrectas)
- Archivo: `ai-response.ts:62-68` (calcula `todayStr`, `tomorrowStr`, `currentTime`).
- Hecho: `today.toISOString().split('T')[0]` y `today.toLocaleTimeString('es-MX', ...)` **sin `timeZone`** producen UTC. En Deno Deploy el proceso corre en UTC. Consecuencia: entre las 18:00 y 23:59 hora CDMX (00:00–05:59 UTC del día siguiente), el prompt inyecta `hoy = <día siguiente>` y `mañana = <día +2>`. El bot agenda en el día equivocado — muy visible cuando el usuario dice "mañana".
- El prompt además nunca menciona la zona horaria, así que el LLM no puede corregirlo por sí mismo y `gcal_list_events`/`gcal_create_event` recibirán ISO con offset UTC.
- Corrección quirúrgica (afecta `ai-response.ts`, no `prompts.ts`):
  1. Resolver la zona horaria del tenant (leer `tenants.settings_json.timezone`, fallback `'America/Mexico_City'`).
  2. Formatear `todayStr`, `tomorrowStr` y `currentTime` con `Intl.DateTimeFormat('sv-SE', { timeZone: tz, ... })` (formato ISO local).
  3. En `prompts.ts:32` y `:101` añadir literal: `FECHA Y HORA ACTUAL: ${todayStr} ${currentTime} (${tz})` — no se rompe nada.

---

## Medios

### M1 — Falta el día de la semana; contradice "NUNCA calcules fechas"
- Archivo: `prompts.ts:32, 51-54, 101, 130-133`.
- El prompt entrega solo `YYYY-MM-DD` pero luego prohíbe calcular. Si el usuario dice "el viernes", el modelo debe deducir qué fecha es. Es una regla que el modelo puede cumplir mal.
- Corrección: pasar `todayLabel = "sábado 5 de julio de 2026"` desde `ai-response.ts` e interpolar en el prompt: `hoy = ${todayStr} (${todayLabel})`, análogo para `mañana`. Cambio de una línea en cada builder.

### M2 — Ausencia del nombre del negocio y tono genérico
- Archivo: `prompts.ts:11` ("del negocio") y `:82`.
- `tool-executor.ts:388-389` sí obtiene `tenants.name`, pero al **prompt** nunca llega. Aria dice "el negocio" en vez del nombre del tenant.
- Corrección: en `ai-response.ts` batch-fetch `tenants.name`, pasarlo como parámetro `tenantName` a ambos builders y usarlo en la línea de rol: `Eres Aria, la asistente virtual de ${tenantName}`.

### M3 — Regla "AGENDAR CITAS" depende de flags que hay que verificar en el executor
- Archivo: `prompts.ts:30` menciona `out_of_business_hours=true` y `slot_taken=true` como campos que devuelve `schedule_appointment`.
- Requiere confirmar en `tool-executor.ts` (handler de `schedule_appointment`, líneas ~18-56 y las validaciones previas). Si el JSON de retorno no expone esos flags con esos nombres exactos, el modelo nunca los verá y seguirá insistiendo. **Pendiente de verificar antes de corregir**; si no coinciden, la corrección es alinear los nombres en el executor (o alinear el prompt a los nombres reales). No propongo tocar `tools.ts`.

### M4 — Contradicción sutil `gcal_delete_event`
- `tools.ts:253` en la descripción del tool dice "SIEMPRE pide confirmación antes"; el prompt (`prompts.ts:57, 136`) dice "NUNCA confirmes una acción sin haber ejecutado la herramienta". Ambas conviven ambiguamente. Un LLM puede interpretar que puede borrar Google Calendar events sin confirmación.
- Corrección: añadir a `prompts.ts:56-60` y `:135-137` una excepción explícita: `Excepción: gcal_delete_event, cancel_appointment con cancel_all=true y manage_expenses (reject) — PIDE confirmación al usuario antes de ejecutar.`

### M5 — Duplicación casi total entre `buildClientPrompt` y `buildEmployeePrompt`
- Archivo: `prompts.ts:13-30` ≈ `:84-99`; `:51-54` ≈ `:130-133`; `:56-60` ≈ `:135-137`; `:62-65` ≈ `:156-158`.
- No es un bug hoy, pero cada corrección futura hay que hacerla en dos sitios; con alta probabilidad de divergencia (ya se ve: el cliente tiene "Si te piden buscar dirección…" que el empleado no tiene).
- Corrección **opcional** (no obligatoria): extraer una constante `SHARED_RULES` y componer ambos prompts. Puedo dejarlo para más adelante si prefieres no refactorizar ahora.

---

## Menores

### m1 — `create_reminder` no está en el prompt del cliente
- `prompts.ts:34-49` vs `tools.ts:42`. Intencional (los clientes externos no crean recordatorios internos), pero conviene documentarlo con un comentario. Sin acción.

### m2 — Empleado no recibe `employeeList`
- `ai-response.ts:82-84`: `buildEmployeePrompt` no toma `employeeList`. Si un empleado pregunta "quiénes están en el equipo", el modelo debe llamar `get_team_members` — funciona pero implica un round-trip extra. Aceptable.

### m3 — `search_web.model_preference` no se documenta
- Menor: no afecta funcionamiento. Sin acción.

### m4 — `reschedule_appointment.contact_name` requerido no se enfatiza
- `tools.ts:157` lo marca `required`, el prompt no lo aclara. Si el usuario dice "mueve mi cita del viernes al sábado" sin nombre, el modelo puede fallar la llamada. Añadir una línea: `Reprogramar requiere el nombre del contacto; si falta, pídelo.`

### m5 — `Base de conocimientos:` puede quedar vacío
- Si `knowledgeContext` y `adaptiveContext` son ambos `''`, queda `Base de conocimientos:\n` colgado al final. Cosmético.

---

## Cero-falsos-positivos (revisado y OK)

- **Nombres de tools**: los 17 citados en cliente y 27 en empleado existen en `tools.ts`. Nada inventado, nada omitido de forma dañina.
- **Template literals**: bien cerrados, sin escapes rotos, sin `${}` vacíos.
- **Idioma**: consistente en español mexicano.
- **Credenciales/IDs**: el prompt no expone tokens, API keys, service_role, ni IDs internos. Los `${employeeList}` y `${knowledgeContext}` sí exponen datos de negocio (ver C1).
- **Cal.com**: correctamente ausente — el push es server-side; no hay que mencionarlo en el prompt.
- **`manage_workflow_rules(list, create, toggle)`** en `:127` coincide con `tools.ts:471`.
- **`get_pending_expenses` enum** en `:110` coincide con `tools.ts:76`.

---

## Plan de corrección propuesto (a aplicar cuando lo apruebes)

Corrección **quirúrgica**, dos archivos (`ai-response.ts` y `prompts.ts`); cero cambios en `tools.ts`, en las funciones protegidas (`elevenlabs-*`, `twilio-*`, `call-transfer*`), en RLS, ni en migraciones.

1. `ai-response.ts`
   - Batch-fetch `tenants.name` + `tenants.settings_json.timezone` junto con `employees` y `recentMsgs` (mismo `Promise.all` de líneas 42-56).
   - Resolver `tz = settings_json?.timezone || 'America/Mexico_City'`.
   - Calcular `todayStr`, `tomorrowStr`, `currentTime`, `todayLabel`, `tomorrowLabel` usando `Intl.DateTimeFormat` con `{ timeZone: tz }`.
   - Construir `employeeListForClient` (solo nombres) y `employeeListForEmployee` (nombre + email).
   - Pasar `tenantName`, `tz`, `todayLabel`, `tomorrowLabel` como nuevos parámetros a los builders.

2. `prompts.ts`
   - `buildClientPrompt` firma: añadir `tenantName`, `tz`, `todayLabel`, `tomorrowLabel`.
     - `:11` → `Eres Aria, la asistente virtual de ${tenantName}. ...`
     - `:32` → `FECHA Y HORA ACTUAL: ${todayStr} ${currentTime} (${tz})`
     - `:52-53` → `"hoy" = ${todayStr} (${todayLabel})` / `"mañana" = ${tomorrowStr} (${tomorrowLabel})`
     - `:56-60` (REGLAS DE EJECUCIÓN) → añadir línea: `Excepción: pide confirmación antes de gcal_delete_event, cancel_appointment con cancel_all=true, y manage_expenses (reject).`
   - `buildEmployeePrompt` firma: mismos parámetros + reusar `tenantName` en `:82`.
     - Mismas modificaciones análogas en `:101, 131-132, 135-137`.
     - Añadir en `:107` una nota: `Reprogramar requiere el nombre del contacto; si falta, pídelo.`

3. **Sin refactor de duplicación (M5)** en esta iteración — riesgo/beneficio no lo amerita hoy.

4. **M3 queda como acción condicional**: antes de tocar `prompts.ts:30`, quiero verificar en `tool-executor.ts` que `schedule_appointment` realmente devuelve `out_of_business_hours` y `slot_taken` con esos nombres. Si no, ajustamos el prompt a los nombres reales.

Cuando lo apruebes ejecuto exactamente estos cambios y corro `tsgo --noEmit`.
