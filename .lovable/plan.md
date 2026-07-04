
# Traer Tu Propio Número (BYON) — Meta + Twilio

Ampliación **no destructiva** del módulo de Integraciones. Convivirá con el wizard actual de compra de número (Fase anterior) y con los caminos Meta/Twilio del wizard de WhatsApp. Cero cambios en `whatsapp-*`, `twilio-*`, `elevenlabs-*`, `call-transfer*`.

## Qué verá el tenant

Nueva pestaña **"Mi Número"** dentro de `IntegrationsPage` (junto a WhatsApp, Voz, Google, etc.), con dos secciones:

**A) "Ya tengo un número y quiero usarlo"** — 4 opciones en tarjetas comparativas:

| Opción | Sirve para | Recibe | Envía | Tiempo | Costo | Países |
|---|---|---|---|---|---|---|
| **WhatsApp con mi celular (Meta)** | Aria por WhatsApp | Sí | Sí | 5–10 min (auto) | Gratis (plan Meta) | MX / US / CA / global |
| **Verified Caller ID (Twilio)** | Mostrar mi número como remitente saliente | No | Sí (SMS/voz salientes) | 2–5 min (auto) | Gratis | MX / US / CA |
| **Hosted SMS (Twilio)** | Recibir/enviar SMS conservando la operadora | Sí (SMS) | Sí (SMS) | 5–15 días hábiles | Setup Twilio + mensual | US / CA (MX no soportado por Twilio) |
| **Portabilidad total (Port-in)** | Voz + SMS + Agente IA con el mismo número | Sí | Sí | 2–4 semanas | Setup + mensual | US / CA (MX caso a caso) |

**B) "Prefiero comprar uno nuevo"** — CTA al wizard de compra ya existente (`TenantNumberPurchaseWizard`), sin cambios.

Cada tarjeta explica: qué obtiene, qué NO obtiene, cuánto tarda, y **requisitos** (ej. LOA + factura reciente del carrier para Hosted/Port-in).

## Flujos por opción

### 1) Meta WhatsApp (100% automático, ya existe)
- Botón "Vincular mi celular con WhatsApp" → abre el `WhatsAppConnectionWizard` en modo **Meta** (ya implementado). Solo agregamos copy y el atajo desde esta pestaña.
- Sin cambios en edge functions.

### 2) Verified Caller ID (automático vía Twilio API)
- Wizard de 3 pasos: capturar número E.164 → Twilio genera código de 6 dígitos → el tenant responde con el código recibido por SMS/llamada.
- Nueva edge function `twilio-verify-caller-id` (JWT protegida) con dos acciones:
  - `start`: `POST /OutgoingCallerIds/... /ValidationRequests.json` vía gateway Twilio (usa `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` ya existentes).
  - `confirm`: consulta estado y persiste el número en `tenants.settings_json.verified_caller_ids[]`.
- Registra `audit_events` con `event_type = 'byon_verified_caller_id'`.

### 3) Hosted SMS y 4) Port-in (semi-automático, requieren papeleo)
Twilio no automatiza esto por API pública sin cuenta enterprise. Implementamos como **solicitud a soporte**:
- Formulario con: número, país, carrier actual, capacidades deseadas (SMS/Voz), 3 uploads (foto de factura reciente + LOA firmada + INE/ID del titular) al bucket **nuevo** `byon-requests` (privado, RLS por tenant).
- Se guarda en tabla **nueva** `byon_requests` (status: `pending → in_review → approved → completed | rejected`).
- Notificación al super_admin (usa el sistema de notificaciones existente).
- El super_admin gestiona el trámite manualmente en la consola de Twilio y actualiza el `status` desde el `SuperAdminTenantsTab` (nueva sub-tarjeta "Solicitudes BYON").
- Cuando el super_admin marca `completed`, el número queda disponible en `tenants.whatsapp_config.phone_number` / `tenant_phone_numbers` (mismos campos que consume hoy el Voice Agent y WhatsApp — no rompe nada).

## Detalles técnicos

### Nuevos archivos
- `src/pages/BringYourOwnNumberTab.tsx` — tarjetas comparativas + routers a cada sub-flujo.
- `src/components/byon/VerifiedCallerIdWizard.tsx`
- `src/components/byon/HostedNumberRequestForm.tsx` (reusado para Port-in con `type` param)
- `src/components/byon/ByonRequestsList.tsx` (historial del tenant)
- `src/components/SuperAdminByonRequests.tsx` (panel super_admin)
- `src/lib/byon-options.ts` — copy, tiempos y países por opción.
- `supabase/functions/twilio-verify-caller-id/index.ts` (JWT verificado)
- `supabase/functions/byon-request/index.ts` — crea solicitud + sube documentos (JWT).
- `supabase/functions/byon-request-admin/index.ts` — super_admin actualiza status (JWT + role check).

### Editados (mínimos, solo montar entradas)
- `src/pages/IntegrationsPage.tsx` — nueva pestaña "Mi Número".
- `src/components/SuperAdminTenantsTab.tsx` — sub-tab "Solicitudes BYON".
- `supabase/config.toml` — declarar las 3 funciones nuevas con `verify_jwt = true`.

### Migración de base de datos (una sola)
```text
CREATE TABLE public.byon_requests (
  id uuid PK,
  tenant_id uuid FK tenants,
  requested_by uuid FK auth.users,
  request_type text CHECK IN ('hosted_sms','port_in'),
  phone_number text (E.164),
  country_code text,
  current_carrier text,
  desired_capabilities jsonb, -- {sms,voice,mms}
  documents jsonb,            -- [{type,storage_path}]
  status text CHECK IN ('pending','in_review','approved','completed','rejected'),
  admin_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at, updated_at
)
+ GRANTs (authenticated + service_role)
+ RLS: tenant lee sus propias solicitudes; super_admin ve todas
+ trigger updated_at
+ storage bucket 'byon-requests' privado con policies por tenant_id
+ audit_events triggers
```

### Impacto en flujos existentes
- **Voice Agent / WhatsApp**: leen `tenants.whatsapp_config.phone_number` y `tenant_phone_numbers` como hoy. Solo cambia **el origen** del número (comprado / Meta / hosted / portado); el consumo es idéntico.
- **Billing gate**: aplica igual — el número debe estar bajo un tenant con `active|trialing`.
- **`twilio-provision-number` y `tenant-provision-number`**: sin cambios.

## Fuera de alcance
- Automatización real de Hosted/Port-in (Twilio no lo permite sin BAA/enterprise).
- Portabilidad de números MX (Twilio no ofrece portabilidad self-service en MX; se ofrece solo como "consultar disponibilidad" y queda en manos de super_admin).
- Cobro adicional en Stripe por el número portado (se gestionará después con la infraestructura de packages existente).
