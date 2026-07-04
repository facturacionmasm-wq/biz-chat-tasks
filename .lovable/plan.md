
Se agregan tres cambios sin tocar los flujos ya funcionales de voz, WhatsApp, ni el cobro por uso actual.

## 1. Cobro mensual del número telefónico

### Base de datos
Migración sobre `tenant_phone_numbers`:
- `monthly_fee numeric(10,2) NOT NULL DEFAULT 0`
- `currency text NOT NULL DEFAULT 'USD'`
- `billing_status text NOT NULL DEFAULT 'pending'` (`pending | active | past_due | canceled`)
- `stripe_subscription_item_id text`
- `source text` (`twilio_purchase | byon_hosted | byon_portin | byon_verified_id`)
- `activated_at`, `canceled_at`, `next_billing_at timestamptz`

Nueva tabla `phone_number_pricing` (catálogo editable por super_admin): `country_code`, `number_type`, `source`, `monthly_fee`, `currency`, `active`.

Nueva tabla `phone_number_invoices`: `tenant_id`, `phone_number_id`, `period_start/end`, `amount`, `currency`, `stripe_invoice_id`, `status`. Con RLS: tenant lee lo suyo, super_admin todo, service_role total, más GRANTs estándar.

### Stripe (`supabase/functions/stripe-billing/index.ts`)
Nuevas acciones:
- `create_number_subscription` — crea/actualiza Subscription con un `subscription_item` por número (price recurring mensual desde `phone_number_pricing`). Prorratea el primer mes.
- `cancel_number_subscription` — cancela el item al liberar el número.
- `list_number_invoices` — para el dash.

En `stripe-webhook`: manejar `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated` → actualizar `billing_status` y poblar `phone_number_invoices`.

### Puntos de integración
- `tenant-provision-number`: tras insertar el número, buscar tarifa y llamar `create_number_subscription`. Si falla → rollback en Twilio.
- `byon-request-admin` al pasar a `completed`: mismo flujo, tarifa según `source`.
- `twilio-verify-caller-id` y Meta WhatsApp: `monthly_fee = 0`, sin suscripción.

### UI tenant (`UsagePage.tsx` / `BillingSection.tsx`)
Sección **Números activos** con tabla: número, país, tipo, origen, renta, estado, próximo cobro, botón "Cancelar número". Debajo, historial de `phone_number_invoices` con enlace al PDF Stripe. Modal de confirmación de cargo mensual antes de comprar/migrar.

### UI super_admin (`SuperAdminTenantsTab.tsx`)
Sub-tab **Precios de números**: CRUD sobre `phone_number_pricing` y vista de todos los `tenant_phone_numbers` con `billing_status`.

## 2. Botón para que el tenant elimine personal libremente

- En la pantalla actual de equipo (Settings → People o similar) agregar un botón "Eliminar" por miembro visible para `owner` y `admin` del tenant.
- Confirmación modal ("¿Eliminar a X del workspace?").
- Extender `supabase/functions/team-management/index.ts` con acción `remove_member` que:
  - Valida que el actor sea `owner`/`admin`/`super_admin` del mismo tenant.
  - Nunca permite eliminarse a uno mismo si es el único `owner` (bloqueo lógico).
  - Elimina filas en `user_roles` y `profiles` para ese `user_id` dentro del tenant.
  - Cascada limpia tokens de Google Calendar (ya existe trigger).
  - Registra en `audit_events` (`event_type: 'member_removed_by_tenant'`).
- Sin tocar `invite-member` ni el flujo de aprobación existente.

## 3. Sub-tab super admin: administración global de tenants

Nueva sub-tab en `SuperAdminTenantsTab.tsx` llamada **Tenants registrados**, con:

- Tabla de todos los tenants usando el RPC ya existente `admin_list_tenants_with_subscription` (nombre, plan, estado, días de trial, bloqueado, master).
- Acciones por fila:
  - **Cambiar suscripción**: modal para `activate | set_trialing | extend_trial (días) | set_past_due | block` → usa el RPC ya existente `admin_manage_tenant_subscription`.
  - **Cambiar plan**: dropdown con `subscription_plans` → nueva acción en el RPC (`change_plan`) que actualiza `tenant_subscriptions.plan_id`, registra en `plan_change_history` y en `audit_events`.
  - **Eliminar tenant**: nueva Edge Function `admin-delete-tenant` (JWT + role check `super_admin`) que:
    - Bloquea el master tenant (`00000000-0000-0000-0000-000000000001`).
    - En transacción: cancela Stripe Subscriptions/Items del tenant, borra `user_roles`, `profiles`, `tenants` (cascada configurada donde aplica). Datos ya con `deleted_at` se marcan; el resto se elimina.
    - Registra `audit_events` (`event_type: 'tenant_deleted'`) con payload de recuento por tabla afectada.
    - Confirmación en UI con doble input (escribir el nombre del tenant).
- Buscador por nombre/plan/estado y filtros por estado de suscripción.

## Detalles técnicos

- Toda escritura sensible pasa por Edge Functions con `SUPABASE_SERVICE_ROLE_KEY` y validación de rol.
- Se reutiliza el patrón existente `has_role`/`user_roles`.
- No se modifican `whatsapp-*`, `elevenlabs-*`, `call-*`, `voice-*`, `usePaymentGate`, ni el wizard `TenantNumberPurchaseWizard` más allá del paso de confirmación de cargo mensual.
- Todas las tablas nuevas incluyen GRANTs + RLS.

## Fuera de alcance

- Descuentos por volumen o packs multi-número.
- Reembolsos automáticos por cancelación a mitad de mes (manual por super_admin).
- Undo/soft-delete de tenants: la eliminación es definitiva y auditada.
