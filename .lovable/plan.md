# Auditoría Stripe + Plan Agentes Voz por Tenant + Revisión Últimos Cambios

## TEMA A — Stripe: flujo, gaps y fix mínimo

### A.1 Flujo real hoy (login → onboarding → plan → cobro)

Trazabilidad completa:

```text
Login (AuthPage) → AuthContext.fetchUserData (src/contexts/AuthContext.tsx:54-91)
  → onboarding_completed=false → redirect a /onboarding
  → OnboardingPage step "company" → "country" → "plan"
  → click plan → handlePlanSelect (src/pages/OnboardingPage.tsx:180-261):
       1) rpc activate_trial_for_current_user  (BD: trial 15d)
       2) invoke stripe-billing action=create_trial_subscription   (líneas 668-804 stripe-billing)
       3) invoke stripe-billing action=create_setup_session return_to='/'
       4) window.location.href = setup.checkout_url  → Stripe Checkout mode=setup
  → tras pagar/verificar: Stripe redirige a /?setup=success
  → stripe-webhook handleCheckoutCompleted (mode='setup') persiste stripe_customer_id
  → stripe-webhook setup_intent.succeeded (líneas 428-477) engancha PM como default y a la suscripción
```

Selector de plan real: `src/pages/OnboardingPage.tsx:412-558` (paso "plan"). En Settings → tab Billing: `src/components/BillingSection.tsx:508-565` (`TenantBillingView.handleChangePlan`). En Voice cuando falta plan: `src/components/PlanUpgradeCard.tsx` (solo redirige a /settings?tab=billing, no lanza checkout).

### A.2 Edge functions relacionadas con Stripe

| Función | Acción | Estado |
|---|---|---|
| `stripe-billing` `one_time_support_consult` (L53-140) | consulta única $20 | Completa (Checkout mode=payment) |
| `stripe-billing` `validate_key` (L145-157) | valida formato sk_/rk_ | Placebo (no llama a Stripe) |
| `stripe-billing` `create_customer_and_subscribe` (L162-309) | crea customer+sub metered | Completa pero **NO se usa desde UI** — legacy |
| `stripe-billing` `report_usage` (L314-383) | reporta consumo mensual | Completa |
| `stripe-billing` `create_setup_session` (L388-454) | Checkout mode=setup (tarjeta) | Completa |
| `stripe-billing` `check_payment_method` (L459-488) | verifica PM guardado | Completa |
| `stripe-billing` `purchase_package` (L493-625) | paquete prepago voice/wa | Completa (Checkout mode=payment) |
| `stripe-billing` `get_billing_status` (L630-660) | resumen uso+margen | Completa |
| `stripe-billing` `create_trial_subscription` (L668-804) | sub Stripe en trialing con trial_end fijo | Completa |
| `stripe-billing` `change_plan` (L809-951) | upgrade/downgrade con proration | Completa (exige PM) |
| `stripe-billing` `verify_payment_method` (L956-984) | detalle de tarjeta default | Completa |
| `stripe-billing` `charge_phone_number` (L989-1098) | cargo puntual número | Completa |
| `stripe-billing` `charge_verification_fee` (L1100-1195) | fee $15 regulatorio | Completa |
| `stripe-webhook` (493L) | events firmados HMAC-SHA256 | Completa: checkout.session.completed, invoice.paid/failed, subscription.updated/deleted, setup_intent.succeeded, invoice.finalized |
| `billing-monthly-report` | cron mensual | Existe |

**No hay** funciones tipo `create-checkout-subscription` (mode=subscription puro), `customer-portal` (portal Stripe) ni `payment-method` (attach directo desde UI). No es bloqueante — el flujo se apoya en Checkout mode=setup + `default_incomplete`/proration.

### A.3 Ventanas que deberían cobrar — auditoría

1. **Onboarding elegir plan** (`OnboardingPage.tsx:180-261`) — sí lanza `create_trial_subscription` **+** `create_setup_session` y redirige a Checkout. ✅
2. **Settings → Billing → cambiar plan** (`BillingSection.tsx:522-564`) — llama `change_plan`; si `requires_payment_method` cae en `create_setup_session` → Checkout. ✅
3. **PlanUpgradeCard** (`PlanUpgradeCard.tsx:32`) — solo `navigate('/settings?tab=billing')`; **no dispara checkout**. ⚠️ (esperado: el cobro se hace desde Billing).
4. **PaymentGateCard** (voice/whatsapp) — `usePaymentGate.setupCard` (`src/hooks/usePaymentGate.ts:104-133`) → `create_setup_session` → Checkout. ✅  
   `purchasePackage` (L84-102) → `purchase_package` → Checkout mode=payment. ✅
