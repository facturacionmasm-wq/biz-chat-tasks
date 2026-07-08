
# Objetivo

Un tenant sin suscripción pagada (nunca pagó, trial expirado, canceled o past_due) debe ver el **selector de planes con el badge de garantía de 30 días** para poder suscribirse, en lugar del muro "Contactar administrador". Se mantienen intactos: bypass de `super_admin` y master tenant, el checkout post-onboarding en `BillingSection`, y el flujo actual del OnboardingPage para tenants nuevos.

Enfoque elegido: **C — hacer ambas cosas** (redirigir a /onboarding + rediseñar /blocked) para blindar contra cualquier entrada manual a la ruta.

---

# Cambios

## 1) Extraer `PlanSelectionPanel` (componente compartido)

Nuevo archivo `src/components/PlanSelectionPanel.tsx`. Contiene toda la lógica del paso "Plan" que hoy vive inline en `OnboardingPage.tsx`:

- Fetch de `subscription_plans` activos + `global_plan_pricing` por país del tenant.
- Renderiza las tarjetas con `PLAN_ICONS`, `PLAN_COLORS`, features y límites.
- Toggle mensual / anual.
- CTA que invoca `stripe-billing` acción `create_subscription_checkout` (misma que hoy) y redirige al Checkout de Stripe.
- Muestra `<SatisfactionGuaranteeBadge />` arriba.
- Props: `tenantId`, `countryCode`, `returnPath` (para el `success_url` / `cancel_url` de Stripe), `variant?: 'onboarding' | 'reactivation'` (solo cambia copy del header).

Contrato: componente puro de presentación + checkout, no toca gating ni navegación fuera de Stripe.

## 2) Refactor `OnboardingPage.tsx`

- Reemplazar el bloque JSX del paso Plan (aprox. líneas 400–540) por `<PlanSelectionPanel tenantId=… countryCode=… returnPath="/" variant="onboarding" />`.
- Mantener los pasos previos (empresa, país) y el auto-salto a Plan cuando el tenant ya existe.
- El badge deja de renderizarse aparte: ya vive dentro del panel.

## 3) Rediseñar `SubscriptionBlockedPage.tsx` (`/blocked`)

Convertirla en pantalla de reactivación:

- Header corto: título "Reactiva tu suscripción" / mensaje explicando que el trial/plan terminó (usa `subscriptionStatus.plan_name` y `trial_ends_at` cuando existan).
- Cuerpo: `<PlanSelectionPanel tenantId={tenantId} countryCode={tenantCountry} returnPath="/" variant="reactivation" />` (con el badge de garantía ya incluido).
- Footer: enlace secundario "Cerrar sesión" (conservar `signOut`). Retirar el botón `mailto:` de "Contactar administrador".
- Resolver `tenantId` y `countryCode` con `get_user_tenant_id` + `tenants.country_code` (mismo patrón que OnboardingPage).

## 4) Ajustar `ProtectedRoute` en `src/App.tsx`

En la rama de "no bypass":

```
if (is_blocked || onboardingCompleted === false) → /onboarding   (siempre)
if (status && status !== 'active' && status !== 'trialing') → /onboarding
```

Es decir, todos los caminos de "sin suscripción pagada" apuntan a `/onboarding`. `/blocked` queda como fallback accesible pero ya rediseñado.

## 5) Ajustar `OnboardingRoute` y `BlockedRoute`

- `OnboardingRoute`: permitir entrada siempre que NO haya `has_paid_subscription` (aunque `onboardingCompleted === true`). Solo rebota a `/` cuando hay suscripción pagada activa o el usuario es bypass.
- `BlockedRoute`: permitir entrada cuando no hay suscripción pagada (no solo `is_blocked`), para que la ruta manual muestre el panel de reactivación en vez de rebotar.

## 6) `OnboardingPage` — auto-salto a paso Plan

Cuando `onboardingCompleted === true` pero `has_paid_subscription === false` (caso de tenants existentes sin pago), saltar directo al paso Plan sin volver a pedir empresa/país.

---

# Fuera de alcance (no se toca)

- `stripe-billing` edge function y el webhook: siguen igual, ya soportan `create_subscription_checkout` y activan `onboarding_completed = true` al confirmar el pago.
- `subscription_plans`, precios, límites, `global_plan_pricing`.
- `BillingSection`, `PlanUpgradeCard` (siguen su rol de gestión post-suscripción y upsells).
- Bypass de `super_admin` / master tenant.
- `PendingApprovalRoute`.

---

# Detalles técnicos

**Archivos modificados**
- `src/App.tsx` — ajustar guardas `ProtectedRoute`, `OnboardingRoute`, `BlockedRoute`.
- `src/pages/OnboardingPage.tsx` — reemplazar paso Plan por `<PlanSelectionPanel>`; añadir auto-salto cuando no hay `has_paid_subscription`.
- `src/pages/SubscriptionBlockedPage.tsx` — reescribir como pantalla de reactivación con `<PlanSelectionPanel>`.

**Archivos nuevos**
- `src/components/PlanSelectionPanel.tsx` — extracción del paso Plan actual, con `SatisfactionGuaranteeBadge` incluido.

**Sin cambios de DB, edge functions ni secrets.**

**Riesgos / validación**
- Verificar que `PlanSelectionPanel` recibe `tenantId` y `countryCode` válidos en ambos contextos (onboarding y /blocked); si falta `countryCode` en `tenants`, caer a `MX` como default (comportamiento actual del OnboardingPage).
- Verificar que el `return_url` de Stripe apunta a `/` para que, al volver, `ProtectedRoute` reevalúe `has_paid_subscription` (ya actualizado por el webhook) y deje entrar a la app.
- Confirmar visualmente en `/onboarding` y `/blocked` que el badge y las tarjetas se ven idénticos.
