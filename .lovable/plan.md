## Diagnóstico confirmado

**Error real en logs recientes**
- `team-management` mostró dos errores recientes:
  - `2026-07-07T17:44:35Z ERROR [team-management] resend_invite failed user=1048cf9d-8069-49ba-a4d2-3e216dd9288b email=camaranidia1@gmail.com: A user with this email address has already been registered`
  - `2026-07-07T17:46:31Z ERROR [team-management] resend_invite failed user=1048cf9d-8069-49ba-a4d2-3e216dd9288b email=camaranidia1@gmail.com: A user with this email address has already been registered`
- El frontend captura eso como runtime error: `Edge function returned 400: {"error":"A user with this email address has already been registered"}`.
- Los logs HTTP agregados de edge no devolvieron filas, pero el runtime log de la función sí confirma el fallo y el body expuesto al cliente.

**Estado real de NIDIA en auth/base de datos**
- `public.profiles`: `user_id=1048cf9d-8069-49ba-a4d2-3e216dd9288b`, `tenant_id=00000000-0000-0000-0000-000000000001`, `email=camaranidia1@gmail.com`, `status=active`, `onboarding_completed=true`.
- `auth.users`: el usuario ya existe, `email_confirmed_at` y `confirmed_at` están presentes, `last_sign_in_at=null`, `invited_at=null`.
- La UI lo marca como `confirmed=false` porque `team-management` usa `!!u.last_sign_in_at` como “confirmed” en `list_status`, no porque el email no esté confirmado. En esta app, el badge realmente significa “nunca inició sesión”.

## Causa raíz real

El fix anterior falló porque `adminClient.auth.admin.inviteUserByEmail(email)` sólo sirve para invitar/crear usuarios nuevos. Para NIDIA, el usuario ya existe en `auth.users`; por eso Auth responde `A user with this email address has already been registered` y `team-management` devuelve 400.

La hipótesis queda confirmada: para “reenviar” a un usuario existente, no se puede depender de `inviteUserByEmail` ni de `generateLink({ type: 'invite' })` como flujo de creación. Hay que generar un link para un usuario existente y enviar ese link por nuestra propia función de correo.

## Ubicación exacta del flujo actual

**Frontend**
- `src/pages/SettingsPage.tsx:472-486`
  - `handleResendInvite(targetUserId, targetEmail)` invoca `team-management` con:
    - `{ action: 'resend_invite', user_id: targetUserId, email: targetEmail }`
- `src/pages/SettingsPage.tsx:1559-1569`
  - Botón `Reenviar` visible para `isSuperAdmin && !isSelf && m.status !== 'pending_approval' && !m.confirmed`.

**Edge function actual**
- `supabase/functions/team-management/index.ts:105-153`
  - Valida `email` y `user_id`.
  - Busca el usuario con `adminClient.auth.admin.getUserById(user_id)`.
  - Línea `124`: llama `adminClient.auth.admin.inviteUserByEmail(email, { data: ... })`.
  - Líneas `131-145`: en error devuelve 400 salvo rate-limit.

## Funciones de correo encontradas

**No existe actualmente el flujo Lovable auth-email-hook en el repo**
- No hay carpeta `supabase/functions/auth-email-hook`.
- No hay `supabase/functions/_shared/email-templates/`.
- `supabase/config.toml` no registra `auth-email-hook`.
- `email_domain` reporta: “No email domain is configured for this project”, por lo que no hay infraestructura Lovable Emails activa para plantillas auth personalizadas.

**Función de correo existente**
- `supabase/functions/send-support-email/index.ts`
  - Usa `RESEND_API_KEY` directamente.
  - Firma actual: requiere usuario autenticado, crea ticket de soporte y envía sólo a `soporte@rybixholding.com`.
  - No sirve directamente para invitaciones porque mezcla creación de ticket, recipient fijo y autorización de usuario normal.

**Patrón reutilizable**
- `send-support-email` demuestra que el proyecto ya tiene `RESEND_API_KEY` y puede enviar vía Resend.
- Para `resend_invite`, lo mínimo no es invocar `send-support-email`, sino crear un helper interno dentro de `team-management` que use `RESEND_API_KEY` para enviar un email de invitación al `targetEmail` con el `action_link` generado.

## Fix mínimo concreto propuesto

Modificar sólo `supabase/functions/team-management/index.ts`, bloque `resend_invite`.

1. Mantener validaciones existentes:
   - Auth del caller.
   - Caller `super_admin` u `owner`.
   - `email` y `user_id` requeridos.
   - `getUserById(user_id)`.

2. Corregir aislamiento tenant antes de enviar:
   - Consultar `profiles` por `user_id` y `email`.
   - Si caller no es `super_admin`, exigir `profile.tenant_id === callerRole.tenant_id`.
   - Para `super_admin`, permitir master tenant o el tenant del perfil encontrado.
   - Esto preserva aislamiento por tenant sin tocar RLS.

3. Cambiar la lógica de envío:
   - Si el usuario ya existe:
     - Usar `adminClient.auth.admin.generateLink({ type: 'magiclink', email })`.
     - Extraer `properties.action_link` o `action_link/url` según lo que devuelva el SDK.
     - Enviar ese link manualmente vía Resend desde `team-management` usando `RESEND_API_KEY`.
   - Si en algún caso futuro el usuario no existe:
     - Se puede devolver 404 como ahora, o usar `inviteUserByEmail`; para este bug basta mantener 404 porque `resend_invite` recibe `user_id` de un perfil existente.

4. Agregar helper interno mínimo en `team-management`:
   - `sendInviteEmail({ to, name, actionLink })`.
   - Endpoint: `POST https://api.resend.com/emails`.
   - From: usar dominio existente del proyecto, por ejemplo `Soporte OfficeHub <soporte@rybixholding.com>` o idealmente `RYBIX <soporte@rybixholding.com>` para evitar referencia OfficeHub visible.
   - To: `[email]`.
   - Subject: `Tu acceso a RYBIX`.
   - HTML: copy breve con botón “Entrar a RYBIX” y fallback con URL.
   - Si Resend falla, loguear status/body completos y devolver ese error; no mostrar éxito falso.

5. Logging requerido:
   - En `generateLink` error: log con `status`, `name`, `message` si existen.
   - En Resend error: log `Resend <status>: <body>` completo.
   - En éxito: log `resend_invite ok existing_user_magiclink user=... email=... tenant=... resend_status=...`.

6. Respuesta al frontend:
   - Éxito: `{ success: true, message: 'Invitación reenviada al correo del miembro' }`.
   - Error real: `{ error: '...' }` con status apropiado.

## No tocar

- No tocar RLS.
- No tocar `pin-service`.
- No tocar calendario.
- No tocar prompts.
- No tocar generated types.
- No tocar `stripe-webhook`.
- No tocar `SettingsPage.tsx` salvo que se quiera mejorar el mensaje visual; no es necesario para resolver el bug.

## Verificación después de implementar

1. Deploy de `team-management`.
2. Click en `Configuración -> Equipo -> Reenviar` para NIDIA.
3. Revisar logs de `team-management`:
   - Debe aparecer generación de magic link exitosa.
   - Debe aparecer respuesta Resend 200/202 o el error exacto.
4. Confirmar que el frontend ya no recibe 400 `already registered`.
5. Confirmar que el correo se envía a `camaranidia1@gmail.com` con el link de acceso.