5. **SubscriptionBlockedPage** — usa el mismo `BillingSection`/checkout. ✅

### A.4 Gaps y fix mínimo (Stripe)

**Gap 1 — Onboarding no bloquea salida si el usuario cancela Checkout.**  
`OnboardingPage.tsx:246-249` redirige a `/?setup=success`, pero si cancela llega a `/?setup=cancel` sin `PM` y con `onboarding_completed=true`. Trial válido pero sin tarjeta → al finalizar trial Stripe cancela por `trial_settings.end_behavior=cancel` (L765). El usuario cree que "no pagó y sigue funcionando" hasta el día 15.  
**Fix mínimo**: en `AppLayout`/dashboard, si `subscriptionStatus.status='trialing'` y `check_payment_method.has_payment_method=false`, mostrar un banner persistente "Agrega tarjeta para no perder acceso al terminar el trial" con botón que invoque `create_setup_session` (`service_type:'onboarding', return_to:'/'`). Sin cambios en edge functions.

**Gap 2 — `create_trial_subscription` falla silenciosamente en onboarding.**  
`OnboardingPage.tsx:231` sólo hace `console.warn` si `trialErr`. Si Stripe rechaza (ej. moneda sin precio configurado, L709-713 devuelve 400 "Plan has no billable price configured"), el usuario avanza sin sub Stripe. Cuando el trial local expira, no hay charge automático.  
**Fix mínimo**: al fallar `create_trial_subscription`, seguir a `create_setup_session` (ya se hace), **pero** guardar el error en `audit_events` desde el frontend y mostrar toast rojo. Alternativa robusta: mover el intento a un post-hook del webhook `setup_intent.succeeded` — si no hay `stripe_subscription_id`, invocar internamente `create_trial_subscription`.

**Gap 3 — `PlanUpgradeCard` sólo navega; no ofrece CTA directo al Checkout.**  
Usuario en /calls con plan sin voice_agent ve "actualizar a Pro" pero requiere 2 clics extra (Settings → Billing → botón por plan).  
**Fix mínimo**: agregar prop `onUpgrade` al `PlanUpgradeCard` que, con el `slug` deseado, invoque `stripe-billing action=change_plan` directamente; si `requires_payment_method` redirigir a `create_setup_session` con `return_to='/calls'`. Sin cambios en edge functions.

**Gap 4 — `validate_key` (L145-157) es cosmético.**  
No llama a Stripe. Si `BillingSection` la usa para "Activar Stripe" da falso OK.  
**Fix mínimo**: reemplazar el cuerpo por `GET /v1/balance` real y regresar `success = res.ok`. Cambio de <20 líneas.

**Gap 5 — Nombre en Stripe queda como email cuando no hay `user_metadata.name`.**  
Aparece en `OnboardingPage.tsx:217`, `BillingSection.tsx:534`, `usePaymentGate.ts:96/125`. Cosmético.  
**Fix mínimo**: leer también `profiles.name` como fallback antes que `user.email`.

**No falta** captura de método de pago en el propio onboarding: sí se dispara `create_setup_session` (L236-249). El único hueco es que la cancelación no se maneja. Con el banner del Gap 1, el flujo queda cerrado en todas las ventanas.

---

## TEMA B — Agente ElevenLabs por tenant (solución definitiva)

Estado actual: hay una única `ELEVENLABS_AGENT_ID` global usada por:
- `elevenlabs-conversation-token/index.ts:40, 96` (widget WebRTC)
- `elevenlabs-kb-sync/index.ts:38, 66, 96` (KB — actualmente bloqueado con 409 en `add`)
- `call-inbound-webhook/index.ts:100, 291, 378` (Twilio inbound)
- Existe columna `tenants.elevenlabs_config jsonb` (types.ts L4277) — **no requiere migración de esquema** si guardamos `agent_id` ahí; también existe `call_sessions.elevenlabs_agent_id` (types L866).

### B.1 Migración mínima (opcional, sólo si se prefiere columna dedicada)

```sql
-- opción A (recomendada): reutilizar elevenlabs_config JSONB
--   { "agent_id": "agent_xxx", "provisioned_at": "..." }
-- opción B (columna explícita)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS elevenlabs_agent_id text;
CREATE INDEX IF NOT EXISTS tenants_elevenlabs_agent_id_idx
  ON public.tenants(elevenlabs_agent_id) WHERE elevenlabs_agent_id IS NOT NULL;
```

Preferir opción A para no crecer el esquema.

### B.2 Provisioning por tenant (nueva edge function `elevenlabs-agent-provision`)

