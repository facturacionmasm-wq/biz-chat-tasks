# Diagnóstico — botón "Reenviar" invitación de personal

## 1. Ubicación del botón y su handler

- **Botón**: `src/pages/SettingsPage.tsx` L1559–1569.
  - Se renderiza sólo si `isSuperAdmin && !isSelf && m.status !== 'pending_approval' && !m.confirmed`.
  - `onClick={() => handleResendInvite(m.user_id, m.email)}` (L1561).
- **Handler**: `handleResendInvite` en `src/pages/SettingsPage.tsx` L472–486.
  - Invoca `supabase.functions.invoke('team-management', { body: { action: 'resend_invite', user_id, email } })`.
- Verificado en DB: NIDIA (`camaranidia1@gmail.com`, tenant master `…001`) tiene `status = 'active'` y nunca ha iniciado sesión (`confirmed = false`), por eso sí se muestra el botón.

## 2. Edge function que atiende el resend

- `supabase/functions/team-management/index.ts` bloque `action === "resend_invite"` L105–158.
- Flujo actual:
  1. `adminClient.auth.admin.getUserById(user_id)` (L114) — OK.
  2. `adminClient.auth.admin.generateLink({ type: "magiclink", email })` (L123) — genera un link pero **la variable `linkData` no se usa**, o sea el link nunca se envía.
  3. `adminClient.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })` (L136) — intenta que Supabase Auth envíe un OTP/magic link.
- No pasa `tenant_id` ni `role` al reenviar: la función depende sólo del email para disparar el correo de Auth.

## 3. Causa raíz

Doble problema en `resend_invite`:

- **`generateLink` no envía correo**, sólo devuelve el `action_link`. El código lo descarta.
- **`signInWithOtp` en Lovable Cloud**: nuestro `auth-email-hook` está scaffoldado para plantillas `signup / magiclink / recovery / invite / email_change / reauthentication`. `signInWithOtp` con `shouldCreateUser:false` sobre un usuario **cuyo email nunca ha sido confirmado** normalmente responde `otp_disabled` / `email not confirmed`, y el hook no dispara un correo de tipo `invite`. Aunque el handler devuelva `success`, no llega correo.
- Además `signInWithOtp` está sujeta a rate limit de 60s por email; si se apretó dos veces devuelve 429 silenciosamente (el toast dice "Error…" pero el usuario lo interpreta como que "no funciona").

Logs recientes de `team-management` (últimos ~10 min): sólo eventos `booted/shutdown`, sin líneas de invocación de `resend_invite`. Es decir la última acción no dejó traza porque no llegamos a un `console.log`; en el mejor caso el request se ejecutó y respondió `{ success: true }` mientras Supabase Auth internamente **no envía correo** para ese estado.

El patrón correcto ya existe en `supabase/functions/invite-member/index.ts` L102–115 (`adminClient.auth.admin.inviteUserByEmail(email, { data: { … } })`), que sí dispara el template `invite` del `auth-email-hook`.

## 4. Tablas / RLS / correo

- Tablas involucradas: `auth.users` (gestionada por Supabase, no tocar), `public.profiles` (`status`, `email`), `public.user_roles`. No hay tabla `invitations` separada.
- RLS: no se toca. El resend corre con `service_role` dentro de la edge function.
- Envío de correo: `auth-email-hook` (`LOVABLE_API_KEY`, plantilla `invite`) — ya scaffoldado. Requiere que `inviteUserByEmail` sea quien dispare el evento.

## 5. Fix mínimo propuesto (sin tocar RLS, pin-service, calendar, prompts, generated types, ni Stripe webhook)

Un solo archivo: `supabase/functions/team-management/index.ts`, bloque `resend_invite` L105–158.

Cambios:

1. Eliminar el `generateLink` muerto (L122–133) y la llamada a `signInWithOtp` (L136–156).
2. Reemplazarlas por `adminClient.auth.admin.inviteUserByEmail(email, { data: { name: existingUser.user_metadata?.name, invited_to_tenant: callerRole.tenant_id } })` (mismo patrón que `invite-member`).
3. Mantener el mapeo de rate-limit (Supabase devuelve `email rate limit exceeded` → 429 con mensaje "Debes esperar 60 segundos…").
4. Añadir `console.log` de éxito/fallo con `user_id`, `email`, `status` HTTP para que quede rastro en runtime logs.
5. Devolver `{ success:true, message:'Invitación reenviada al correo del miembro' }` sólo si la llamada al Auth Admin respondió sin error.

No hace falta cambiar:
- El botón/handler en `SettingsPage.tsx` (ya envía los datos correctos).
- Migraciones, secretos, `auth-email-hook` (la plantilla `invite` ya existe).
- Frontend, prompts, `pin-service`, RLS de ninguna tabla, generated types, ni `stripe-webhook`.

## 6. Verificación después de aplicar

1. Redeploy de `team-management`.
2. Clic en "Reenviar" para NIDIA desde `/settings` → `Equipo`.
3. Confirmar en runtime logs `team-management`: línea `[team-management] resend_invite ok user=1048cf9d… email=camaranidia1@gmail.com` y HTTP 200.
4. Confirmar en `email_send_log` una fila `template_name='invite'` reciente para ese email en estado `sent`.
