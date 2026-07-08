# Diagnóstico y plan (Proyectos, Recordatorios, Recordatorios automáticos de citas)

## PROBLEMA A — No hay botón para eliminar un proyecto

### Causa raíz
La UI de Proyectos nunca renderiza un botón de eliminar proyecto, y el hook de persistencia tampoco expone la función.

**Evidencia archivo por archivo:**

- `src/pages/ProjectsPage.tsx`
  - Líneas **777–818**: grid de tarjetas de proyecto. Cada tarjeta es un `<button>` cuyo único `onClick` es `setSelectedProjectId(proj.id)`. No hay `Trash2`, ni menú contextual, ni `handleDeleteProject`.
  - Líneas **388–500** (vista de detalle del proyecto): sólo hay `ArrowLeft` (volver) y un `<select>` para cambiar `status` (línea 394–402). No hay acción "Eliminar proyecto".
  - Líneas **180–187**: sólo existen `handleDeleteTask` y `handleDeleteMilestone`.
  - Línea **66**: se destructuran del hook `deleteTask` y `deleteMilestone`, pero no existe `deleteProject`.

- `src/hooks/useProjectsPersistence.ts`
  - Contiene `deleteTask` (línea 297) y `deleteMilestone` (línea 429). **No existe** `deleteProject`.
  - El `return` final expone `createProject`, `updateProjectStatus`, pero no `deleteProject`.

- Backend
  - No hay edge function ni RPC específica para borrar proyectos.
  - RLS ya lo permite: policy `"Users can delete projects in their tenant"` (migración `20260313182421_...sql` línea 74).
  - Las FKs hijas (`project_members`, `project_tasks`, `project_milestones`, `project_documents`) están todas con `ON DELETE CASCADE` (verificado con `pg_constraint.confdeltype = 'c'`), así que un `DELETE FROM projects WHERE id = ...` limpia todo automáticamente. **No** existe FK desde `appointments`/`documents` generales (los "project_documents" del bucket se manejan aparte, pero la fila DB sí cae en cascada).

### Fix propuesto (a aplicar en Build)
1. Añadir `deleteProject` en `src/hooks/useProjectsPersistence.ts` (junto a `deleteTask`), con `.from('projects').delete().eq('id', projectId).eq('tenant_id', activeTenantId)`, retirando el proyecto y sus tareas del estado local (`setProjects`, `setTasks`). Exportarlo.
2. En `src/pages/ProjectsPage.tsx`:
   - Destructurarlo del hook (línea 62–69).
   - Añadir botón `Trash2` con `AlertDialog` de confirmación en la cabecera del detalle (dentro del bloque de línea 388–402), y al cerrar volver a la lista (`setSelectedProjectId(null)`).
   - Opcional: botón secundario "Eliminar" en cada tarjeta (línea 784) mediante un menú (evitar que compita con el `onClick` de abrir el proyecto usando `e.stopPropagation()`).
3. No tocar RLS ni FKs; el CASCADE ya cubre limpieza de tareas, hitos, miembros y documentos.

---

## PROBLEMA B — Al elegir el canal (WhatsApp/Email), crear recordatorio da error

### Causa raíz
El formulario intenta escribir columnas que **no existen** en la tabla `public.reminders`.

**Evidencia:**

- `src/pages/RemindersPage.tsx` líneas **83–86**:
  ```ts
  if (newChannel) payload.channel = newChannel;
  if (newContact.trim()) payload.contact_phone = newContact.trim();
  const { error } = await supabase.from('reminders').insert(payload as any);
  ```
- `psql \d public.reminders` (verificado en vivo): columnas reales = `id, tenant_id, user_id, remind_at, message, status, sent_at, created_at, source, retry_count, max_retries, error_message, timezone`. **No existen** `channel` ni `contact_phone`.
- Resultado: PostgREST responde con `PGRST204` / `column "channel" of relation "reminders" does not exist` → el `toast.error(err?.message ...)` muestra el error al usuario. Sólo pasa cuando se selecciona canal (o se llena contacto); si se deja "Predeterminado" y sin contacto, el insert funciona porque esas líneas no se ejecutan.
- Los recordatorios recientes fallidos que aún se ven (`"Twilio could not find a Channel with the specified From address"`) son un problema **distinto** (config de WhatsApp del tenant), no la causa del error del selector.