Nueva función `supabase/functions/elevenlabs-agent-provision/index.ts`:
- Requiere JWT del owner/super_admin.
- Resuelve `tenant_id` vía `get_user_tenant_id(auth.uid())` y `has_tenant_role(auth.uid(), tenant_id, 'owner')`.
- Lee `tenants.elevenlabs_config->>agent_id`; si existe, devuelve el agent.
- Si no, `POST https://api.elevenlabs.io/v1/convai/agents/create` con `name=OfficeHub - {tenant.name}`, prompt base clonado del agente global.
- Persiste en `tenants.elevenlabs_config = jsonb_set(coalesce(...), '{agent_id}', to_jsonb(new_id))` con `service_role`.
- Registra `audit_events` (`elevenlabs.agent_provisioned`).

Trigger de auto-provision: opcional botón en Settings → Integrations → "Aprovisionar agente de voz". No lo hacemos en `handle_new_user` para no gastar cuota si el tenant nunca usa voz.

### B.3 Cambios en las 3 edge functions actuales

Helper compartido nuevo `supabase/functions/_shared/elevenlabs-agent.ts`:

```ts
export async function resolveTenantAgentId(supabase, tenantId): Promise<string | null> {
  if (!tenantId) return null;
  const { data } = await supabase
    .from('tenants').select('elevenlabs_config').eq('id', tenantId).maybeSingle();
  const cfg = (data?.elevenlabs_config || {}) as any;
  return typeof cfg.agent_id === 'string' && cfg.agent_id.length ? cfg.agent_id : null;
}
```

**1) `supabase/functions/elevenlabs-conversation-token/index.ts`**
- Línea 40: eliminar lectura de `ELEVENLABS_AGENT_ID` como *default*; conservar para fallback dev.
- Después de resolver `profile.tenant_id` (L57-61): `const agentId = await resolveTenantAgentId(serviceClient, profile.tenant_id) ?? ELEVENLABS_AGENT_ID_FALLBACK;`
- Si no hay `agentId`, devolver 409 `{error:'no_tenant_agent', message:'Aprovisiona tu agente de voz en Ajustes → Integraciones'}` en lugar del 500 genérico L44.
- Línea 96 (fetch token): interpolar `agent_id=${agentId}` en vez del env.
- Master tenant (`00000000-0000-0000-0000-000000000001`): puede seguir usando el global — mantener fallback sólo para ese ID.

**2) `supabase/functions/elevenlabs-kb-sync/index.ts`**
- Requerir `tenant_id` implícito: resolverlo vía `anonClient.auth.getUser()` en lugar de `getClaims` (L33-38 hoy) para reutilizar el patrón de `conversation-token`.
- Reemplazar `ELEVENLABS_AGENT_ID` (L38, 66, 96) por `agentId = await resolveTenantAgentId(supabase, tenantId)`.
- Retirar el gate 409 hoy en `add` (L74-87) **una vez** que `agentId` provenga del tenant; si sigue siendo `null`, mantener 409 con nuevo código `no_tenant_agent`.
- Filtrar cualquier `data.tenant_id` de entrada para que coincida con el del JWT (defense-in-depth); si no coincide → 403.

**3) `supabase/functions/call-inbound-webhook/index.ts`**
- Después de `tenantId` resuelto (L191): `const agentId = await resolveTenantAgentId(supabase, tenantId) ?? ELEVENLABS_AGENT_ID;` (fallback global tolerado sólo por compat; loguear `voiceLog(...,'agent_id_fallback_global')` si se usa).
- Línea 291 y 378: usar `agentId` en `registerBody.agent_id` y en `call_sessions.elevenlabs_agent_id`.
- Si no hay agente y no hay global → responder con `twimlSay('El servicio de voz no está aprovisionado. Contacte al administrador.')` y NO llamar ElevenLabs.

**4) `elevenlabs-post-call/index.ts`, `elevenlabs-actions-webhook/index.ts`, `elevenlabs-staff-sync/index.ts`, `elevenlabs-bridge/index.ts`** — auditar cada uno con el mismo patrón. En este plan cubro las 3 pedidas; el resto queda como TODO listado (no requiere cambios inmediatos porque reciben `agent_id` desde ElevenLabs en el payload).

### B.4 UI: botón de provisioning

`src/pages/IntegrationsPage.tsx` (u `AssistantAdminPage.tsx`): añadir tarjeta "Agente de Voz IA" con botón "Aprovisionar / Ver estado" que llame `supabase.functions.invoke('elevenlabs-agent-provision')`. No romper llamadas actuales: mientras `elevenlabs_config.agent_id` sea `null`, `conversation-token` responde 409 y la UI muestra CTA; el widget ya maneja errores.

