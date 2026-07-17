# Finanzas Inteligentes — Fase 1 (nivel tenant/empresa)

Capa financiera **a nivel empresa** que convive con el módulo de obra ya existente. No reemplaza `project_costs` / `project_financial_snapshots` / `project-financial-agent` — los consume como una fuente más para el consolidado del tenant.

---

## FASE 0 · Mapa de la app (auditoría real)

**Stack**: React 18 + TS + Vite, TailwindCSS con tokens `--rx-*`, shadcn/ui, TanStack Query, react-router-dom, Recharts, Supabase (Lovable Cloud) con RLS multi-tenant.

**Navegación**: `BottomNav` (mobile-first) + `CommandPalette` (Cmd+K). NO hay `AppSidebar` de shadcn en uso general — la navegación principal es la bottom bar y el command palette. Rutas centralizadas en `src/App.tsx` con `AppLayout`.

**Multi-tenant**: `tenants` + `profiles.tenant_id` + `user_roles(user_id, tenant_id, role)` con helpers `has_tenant_role(uid, tid, role)`, `get_user_tenant_id(uid)`, `is_project_member(uid, pid)`. Roles: `super_admin > owner > admin > staff > partner > guest`.

**Tablas existentes reutilizables (NO se duplican)**:
- `tenants`, `profiles`, `user_roles` — identidad y multi-tenant.
- `contacts` (15 col) — cumple rol de clientes/proveedores. **Se reutiliza** para AR/AP.
- `expenses` (32 col: `type` expense/budget, `category`, `amount`, `currency`, `status`, `vendor_name`, `payment_method`, `document_*_drive_url`) — cubre gastos y presupuestos ya validados con aprobación. **Se reutiliza como fuente para consolidado**, NO se recrea.
- `projects`, `project_costs`, `project_financial_snapshots`, `compute_project_financials` — módulo de obra. **Se consumen agregados**, no se replican.
- `appointments` — no aplica directamente.
- `tenant_subscriptions`, `stripe_customers`, `subscription_plans` — billing SaaS interno, no negocio del cliente.
- `transfer_notifications` — canal de alertas in-app ya usado. **Se reutiliza** para alertas financieras.
- `audit_events` — auditoría existente. **Se reutiliza**.
- `fx_rates` (7 col) — tipos de cambio ya disponibles.
- `background_jobs` — patrón asíncrono ya usado.
- Storage: bucket privado `project-documents` con rutas por tenant. **Se reutiliza** con prefijo `finance/`.

**IA existente**: `ai-assistant`, `ai-copilot`, `project-financial-agent` (patrón: JWT + membership + Lovable AI Gateway con `google/gemini-2.5-flash`). **Se reutiliza el patrón**, NO se crea otro asistente.

---

## Tablas realmente nuevas (mínimas, sin equivalente previo)

| Tabla | Justificación (por qué no reutilizar algo existente) |
|---|---|
| `financial_accounts` | No existe concepto de "cuenta bancaria/tarjeta/procesador" a nivel tenant. `expenses.payment_method` es solo un texto libre. |
| `financial_connections` | Estado de integraciones bancarias (mock en Fase 1, Belvo/Plaid en futuro). No existe. |
| `financial_transactions` | Movimientos crudos por cuenta (distintos de `expenses` que ya tienen semántica de aprobación/documento). Se relaciona 1:N con `expenses` vía `reconciled_expense_id` para conciliación. |
| `financial_categories` | Catálogo por tenant (independiente de `expenses.category` que es texto libre). |
| `financial_budgets` + `financial_budget_lines` | Presupuestos generales por categoría/período. Distinto a `expenses.type='budget'` (que es un documento individual). |
| `financial_cashflow_forecasts` | Snapshots de pronóstico 7/30/60/90d. |
| `financial_health_scores` | Snapshots del score 0-100 por tenant con desglose. |
| `financial_alerts` | Metadata de alertas (razón, umbral, cuenta). El disparo al usuario va por `transfer_notifications` existente. |

**NO se crean**: tabla de clientes, de proveedores, de facturas emitidas, de pagos, de gastos, de proyectos, de sub-costos. Todo eso ya existe.