Además, `supabase/functions/send-reminders/index.ts` sólo tiene código de envío por Twilio/WhatsApp (líneas 98–174 y 229–285). No hay ninguna rama para `email`/Resend. Es decir, aunque se persistiera `channel = 'email'`, el envío tampoco existiría hoy.

### Fix propuesto (a aplicar en Build)
1. Migración: `ALTER TABLE public.reminders ADD COLUMN channel text DEFAULT 'whatsapp', ADD COLUMN contact_phone text, ADD COLUMN contact_email text;` + `CHECK (channel IN ('whatsapp','email'))`. Sin tocar RLS existente ni GRANTs (ya son correctos para `authenticated`).
2. `supabase/functions/send-reminders/index.ts` (bloque de líneas 98–174 y 229–285): ramificar por `channel`:
   - `whatsapp` → flujo actual (sin cambios).
   - `email` → invocar Resend (`RESEND_API_KEY` ya existe como secret) usando `contact_email` (o `profile.email` si no viene). Mantener el mismo tratamiento de `retry_count`, `error_message`, `sent_at`, `status`.
3. `src/pages/RemindersPage.tsx`:
   - Mostrar campo `contact_email` cuando `newChannel === 'email'`, `contact_phone` cuando `newChannel === 'whatsapp'`.
   - Enviar `channel` siempre (default `whatsapp`) al `insert`.

---

## REQUERIMIENTO NUEVO — Recordatorios automáticos de cita al cliente (24h y 1h antes)

### Estado actual (qué ya existe y qué falta)

- Tabla `public.appointments` — completa, con `contact_phone`, `contact_email`, `start_at`, `service_type`, `notes`, `tenant_id`, `status`, `deleted_at`.
- Tabla `public.appointment_notifications` — ya existe con `notification_type`, `scheduled_at`, `target_phone`, `target_user_id`, `message_body`, `status` (`pending|processing|sent|failed|cancelled|no_phone`). Es la infraestructura correcta para reutilizar.
- Procesador cron: `supabase/functions/send-reminders/index.ts` líneas **176–286** ya lee `appointment_notifications` con `status='pending'` y `scheduled_at <= now()`, cancela si la cita fue borrada/cancelada (líneas 200–208, 229–235) y envía por WhatsApp/Twilio. Reutilizable tal cual.
- Creación de notificaciones — sólo la hace hoy `supabase/functions/whatsapp-bot/tool-executor.ts`:
  - Líneas **552–553**: calcula `reminder1h` y `reminder15m` (⚠️ hoy son 1h y **15 min**, no 24h/1h).
  - Líneas **559–601**: inserta `reminder_1h` y `reminder_15m` para cliente y para creador interno.
- **Brecha**: las otras rutas de creación de citas NO generan `appointment_notifications`:
  - `supabase/functions/calendar-sync/index.ts` línea 882 (`from('appointments').insert(...)`).
  - `supabase/functions/calcom-webhook/index.ts` línea 267 (idem).
  - `supabase/functions/voice-scheduling/index.ts` — inserta citas y tampoco crea notifications (grep vacío).
  - UI de calendario (crear cita a mano desde `AppointmentsPage`/`CalendarPage`) tampoco.
- Sin infraestructura de email para citas: `send-reminders` sólo envía WhatsApp; `RESEND_API_KEY` existe pero no se usa aquí.

### Diseño propuesto (a aplicar en Build)

Objetivo: al **crear/agendar** cualquier cita (desde cualquier canal), programar automáticamente recordatorios al cliente **24 h antes** y **1 h antes**, con los datos completos (fecha, hora, servicio, empleado, negocio, ubicación, notas), por el canal disponible (WhatsApp si hay `contact_phone`, si no email si hay `contact_email`).

**Estrategia recomendada**: centralizar la programación con un trigger de base de datos, para no duplicar lógica en cada ruta de agendamiento.

