
# Compra de números Twilio — Ambos flujos

Objetivo: dejar totalmente operativa la compra de números para (A) SuperAdmin y (B) el tenant final, reutilizando la edge function ya funcional `twilio-provision-number` y **sin tocar** su contrato ni la lógica de webhooks/WhatsApp/Voice.

## Estado actual (verificado)

- `supabase/functions/twilio-provision-number/index.ts` ya funciona:
  - Acepta `tenant_id`, `country_code`, `areaCode`, `dryRun`, `phoneNumber`.
  - Autoriza `super_admin` por JWT **o** llamada con `service_role`.
  - Lista disponibles → compra → adjunta a Messaging Service → persiste en `tenants.whatsapp_config` → escribe `audit_events`.
- `SuperAdminTenantsTab.tsx` ya invoca esa función con selector de país (`provCountry`, default `US`) y area code. **Funciona**, solo le falta pulido (país libre en input, sin lista, sin filtro por capacidad, sin preview de costo).
- Ningún wizard de tenant (`IntegrationsPage`, `WhatsAppConnectionWizard`, `VoiceAgentWizard`) permite comprar número. Todos asumen que ya existe uno en Twilio.

Conclusión: la **estructura backend no se toca**. Solo agregamos UI y una capa de gating.

---

## A) SuperAdmin — pulido del flujo existente

Archivo: `src/components/SuperAdminTenantsTab.tsx` (solo la parte de provisión).

- Reemplazar el input de país por un **`<Select>`** con países soportados por Twilio para números Local (lista curada: US, CA, MX, GB, ES, DE, FR, IT, NL, BE, PT, IE, AT, CH, SE, NO, DK, FI, PL, CZ, BR, AR, CL, CO, PE, AU, NZ, JP, SG, HK, IN, ZA + "Otro" con input libre para el resto).
- Prellenar el país con `tenant.country` del row si viene definido (leer desde `tenants` en el mismo `admin_list_tenants_with_subscription` — si no lo trae, hacer un `select country` puntual al abrir el diálogo; sin migración).
- Agregar filtros opcionales para el `dryRun`: **Tipo** (Local / Mobile / Toll‑Free) y **Capacidades** (SMS / Voice / MMS). Requiere extender `twilio-provision-number` para aceptar `type` y `capabilities` opcionales, respetando defaults actuales (mantiene compatibilidad).
- Mostrar en cada número: `phone_number`, `locality`, `region`, chips de capacidades. Botón "Comprar" pide confirmación explícita ("Esta acción cobra a la cuenta Twilio maestra").
- Toast + refresh al terminar (ya existe).

## B) Tenant self-service — nuevo wizard de compra

### B.1 Gate de billing (regla `billing/access-control`)

Antes de mostrar el wizard, verificar en cliente:
- Suscripción no bloqueada (`get_tenant_subscription_status`, ya existe).
- Método de pago activo (leer `stripe_customers` del tenant → requerir `default_payment_method` no nulo). Si falta, mostrar `PaymentGateCard` y CTA a agregar tarjeta.
- Master tenant (`00000000-0000-0000-0000-000000000001`) bypassa el gate.

### B.2 Nueva edge function: `tenant-provision-number`

Wrapper delgado, **no reemplaza** a `twilio-provision-number`.
- Valida JWT del usuario → resuelve su `tenant_id` desde `profiles` (nunca confía en un `tenant_id` del body).
- Verifica rol `owner` o `admin` en ese tenant.
- Verifica gate de billing (suscripción activa/trial + payment method, salvo master).
- Verifica que el tenant **no** tenga ya un número activo en `tenants.whatsapp_config.phone_number` (evita compras duplicadas accidentales). Si ya tiene, devuelve 409 con el número existente.
- Llama internamente a `twilio-provision-number` con `service_role`, pasando el `tenant_id` resuelto.
- Registra `audit_events` con `actor_id = auth.uid()`.

Ventaja: la función `twilio-provision-number` original queda intacta, sigue siendo super_admin-only desde afuera; el wrapper es el único punto público para tenants.

### B.3 UI: `TenantNumberPurchaseWizard`

Nuevo componente en `src/components/TenantNumberPurchaseWizard.tsx`, montado desde `IntegrationsPage.tsx` como paso previo del `WhatsAppConnectionWizard` y del `VoiceAgentWizard` cuando `tenants.whatsapp_config.phone_number` está vacío. Si ya hay número, se muestra un badge "Número asignado: +…" y el botón "Comprar número" queda oculto.

Pasos:
1. **País/Región** — `<Select>` con la misma lista curada de A). Default = `tenant.country` o `US`. Nota clara sobre disponibilidad y regulación local (algunos países requieren address bundle en Twilio; si lo requiere, mostrar aviso "Este país requiere verificación adicional; contáctanos" y bloquear compra en esta fase).
2. **Tipo y prefijo** — `<Select>` Local / Mobile / Toll‑Free (según país). Input opcional de `areaCode` / prefijo.
3. **Elegir número** — llama a `tenant-provision-number` con `dryRun: true`, muestra hasta 20 opciones con capacidades y localidad. Selección obligatoria.
4. **Confirmar y comprar** — muestra número elegido, país, costo mensual estimado (texto informativo: "Twilio cobra ~$1/mes; consulta pricing.twilio.com"), y checkbox "Acepto el cobro recurrente". Botón "Comprar" llama `tenant-provision-number` con `dryRun: false`.
5. **Éxito** — muestra número asignado, toast, cierra wizard, refresca estado de integración. El siguiente wizard (WhatsApp o Voice) queda desbloqueado automáticamente.

### B.4 Sin cambios en flujos protegidos

No se tocan: `call-transfer`, `call-transfer-twiml`, `elevenlabs-actions-webhook`, `whatsapp-webhook`, `whatsapp-bot/*`, `twilio-send`, `twilio-setup`, `elevenlabs-twilio-setup`, ni sus mappings. El número comprado queda en `tenants.whatsapp_config.phone_number` — que ya es la fuente que consumen esos flujos hoy — más el `incoming_phone_sid` y (si aplica) `messaging_service_sid`.

---

## Cambios técnicos resumidos

**Archivos nuevos**
- `supabase/functions/tenant-provision-number/index.ts` — wrapper con gate de billing y ownership.
- `src/components/TenantNumberPurchaseWizard.tsx` — wizard de 4 pasos.
- `src/lib/twilio-countries.ts` — lista curada compartida (SuperAdmin + Tenant).

**Archivos editados (solo UI / params opcionales)**
- `supabase/functions/twilio-provision-number/index.ts` — aceptar `type` (`Local`|`Mobile`|`TollFree`, default `Local`) y `capabilities` opcionales. Defaults preservan comportamiento actual.
- `src/components/SuperAdminTenantsTab.tsx` — reemplazar input país por Select, agregar filtros de tipo/capacidad.
- `src/pages/IntegrationsPage.tsx` — montar `TenantNumberPurchaseWizard` cuando el tenant no tenga número.

**Sin migraciones de DB.** Se reutiliza `tenants.whatsapp_config` y `audit_events`.

**Config Supabase**: `supabase/config.toml` — declarar la nueva función `tenant-provision-number` con `verify_jwt = true` (valida en código además).

## Fuera de alcance (posibles fases siguientes)
- Portabilidad de números existentes (port-in).
- Address bundles / regulatory bundles automáticos para países que lo requieren.
- Cobro directo del costo del número al tenant vía Stripe (hoy lo asume la cuenta Twilio maestra y se factura por consumo, como ya está).
- Liberar/soltar números (release) desde UI.

