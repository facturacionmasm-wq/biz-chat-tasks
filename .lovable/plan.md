# Plan: cerrar 2 hallazgos criticos de seguridad

Objetivo: bloquear la lectura de `access_token`/`refresh_token` (google_calendar_tokens) y `pin_hash` (profiles) desde el rol `authenticated`, sin romper login PIN, sync de Google Calendar, Cal.com, WhatsApp, ni agente de voz.

## Enfoque

Enfoque menos disruptivo: **column-level privileges**. Postgres permite `GRANT SELECT (col_a, col_b)` por columna. Revocamos SELECT total y regrantamos SELECT solo sobre columnas NO secretas para `authenticated`. RLS existente queda igual. `service_role` no se toca (mantiene acceso completo), por lo que TODAS las Edge Functions siguen funcionando sin cambios.

Auditoria del uso actual (ya verificada):
- Frontend NUNCA hace SELECT de `access_token`/`refresh_token` — solo `.delete()` en `IntegrationsPage.tsx` y `SettingsPage.tsx` (DELETE no requiere SELECT sobre columnas).
- Frontend NUNCA hace SELECT de `pin_hash` — todos los `.select()` sobre `profiles` piden columnas explicitas (`tenant_id`, `user_id`, `name`, etc.).
- El estado "calendar connected/email" ya lo entrega la Edge Function `google-calendar-auth` (GET) con service_role.
- `pin-service` (verify/hash) usa service_role — no afectado.

Conclusion: no hace falta reescribir componentes frontend. Solo migracion SQL + opcionalmente una vista de conveniencia.

## Cambios

### 1. Migracion SQL (unico archivo nuevo)

**a) `google_calendar_tokens`** — revocar acceso de `authenticated` a columnas secretas:

```sql
REVOKE SELECT ON public.google_calendar_tokens FROM authenticated;
GRANT SELECT (
  id, user_id, tenant_id, email, status,
  calendar_id, token_expires_at, created_at, updated_at
) ON public.google_calendar_tokens TO authenticated;
-- INSERT/UPDATE/DELETE se conservan (usados por DELETE del frontend).
GRANT INSERT, UPDATE, DELETE ON public.google_calendar_tokens TO authenticated;
-- service_role intacto (GRANT ALL ya existente).
```

Politica RLS actual (`Users can view own calendar connection status`, `Users manage own calendar tokens`) queda igual — sigue restringiendo por `user_id = auth.uid()`, ahora ademas a nivel columna.

**b) `profiles`** — bloquear `pin_hash` a `authenticated`:

```sql
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (
  id, user_id, tenant_id, name, email, phone, whatsapp_number,
  avatar_url, status, onboarding_completed, role_hint,
  created_at, updated_at
) ON public.profiles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
```

(Confirmar lista exacta de columnas con `\d profiles` antes de aplicar — la migracion listara todas menos `pin_hash`.)

Nota: los UPDATE del usuario sobre su propio perfil siguen funcionando; RLS los limita. Si alguien intenta `UPDATE ... SET pin_hash=...` desde el cliente, tampoco tiene `UPDATE (pin_hash)` — reforzamos con:

```sql
REVOKE UPDATE (pin_hash) ON public.profiles FROM authenticated;
```

`pin-service` usa service_role → sigue leyendo/escribiendo `pin_hash` normal.

### 2. Vista de conveniencia (opcional, para futuro uso limpio)

```sql
CREATE OR REPLACE VIEW public.calendar_connections_v AS
SELECT id, user_id, tenant_id, email, status, calendar_id,
       token_expires_at, created_at, updated_at
FROM public.google_calendar_tokens;

GRANT SELECT ON public.calendar_connections_v TO authenticated;
ALTER VIEW public.calendar_connections_v SET (security_invoker = true);
```

Se documenta pero **no** se obliga a migrar los 2 `.from('google_calendar_tokens' as any).delete()` — siguen validos porque el REVOKE solo aplica a SELECT.

### 3. Archivos frontend

Ninguno requiere cambios funcionales. Los dos `select` ya no existen sobre columnas secretas; los `delete` no requieren SELECT.

Verificacion post-migracion: cargar `IntegrationsPage` y `SettingsPage`, desconectar/reconectar Google Calendar, iniciar sesion por PIN via WhatsApp, ejecutar `calendar-sync` desde el agente de voz.

## Archivos a tocar

- `supabase/migrations/<timestamp>_lock_secret_columns.sql` — NUEVO (unico cambio)

## Archivos intactos (confirmado)

- Edge Functions: `google-calendar-auth`, `calendar-sync`, `calendar-tools`, `voice-scheduling`, `google-drive`, `ai-assistant`, `whatsapp-bot/*`, `pin-service`, `admin-delete-tenant` — todas usan `SUPABASE_SERVICE_ROLE_KEY`, no afectadas.
- `call-transfer`, `call-transfer-twiml`, `elevenlabs-actions-webhook`, `calcom-webhook` — no leen estas columnas.
- Frontend: sin cambios de codigo.
- Configuracion ElevenLabs, Cal.com, Twilio: sin cambios.

## Confirmaciones

- **Login PIN**: `pin-service` con service_role → intacto. Cliente nunca leia `pin_hash`.
- **Sync Google Calendar**: `calendar-sync`, `calendar-tools`, `google-calendar-auth` (callback y GET status) con service_role → intactos. Estado de conexion en UI ya viene de la Edge Function GET, no de SELECT directo.
- **Agente de voz / Cal.com / WhatsApp**: no tocan estas columnas desde el cliente.

## Rollback

Un solo `GRANT SELECT ON <tabla> TO authenticated;` restaura el estado previo si algo se rompe.
