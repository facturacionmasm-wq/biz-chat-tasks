# Sistema de Atención Prioritaria a Cliente

Módulo integral de soporte con escalamiento humano, SLAs, contactos VIP y tickets, operando sobre WhatsApp y un nuevo canal de Chat Interno **Tenant ↔ Super Admin**.

---

## 1. Escalamiento humano en vivo (WhatsApp + Voz)

Aria detecta automáticamente cuándo pasar de bot a humano y crea un **ticket** con contexto completo.

**Triggers de escalamiento:**
- Cliente pide explícito: "hablar con persona", "asesor", "humano", "manager".
- Sentimiento negativo detectado por IA (frustración, enojo, amenaza de cancelar).
- Palabras clave de urgencia: "urgente", "emergencia", "reclamo", "queja", "demanda".
- Aria no puede resolver después de N intentos (configurable, default 3).
- Cliente marcado como VIP (ver punto 3) — escala siempre.

**Comportamiento:**
- Aria pausa respuestas automáticas para ese contacto.
- Crea ticket con prioridad calculada (ver punto 2).
- Notifica al owner/admin del tenant vía WhatsApp + push + campana in-app.
- Muestra al usuario un mensaje: "Un asesor humano te contactará en breve".

---

## 2. Bandeja prioritaria con SLA

Nueva página **`/support`** (Centro de Soporte) tipo inbox con tickets ordenados por prioridad y SLA.

**Cálculo de prioridad (auto):**
- `urgent` (rojo) — VIP + urgencia detectada, o SLA vencido.
- `high` (naranja) — VIP normal, o sentimiento negativo.
- `normal` (azul) — escalamiento estándar.
- `low` (gris) — consultas sin urgencia.

**SLA por prioridad (configurable por tenant):**
- Urgent: 15 min primera respuesta / 1 h resolución.
- High: 1 h / 4 h.
- Normal: 4 h / 24 h.
- Low: 24 h / 72 h.

**Alertas automáticas:**
- 75% del SLA restante → notificación amarilla al asignado.
- SLA vencido → escalamiento automático al owner + prioridad sube a `urgent`.
- Cron corriendo cada 5 min revisa SLAs.

---

## 3. Contactos VIP

Extensión de la tabla `contacts` con:
- `is_vip` (bool)
- `vip_tier` (`gold`, `platinum`, `diamond`)
- `vip_notes` (contexto para el asesor)

**Comportamiento:**
- Aria detecta VIP en cada mensaje y ajusta tono ("Estimado cliente premium…").
- Cualquier interacción de un VIP crea ticket `high` mínimo.
- Notificación inmediata al owner en cada mensaje entrante VIP.
- Badge dorado en la Inbox Omnicanal, agenda y llamadas.

**UI:** botón "Marcar como VIP" en la ficha de contacto + gestión desde `/contacts`.

---

## 5. Módulo de tickets

Nueva tabla `support_tickets` que centraliza todo.

**Campos clave:**
- `id`, `tenant_id`, `contact_id`, `channel` (`whatsapp`, `voice`, `internal_chat`, `manual`)
- `subject`, `description`, `priority`, `status` (`open`, `assigned`, `in_progress`, `waiting_customer`, `resolved`, `closed`)
- `assigned_to` (user_id), `created_by`
- `sla_first_response_at`, `sla_resolution_at`, `first_response_at`, `resolved_at`
- `source_conversation_id`, `source_call_id` — enlaza al hilo original
- `ai_summary` — resumen generado por Aria del problema
- `tags[]`, `sentiment_score`

**Vistas:**
- Lista con filtros (estado, prioridad, canal, asignado, VIP).
- Detalle: hilo completo (WhatsApp + notas internas + acciones), timeline SLA, botones (Asignar / Cambiar prioridad / Resolver / Cerrar / Reasignar).
- Kanban opcional por estado.

**Métricas:** dashboard con tiempo promedio de respuesta, cumplimiento SLA, tickets por asesor, distribución de prioridad.

---

## Canal nuevo: Chat interno Tenant ↔ Super Admin