## Reutilizadas explícitamente

- Clientes/Proveedores → `contacts` (se agregan sólo columnas opcionales `is_customer`, `is_supplier`, `payment_terms_days` si faltan; sin romper nada).
- Gastos → `expenses` (fuente para AP y consolidado).
- Costos de obra → `project_costs` + `project_financial_snapshots` (fuente agregada para el dashboard tenant).
- Alertas → `transfer_notifications`.
- Auditoría → `audit_events`.
- Storage → `project-documents` con prefijo `finance/{tenant_id}/...`.
- FX → `fx_rates`.

---

## Arquitectura

**Capa de abstracción**: `src/lib/finance/providers/`
- `FinancialDataProvider` (interfaz TS con los 8 métodos pedidos).
- `MockFinancialProvider` (único adaptador real en Fase 1, con datos deterministas por tenant).
- Stubs vacíos: `BelvoProvider`, `PlaidProvider`, `FinerioProvider`, `PrometeoProvider` (throw "not implemented").
- Registry `getFinancialProvider(providerId)` para futura selección.

**Servicios**:
- `src/lib/finance/aggregator.ts` — consolida saldos, ingresos/gastos, AR/AP, runway a partir de `financial_accounts` + `financial_transactions` + `expenses` + `project_financial_snapshots`.
- `src/lib/finance/health-score.ts` — cálculo 0-100 (liquidez 25 + flujo 25 + morosidad 25 + presupuesto 25).
- `src/lib/finance/cashflow.ts` — forecast simple 7/30/60/90d.

**Edge function nueva**: `supabase/functions/cfo-ai/index.ts`
- Mismo patrón que `project-financial-agent`: valida JWT, resuelve tenant del usuario, llama `FinancialAIContextService` para armar contexto agregado y acotado (nunca dump completo), invoca Lovable AI Gateway con `google/gemini-2.5-flash`.
- Persiste conversación en tabla existente si aplica o devuelve stream.

**Nuevas funciones SQL (SECURITY DEFINER, patrón existente)**:
- `compute_tenant_financial_summary(_tenant_id, _period_start, _period_end, _currency)` → jsonb con saldo, ingresos, gastos, neto, AR, AP, runway.
- `compute_tenant_health_score(_tenant_id)` → jsonb con score + desglose.

---

## Frontend (archivos nuevos y tocados)

**Nuevos**:
- `src/pages/finance/FinanceLayout.tsx` — layout con sub-tabs internos (usa mismos componentes shadcn Tabs / botones tipo pill de la app).
- `src/pages/finance/FinanceDashboardPage.tsx` — KPIs + Recharts (mismo estilo de `ProjectFinancialsTab`).
- `src/pages/finance/FinanceAccountsPage.tsx` — grid de `financial_accounts` con estado + acciones (mock).
- `src/pages/finance/FinanceTransactionsPage.tsx` — tabla con filtros (mismo patrón que `ExpensesPage`).
- `src/pages/finance/FinanceReceivablesPage.tsx` + `FinancePayablesPage.tsx` — aging report (0 / 1-30 / 31-60 / 61-90 / +90).
- `src/pages/finance/FinanceBudgetsPage.tsx` — presupuestos vs real.
- `src/pages/finance/FinanceCashflowPage.tsx` — forecast Recharts.
- `src/pages/finance/FinanceHealthPage.tsx` — gauge 0-100 + desglose.
- `src/pages/finance/CFOAssistantPage.tsx` — chat (reutiliza estilo `AIAssistantWidget`).
- `src/pages/finance/FinanceIntegrationsPage.tsx` — listado de proveedores con badge "Próximamente" salvo Mock.
- Hooks: `useFinancialAccounts`, `useFinancialTransactions`, `useFinancialSummary`, `useFinancialBudgets`, `useCashflowForecast`, `useHealthScore`, `useCFOAssistant`.

**Tocados** (mínimo, sin romper):
- `src/App.tsx` — agrega ruta `/finance/*` con `<P>` (misma protección) y sub-rutas.
- `src/components/BottomNav.tsx` — agrega entrada "Finanzas" (icono Wallet) al menú secundario.
- `src/components/CommandPalette.tsx` — agrega comandos de acceso rápido a sub-módulos.

