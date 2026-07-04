# Plan: Sincronización bidireccional Google Calendar + Cal.com

## 1. Google Calendar (pull cada 10 min)

**Nueva acción `pull_events` en `calendar-sync`**
- Recorre todas las filas de `google_calendar_tokens` con `status='active'`.
- Para cada empleado: llama `GET /calendars/{calendar_id}/events?updatedMin=<último_pull>&singleEvents=true`.
- Refresca token si expira en <5 min (lógica existente).
- Por cada evento devuelto:
  - Ignora los que tengan `description` con `ID: <uuid>` que ya exista en `appointments` (evita eco de eventos creados por la app).
  - Si ya existe una fila con `calendar_event_id=<evento.id>`, hace `UPDATE` de fechas / status.
  - Si no existe, hace `INSERT` con `source='google_calendar'`, `user_id=<empleado>`, `tenant_id`, `calendar_event_id=<evento.id>`, `calendar_sync_status='SYNCED'`, `contact_name=<summary>`, `start_at/end_at` normalizados a UTC.
  - Si el evento viene como `status=cancelled`, marca `status='cancelled'` en la cita.
- Guarda el nuevo watermark en una columna `last_pull_at` que agregamos a `google_calendar_tokens`.

**Cron nuevo** (`pg_cron`) cada 10 min llamando a `calendar-sync` con `{action:'pull_events'}`.

**Sin auto-asignación**: las citas de Voice/WhatsApp sin `user_id` se dejan `PENDING_SYNC` (según respuesta). Añado un badge/filtro en `AppointmentsPage` para verlas y asignarlas manualmente desde un dropdown de empleados.

## 2. Cal.com (por tenant con API key + webhook)

**Migración nueva**: tabla `calcom_integrations`
- `id`, `tenant_id`, `user_id` (quien conectó), `api_key_encrypted` (AES-GCM con `CREDENTIALS_ENCRYPTION_KEY`), `webhook_secret`, `default_event_type_id`, `status`, `last_sync_at`, `created_at/updated_at`.
- RLS: `authenticated` puede ver/gestionar solo su tenant vía `has_tenant_role`; `service_role` acceso total.
- GRANTs correspondientes.

**Edge function `calcom-webhook`** (público, `verify_jwt=false`)
- Recibe payloads `BOOKING_CREATED`, `BOOKING_RESCHEDULED`, `BOOKING_CANCELLED`.
- Valida `X-Cal-Signature-256` (HMAC-SHA256 con `webhook_secret` de la fila `calcom_integrations`).
- Busca tenant por header `X-Tenant-Id` (URL parametrizada: `/functions/v1/calcom-webhook?tenant_id=<uuid>`).
- Upsert en `appointments` con `source='calcom'`, `calendar_event_id=<booking.uid>`, contacto y horario del payload.
- Log en `webhook_logs`.

**Edge function `calcom-sync`** (autenticada)
- Acciones: `connect` (guarda API key encriptada + genera webhook_secret + registra webhook via API Cal.com `POST /webhooks`), `disconnect`, `pull_bookings` (opcional, para poblar histórico).

**UI en `IntegrationsPage`**: nueva tarjeta "Cal.com" con wizard de 2 pasos (pegar API key → mostrar URL de webhook auto-generada). Estado de conexión leído de `calcom_integrations`.

## 3. Detalles técnicos

- **Anti-eco Google**: cuando la app crea un evento en Google, ya guarda `ID: <uuid>` en la descripción. Al hacer pull, si el evento tiene ese marcador y el uuid ya está en `appointments.id`, lo saltamos.
- **Cal.com API base**: `https://api.cal.com/v2`; auth `Authorization: Bearer <api_key>`.
- **Encriptación API key**: reutilizo helper AES-GCM del vault de credenciales existente.
- **Cron**: SQL vía `supabase--insert` (no migración) porque contiene el anon key del proyecto.

## 4. Archivos

**Migraciones**
- `calcom_integrations` + policies + grants
- `google_calendar_tokens` add `last_pull_at timestamptz`

**Edge functions**
- Editar `supabase/functions/calendar-sync/index.ts` → añadir `pull_events`
- Nueva `supabase/functions/calcom-webhook/index.ts`
- Nueva `supabase/functions/calcom-sync/index.ts`

**Frontend**
- `src/pages/IntegrationsPage.tsx` → tarjeta Cal.com + wizard
- `src/pages/AppointmentsPage.tsx` → filtro "Sin asignar" + selector empleado inline
- `src/pages/CalendarPage.tsx` → badge de origen (Google/Cal.com/App) por color

**Cron**
- 1 nuevo job `cron.schedule('gcal-pull-10m', '*/10 * * * *', ...)`

## 5. Fuera de alcance
- OAuth propio de Cal.com (usamos API keys personales del usuario)
- Webhooks push de Google Calendar
- Auto-asignación de empleado a citas huérfanas