Extensión del chat interno para que **cada tenant tenga un canal directo con el equipo Super Admin de la plataforma** (soporte a la empresa, no al cliente final).

**Características:**
- Canal automático `tenant-support:<tenant_id>` creado al registrar cada tenant.
- Owner/admin del tenant puede escribir; Super Admin ve todos los canales en un panel unificado.
- Realtime bidireccional (Supabase Realtime).
- Adjuntos (screenshots, docs).
- Estado del canal (abierto / esperando respuesta / resuelto).
- Notificación al Super Admin (push + email) cuando llega mensaje.
- Marcado como ticket interno también con prioridad y SLA.

**UI Super Admin:** nueva pestaña **"Soporte a Tenants"** en `/super-admin` con lista de canales, badge de no leídos, filtro por prioridad.

**UI Tenant:** botón flotante "Contactar soporte de la plataforma" en Settings + entrada dedicada en el sidebar.

---

## Detalles técnicos

**Base de datos (nueva migración):**
- `support_tickets` (con RLS por tenant + GRANTs).
- `ticket_events` (audit: cambios de estado, asignación, notas internas).
- `ticket_messages` (hilo unificado — puede referenciar `whatsapp_messages` o ser mensaje directo).
- `sla_configs` por tenant.
- `platform_support_channels` (canal tenant ↔ super admin).
- `platform_support_messages`.
- Extensión `contacts`: `is_vip`, `vip_tier`, `vip_notes`.
- Realtime habilitado en `support_tickets`, `ticket_messages`, `platform_support_messages`.

**Edge Functions nuevas:**
- `support-ticket-manager` — CRUD + asignación + cambio de estado.
- `sla-monitor` (cron cada 5 min) — evalúa SLAs, alertas, escalamientos.
- `escalation-detector` — endpoint interno que Aria (WhatsApp/Voz) invoca al detectar triggers.
- `platform-support` — mensajería tenant ↔ super admin.

**Modificaciones en Aria:**
- `whatsapp-bot/ai-response.ts`: análisis de sentimiento + detección de triggers después de cada mensaje.
- Nueva tool `escalate_to_human(reason, priority_hint)` en `whatsapp-bot/tools.ts` que Aria puede invocar.
- Pausa de auto-respuestas cuando ticket está `assigned` o `in_progress`.

**Frontend nuevo:**
- `/support` — Centro de Soporte (tickets del tenant).
- `/super-admin` nueva tab "Soporte a Tenants".
- Componente `TicketDetail` con hilo unificado, notas internas, timeline SLA.
- `VipBadge`, `PriorityBadge`, `SlaCountdown` reutilizables.
- Sección de Settings: configuración de SLAs + reglas de escalamiento.
- Modal "Marcar como VIP" en fichas de contacto.
- Badge de tickets pendientes en `BottomNav` y `AppSidebar`.

**Notificaciones:**
- Push + campana in-app + WhatsApp (usa infraestructura existente `notifications`).
- Templates: "Nuevo ticket urgente", "SLA por vencer", "Mensaje de super admin".

---

## Orden de implementación sugerido

1. Migración: tablas nuevas + extensión `contacts` + Realtime + GRANTs + RLS.
2. Edge function `support-ticket-manager` + `escalation-detector`.
3. Modificaciones en Aria WhatsApp (detección + tool escalate + pausa).
4. Frontend `/support` (lista + detalle).
5. Contactos VIP (UI + integración con Aria).
6. Cron `sla-monitor` + alertas.
7. Canal Tenant ↔ Super Admin (backend + UI ambos lados).
8. Configuración de SLAs en Settings.
9. Métricas y dashboard de soporte.

---

## Fuera de alcance (para confirmar)

- Llamadas de voz salientes desde el ticket (por ahora solo referencia).
- Integración con Zendesk/Intercom externos.
- Base de conocimiento pública (FAQ auto-servicio).
- SLA por horario laboral (por ahora 24/7 con offset simple).

¿Confirmamos este alcance para comenzar? Es un módulo grande; se puede entregar en 2-3 iteraciones si prefieres ver progreso parcial antes.