# Plan: Avance de Obra + Análisis Financiero de Obra

Dos módulos nuevos, aislados, sobre el módulo Proyectos existente. Todo respeta RLS multi-tenant (`tenant_id` + `has_tenant_role` + `project_members`) y el patrón de storage privado ya usado por `project-documents`.

---

## MÓDULO 1 · Avance de Obra (bitácora por proyecto)

### Base de datos (una migración reversible)

Nuevas tablas en `public`:

**`project_progress_entries`** — entrada de avance del empleado
- `id`, `tenant_id`, `project_id`, `author_user_id`, `author_name`
- `entry_date` (date), `comment` (text)
- `attachment_path` (text, ruta en bucket `project-documents`), `attachment_name`, `attachment_mime`
- `created_at`, `updated_at`

**`project_progress_observations`** — observación del supervisor ligada a la entrada
- `id`, `tenant_id`, `entry_id` (FK), `project_id`, `supervisor_user_id`, `supervisor_name`
- `observation` (text), `created_at`

GRANTs a `authenticated` + `service_role`. RLS:
- SELECT: miembros del proyecto (`project_members`) o `admin`/`owner` del tenant.
- INSERT entries: miembros del proyecto o admin/owner (autor = `auth.uid()`).
- INSERT observations: solo `admin`/`owner` del tenant.
- UPDATE/DELETE: autor propio o admin/owner.

Reutiliza el bucket privado **`project-documents`** ya existente (mismas policies de storage). Ruta: `progress/{tenant_id}/{project_id}/{uuid}-{filename}`.

### Frontend

- Nueva pestaña **"Avance de Obra"** dentro del detalle de proyecto en `src/pages/ProjectsPage.tsx` (junto a Documentos/Tareas).
- Componente `src/components/projects/ProjectProgressTab.tsx`:
  - Formulario: fecha, comentario, adjunto opcional (drag & drop, mismo helper que `ProjectDocumentsTab`).
  - Timeline cronológico descendente: autor + avatar, fecha, comentario, link/preview del adjunto, y debajo el bloque de observaciones del supervisor.
  - Si el usuario es admin/owner: input inline "Agregar observación" bajo cada entrada.
- Hook `useProjectProgress(projectId)` con Realtime opcional (canal por `project_id`).

### Notificación al supervisor (opcional, reusa infra existente)

Al insertar una entrada: trigger DB o llamada desde el frontend que inserta en `transfer_notifications` (in-app, ya usado) para cada admin/owner del tenant, y opcionalmente llama a `send-support-email` si el admin tiene email. Sin nueva infra.

---

## MÓDULO 2 · Análisis Financiero de Obra

### Extensión a `projects`

Migración añade columnas opcionales:
- `contract_amount` (numeric), `contract_currency` (text, default 'MXN')
- `estimated_duration_days` (int)
- `physical_progress_pct` (numeric 0–100, default 0)
- `target_margin_pct` (numeric, default 20)

`start_date` y `end_date` ya existen.

### Nuevas tablas

**`project_costs`**
- `id`, `tenant_id`, `project_id`, `category` (enum: `materials`, `labor`, `equipment`, `subcontracts`, `overhead`, `contingency`), `cost_type` (enum: `fixed`, `variable`)
- `amount` (numeric), `currency`, `cost_date` (date), `description`
- `attachment_path`, `attachment_name` (bucket `project-documents`, prefijo `costs/`)
- `created_by`, `created_at`, `updated_at`

**`project_financial_snapshots`** — historial de resúmenes IA y métricas
- `id`, `tenant_id`, `project_id`, `snapshot_at`
- `total_fixed`, `total_variable`, `total_cost`, `break_even_amount`, `break_even_progress_pct`
- `recommended_min_price`, `projected_profit`, `cost_performance_index`, `projected_overrun`
- `ai_summary` (text), `alerts` (jsonb), `trigger_source` (text)

GRANTs + RLS: SELECT/INSERT para miembros del proyecto o admin/owner; sólo owner/admin puede editar `contract_amount`/`target_margin_pct`.

### Cálculos (función SQL + edge function)