### B.5 Rollout seguro (no romper llamadas en curso)

1. Deploy `_shared/elevenlabs-agent.ts` y `elevenlabs-agent-provision`.
2. Migración jsonb (o columna) — no toca datos.
3. Botón UI + backfill manual del master tenant (`elevenlabs_config = { agent_id: ELEVENLABS_AGENT_ID }`) vía `INSERT` tool para no dejarlo sin agente.
4. Modificar las 3 edge functions con fallback al env global (mantiene status-quo).
5. Backfill tenants que ya lo usen: ejecutar provision por cada uno.
6. Cuando todos tengan `agent_id` propio, remover el fallback y eliminar `ELEVENLABS_AGENT_ID` global.

---

## TEMA C — Revisión línea a línea de los últimos 3 cambios

### C.1 `chat_channels.peer_user_id`

**Migración** (`supabase/migrations/20260707053846_*.sql`) — OK: `ADD COLUMN IF NOT EXISTS ... REFERENCES auth.users ON DELETE SET NULL` + índice parcial.

**`src/hooks/useChatPersistence.ts:345`** — `existing = channels.find(c => c.type==='direct' && (c.peerUserId===memberId || (!c.peerUserId && c.name===memberName)))`.  
Edge case: si dos usuarios tienen exactamente el mismo `name` (ej. dos "Juan Pérez") y el DM legacy no tiene `peerUserId`, `createDM` reutilizará el DM equivocado. Fix: preferir siempre `peerUserId===memberId` y **no** matchear por nombre en el fallback (aceptar crear un DM nuevo; el filtro de `visibleChannels` sigue funcionando).

**`ChatPage.tsx:93-102 visibleChannels`** — fallback por nombre igualmente vulnerable a homónimos; mismo diagnóstico. Aceptable si se documenta.

**Regresión posible**: al eliminar un usuario y volver a invitar con el mismo email/name, el nuevo user_id no coincidirá con el `peer_user_id` viejo (que quedó `NULL` por `ON DELETE SET NULL`). El DM legacy quedará oculto (correcto) pero **sin forma de reactivarlo**. Fix mínimo: si el nuevo perfil tiene el mismo nombre y hay DM con `peer_user_id IS NULL`, ofrecer "reasignar" al `createDM`. Baja prioridad.

### C.2 `WhatsAppInboxPage.handleDeleteConversation` (L97-119)

- L101: `.delete(...).select('id')` — OK, valida `error` y trata como duro.
- L104-108: valida `convRes.data.length > 0` — OK.
- **Bug menor**: si `msgRes` tiene 0 filas (conversación sin mensajes), no falla — correcto. Pero si RLS del DELETE en `whatsapp_messages` deniega y devuelve `error` de RLS, se lanza excepción y **no** se intenta borrar la conversación → estado consistente. OK.
- **Regresión**: no revoca `subscription` de realtime si estaba suscrito a esta conversación; el listener seguirá activo hasta el próximo re-mount. Cosmético.
- **UX**: `toast.error(err.message ...)` puede filtrar mensajes de Postgres (ej. "permission denied for table whatsapp_messages"). Aceptable pero recomiendo mensaje genérico + `console.error(err)`.

### C.3 `elevenlabs-kb-sync` gate 409

- L74-87: correcto — bloquea `add` con `kb_sync_disabled_shared_agent`.
- **Regresión**: `list` (L67-73) sigue consultando el agente compartido; devuelve KB de otros tenants. Si la UI muestra la lista, un tenant vería documentos ajenos. Fix mínimo inmediato: aplicar el mismo 409 al `list` mientras exista agente compartido (o filtrar en el cliente, menos seguro).
- **Regresión**: `delete` (L91-111) permite a cualquier tenant borrar por `elevenlabs_doc_id` en el agente compartido → **puede borrar docs de otro tenant**. Aplicar 409 también a `delete` hasta B.3.

**Fix mínimo consolidado**: en el mismo `elevenlabs-kb-sync/index.ts`, envolver `list` y `delete` con el mismo gate 409 hasta que exista `resolveTenantAgentId(tenantId)`.

---

## Prioridad recomendada (cuando se apruebe build)

1. Endurecer `elevenlabs-kb-sync` (gate 409 también en `list`/`delete`) — riesgo activo cross-tenant.
2. Banner "agrega tarjeta" durante trial (Gap 1 Stripe).
3. Provisioning por tenant (Tema B completo).
4. Ajustes menores C.1 / C.2.
5. Gaps 2-5 de Stripe.

Nada de esto se ha aplicado — es plan puro.