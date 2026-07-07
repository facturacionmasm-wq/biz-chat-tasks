## Causa raíz

**NIDIA ya aceptó la invitación** — su estado real en la BD:
- `auth.users.email_confirmed_at = 2026-03-13 17:52:41` ✅ (confirmó email)
- `auth.users.confirmed_at = 2026-03-13 17:52:41` ✅
- `auth.users.last_sign_in_at = NULL` ❌ (nunca ha iniciado sesión completa desde el magic link, o Supabase no registró la sesión)
- `profiles.status = 'active'`, `onboarding_completed = true`

**El bug está en el criterio de "confirmed"** en `supabase/functions/team-management/index.ts` **línea 165**:

```ts
confirmed: !!u.last_sign_in_at,
```

Este criterio solo considera "confirmado" al miembro cuando ya inició sesión (last_sign_in_at). Ignora `email_confirmed_at` y `profiles.status`. Por eso NIDIA — que confirmó el correo pero cuyo `last_sign_in_at` sigue en NULL — aparece como `confirmed: false`.

**En el frontend** `src/pages/SettingsPage.tsx`:
- Línea **1559**: `isSuperAdmin && !isSelf && m.status !== 'pending_approval' && !m.confirmed` → muestra botón **"Reenviar"**.
- Línea **1570**: `!m.confirmed && !isSelf && m.status !== 'pending_approval'` → muestra badge **"Pendiente"**.

Ambos dependen de `m.confirmed`, que viene directamente del `list_status` del edge function. Como `confirmed=false`, se pintan ambos indicadores aunque NIDIA ya esté activa.

## Fix mínimo propuesto

Un solo cambio en `supabase/functions/team-management/index.ts`, dentro del bloque `action === "list_status"` (líneas 161-169):

1. Traer también `profiles.status` en el `select` (línea ~155).
2. Cambiar el cálculo de `confirmed` a:

```ts
confirmed: !!(u.email_confirmed_at || u.confirmed_at || u.last_sign_in_at)
           || p.status === 'active',
```

Es decir, un miembro se considera confirmado si **cualquiera** de estas condiciones se cumple:
- Ya confirmó su correo (`email_confirmed_at` / `confirmed_at`) — cubre a NIDIA.
- Ya inició sesión (`last_sign_in_at`) — comportamiento previo.
- Su perfil ya está activo (`profiles.status === 'active'`) — refuerzo de seguridad para casos donde el owner aprobó manualmente.

Con esto:
- NIDIA pasa a `confirmed=true` → desaparecen los indicadores "Pendiente" y "Reenviar" en la UI.
- Miembros que aún no abren el correo (sin `email_confirmed_at`, sin `last_sign_in_at`, `status != 'active'`) siguen mostrando "Pendiente" + "Reenviar" correctamente.

## Impacto

- **Archivo único**: `supabase/functions/team-management/index.ts`, líneas ~154-169 (bloque `list_status`).
- **Frontend**: sin cambios. `SettingsPage.tsx` sigue usando `m.confirmed` tal cual.
- **Aislamiento por tenant**: intacto — el query de `profiles` ya filtra por `callerRole.tenant_id`.
- **No se toca**: RLS, `pin-service`, calendario, prompts, generated types, `stripe-webhook`, ni la lógica de `resend_invite`.
- **Riesgo**: nulo. Sólo amplía la condición de "confirmado"; no se rebaja seguridad ni se cambia comportamiento de aprobación (`pending_approval` sigue teniendo su propia rama).