Función SQL `public.compute_project_financials(_project_id)` que devuelve un jsonb con:
- `total_fixed`, `total_variable`, `total_cost = SUM(amount)`
- `break_even_amount = total_fixed + total_variable`
- `break_even_progress_pct = break_even_amount / contract_amount * 100`
- `recommended_min_price = total_cost / (1 - target_margin_pct/100)`
- `projected_total_cost = physical_progress_pct > 0 ? total_cost / (physical_progress_pct/100) : total_cost`
- `cost_performance_index = (total_cost/contract_amount) / (physical_progress_pct/100)` con guard `physical_progress_pct > 0`
- `projected_overrun = projected_total_cost - contract_amount` (si > 0)
- `projected_profit = contract_amount - projected_total_cost`
- `alerts[]`: `overrun`, `break_even_reached`, `margin_below_target`

Se llama desde el frontend en tiempo real tras cada inserción/edición.

### Agente IA (resumen automático)

Nueva edge function **`project-financial-agent`** (patrón idéntico a `ai-assistant`/`ai-copilot`):
- Trigger: se invoca desde el frontend tras `INSERT` en `project_costs` o cambio de `physical_progress_pct`.
- Recibe `project_id`, valida JWT + membership, ejecuta `compute_project_financials`, arma prompt con datos del proyecto y llama a `google/gemini-2.5-flash` vía Lovable AI Gateway.
- Persiste el resumen en `project_financial_snapshots` con métricas + `ai_summary`.
- Devuelve el snapshot al frontend para render inmediato.

### Frontend

Nueva pestaña **"Análisis Financiero"** dentro del detalle de proyecto (solo visible para admin/owner y miembros con permiso, controlado en UI y RLS).

Componentes:
- `src/pages/projects/ProjectFinancialsTab.tsx` (contenedor)
- `CostEntryForm.tsx`: categoría, tipo fijo/variable, monto, fecha, descripción, adjunto opcional.
- `CostsTable.tsx`: lista filtrable por categoría.
- `FinancialsDashboard.tsx`:
  - Tarjetas: Costo total, Punto de equilibrio (monto + %), Precio mínimo recomendado, Utilidad proyectada, CPI.
  - Alertas activas (badges rojas/amarillas).
  - Gráfica (Recharts, ya en el proyecto): línea de costo acumulado vs línea de presupuesto vs línea de % avance en el tiempo, agregando por `cost_date`.
- `AISummaryTimeline.tsx`: historial de `project_financial_snapshots` con resúmenes IA.

Hook `useProjectFinancials(projectId)`:
- Carga costos, avance, snapshot más reciente.
- Tras insertar costo o actualizar avance: recompute local + POST a `project-financial-agent`.
- Suscripción Realtime a `project_costs` y `project_financial_snapshots`.

### Seguridad / RLS

- Todas las tablas nuevas: `tenant_id NOT NULL`, políticas `USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner') OR has_tenant_role(..., 'admin') OR EXISTS project_members)`.
- Edge function valida JWT + verifica que el `auth.uid()` pertenece al `tenant_id` del `project_id` antes de ejecutar el agente IA (mismo patrón que `ai-assistant`).
- Storage: mismo bucket privado `project-documents`, rutas prefijadas `progress/` y `costs/`, policies existentes ya validan `tenant_id` en la ruta.

---

## Detalles técnicos

- Migración 1: tablas de avance + RLS + realtime publication.
- Migración 2: columnas nuevas en `projects` + tablas financieras + función `compute_project_financials` + RLS + realtime.
- Sin tocar módulos existentes: Voz, WhatsApp, Recordatorios, Stripe, Auth. Solo se agregan pestañas dentro de `ProjectsPage`.
- Frontend usa hooks nuevos aislados; no modifica `useProjectsPersistence.ts` salvo un pequeño getter para `physical_progress_pct` y `contract_amount`.
- Todos los montos en `numeric(14,2)`; moneda por proyecto (default MXN, respetando infra multi-currency existente).

## Rollback

- `DROP TABLE` de las 4 tablas nuevas y `DROP FUNCTION compute_project_financials`.
- `ALTER TABLE projects DROP COLUMN` de las 4 columnas añadidas.
- Eliminar `project-financial-agent` y los componentes/pestañas nuevas. Ningún cambio destructivo en tablas existentes.