1. **Migración SQL nueva** (nueva función + trigger, sin tocar RLS ni políticas actuales, sin CHECK time-dependientes):
   - Función `public.schedule_appointment_reminders()` `SECURITY DEFINER, SET search_path=public` que:
     - Se dispara `AFTER INSERT ON public.appointments` (y `AFTER UPDATE` cuando cambia `start_at` o pasa de `cancelled`/borrada a activa).
     - Lee `NEW.start_at`, `NEW.contact_phone`, `NEW.contact_email`, `NEW.tenant_id`, `NEW.contact_name`, `NEW.service_type`, `NEW.notes`.
     - Construye `message_body` con datos + nombre del tenant (SELECT tenants.name / settings_json ubicación).
     - Inserta filas en `appointment_notifications` para `notification_type IN ('reminder_24h','reminder_1h')` sólo si `scheduled_at > now()`.
     - Prefiere `target_phone = contact_phone`; si es NULL y hay `contact_email`, deja `target_phone = NULL` y añade columna nueva `target_email` (ver punto 2) para que el procesador use email.
     - Elimina notificaciones futuras huérfanas si la cita se cancela (`AFTER UPDATE` con `NEW.status='cancelled' OR NEW.deleted_at IS NOT NULL`) → `UPDATE ... SET status='cancelled'`.
     - Reprograma si `start_at` cambia: cancela pendientes de esa cita y vuelve a insertar.
   - Ventaja: cubre **todas** las rutas actuales y futuras (whatsapp-bot, voice-scheduling, calcom-webhook, calendar-sync, UI) sin editarlas.

2. **Migración**: `ALTER TABLE public.appointment_notifications ADD COLUMN target_email text;` (para permitir email de cliente). No tocar RLS existente.

3. **Edge function `supabase/functions/send-reminders/index.ts`** (extender bloque líneas 229–285):
   - Cuando `notif.target_email` esté presente y `target_phone` sea NULL (o el envío WA falle definitivamente), enviar por Resend (`RESEND_API_KEY`) con `from = notify@<dominio del tenant>` y `subject = "Recordatorio de tu cita — <negocio>"`.
   - Mantener `status/sent_at/error_message` y el flujo de reintentos existente.

4. **`whatsapp-bot/tool-executor.ts` líneas 551–601**:
   - Reemplazar el cálculo de `reminder1h` y `reminder15m` por `reminder24h` y `reminder1h` (o dejar los internos como están y quitar sólo los del cliente para no duplicar con el trigger).
   - Preferible: **eliminar** la programación de recordatorios al *cliente* aquí (ahora la hace el trigger) y **mantener** sólo las notificaciones internas al empleado (`target_user_id`), con los tiempos que la operación quiera. Así no se duplican filas para el mismo cliente/cita.

5. **UI RemindersPage** (opcional, no requerido para el requerimiento): mostrar en la lista actual también un tab "Citas" que lea `appointment_notifications` filtrado por tenant, para dar visibilidad; no bloqueante.

### Alcance explícito
- No se toca RLS existente (sólo se añaden columnas; los `GRANT` actuales cubren la nueva columna).
- No se modifican tipos generados, `pin-service`, `calendario` (código de UI de calendario), prompts ni el webhook de Stripe.
- Se preserva el aislamiento por tenant (todo escribe `tenant_id = NEW.tenant_id` o el del `reminder`).

### Orden de implementación al pasar a Build
1. Migración `reminders`: agregar `channel/contact_phone/contact_email`.
2. Fix UI `RemindersPage.tsx` + rama email en `send-reminders`.
3. Añadir `deleteProject` al hook + botón `Trash2` con confirmación en `ProjectsPage.tsx`.
4. Migración `appointment_notifications.target_email` + función/trigger `schedule_appointment_reminders`.
5. Extender `send-reminders` para email de citas y limpiar duplicación en `whatsapp-bot/tool-executor.ts`.
6. Deploy edge functions afectadas (`send-reminders`, `whatsapp-bot`).

Al aprobar el plan lo implemento en ese orden.