Sub-módulos con etiqueta **"Próximamente"** en Fase 1: integraciones reales (Belvo/Plaid/Finerio/Prometeo), exportación PDF/Excel, reglas avanzadas de conciliación, escenarios what-if.

---

## Seguridad

- Toda tabla nueva: `tenant_id uuid NOT NULL`, RLS habilitada, GRANTs a `authenticated` + `service_role`.
- Policies: `USING (has_tenant_role(auth.uid(), tenant_id, 'owner') OR has_tenant_role(auth.uid(), tenant_id, 'admin'))` para escritura; SELECT también permite `staff`. Nunca `anon`.
- `financial_connections.credentials_encrypted` (texto cifrado server-side, jamás expuesto al cliente). En Fase 1 vacío (mock).
- Auditoría: cada `connect/disconnect/refresh/budget_change/manual_payment_approve` → `audit_events`.
- Edge function `cfo-ai`: valida JWT, resuelve `tenant_id` server-side, ignora cualquier `tenant_id` del body.

## Datos demo

- Detecta tenant demo por convención (`tenants.settings_json->>'is_demo' = 'true'`; si no existe, no siembra).
- Seed: 3 cuentas (banco MXN, banco USD, tarjeta), 60 transacciones aleatorias en 90 días, 5 categorías, 2 presupuestos, 3 alertas de ejemplo.
- Nunca escribe fuera del tenant demo.

---

## Migraciones (una sola, reversible)

1. `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_customer bool, is_supplier bool, payment_terms_days int;`
2. `CREATE TABLE` de las 9 nuevas + GRANTs + `ENABLE RLS` + policies + índices `(tenant_id, ...)`.
3. Funciones `compute_tenant_financial_summary` y `compute_tenant_health_score`.
4. Trigger `updated_at` en cada tabla nueva (reutiliza `public.update_updated_at_column()`).

## Rollback exacto

- `DROP FUNCTION compute_tenant_financial_summary, compute_tenant_health_score;`
- `DROP TABLE financial_alerts, financial_health_scores, financial_cashflow_forecasts, financial_budget_lines, financial_budgets, financial_categories, financial_transactions, financial_connections, financial_accounts CASCADE;`
- `ALTER TABLE contacts DROP COLUMN is_customer, DROP COLUMN is_supplier, DROP COLUMN payment_terms_days;`
- `rm -rf supabase/functions/cfo-ai src/pages/finance src/lib/finance src/hooks/useFinancial*.ts src/hooks/useCFOAssistant.ts src/hooks/useCashflowForecast.ts src/hooks/useHealthScore.ts`
- Revertir bloques agregados en `src/App.tsx`, `BottomNav.tsx`, `CommandPalette.tsx` (agregados marcados con `// [finance-fase1]`).

## Verificación al terminar (mismo formato que fases anteriores)

Veredicto SÍ/NO ítem por ítem:
1. Sin duplicación con módulo de obra.
2. `contacts` reutilizado para AR/AP.
3. `expenses` reutilizado para consolidado / AP source.
4. Navegación agregada sin romper BottomNav / CommandPalette.
5. RLS multi-tenant en las 9 tablas nuevas.
6. Mock provider funcional; adaptadores reales como stubs.
7. Dashboard renderiza con datos demo.
8. Aging report 0/1-30/31-60/61-90/+90 activo.
9. Forecast 7/30/60/90d activo.
10. Health Score 0-100 con desglose activo.
11. CFO AI responde solo con contexto del `tenant_id` del JWT.
12. Alertas insertadas en `transfer_notifications` existente.
13. Auditoría en `audit_events` para acciones sensibles.
14. `tsgo --noEmit` limpio.

## Fuera de alcance (queda para Fase 2+)

Integraciones bancarias reales, exportación PDF/Excel, reglas ML de categorización, escenarios what-if, aprobaciones multi-nivel de pagos, conciliación automática avanzada. Voz / WhatsApp / Recordatorios / Stripe SaaS / RLS existente no se tocan.
