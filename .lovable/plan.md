
# Finanzas Inteligentes · Fase 2 — Plan

Extensión pura sobre la Fase 1 ya construida. No se toca Voz / WhatsApp / Recordatorios / Stripe SaaS / RLS existente / módulo de obra.

## Auditoría previa (lo que YA existe y se reutiliza)

- **Exportación existente**: la app hoy solo tiene `window.print()` en `SchemaDocsPage.tsx`. No hay `jspdf`, `xlsx`, `papaparse`, `exceljs` ni `pdf-lib`. → Se agrega la dependencia mínima viable, no se recrean tablas ni endpoints.
- **Financial state**: `useFinance.ts`, `useCFOAssistant.ts`, `cfo-ai`, `MockFinancialProvider`, tablas `financial_*`, `compute_tenant_financial_summary`, `compute_tenant_health_score`, `financial_cashflow_forecasts`.
- **Fuentes de conciliación**: tabla `expenses` (columnas amount / expense_date / description / paid_at ya existen) y `financial_transactions`.

## Confirmación de no-duplicación

- No se crean tablas nuevas para reportes (se generan on-demand desde datos ya existentes).
- Conciliación amplía columnas en `financial_transactions` (nuevas: `reconciliation_status`, `reconciled_with_expense_id`, `reconciled_at`, `reconciled_by`, `match_confidence`) — NO se crea tabla paralela.
- Escenarios reutilizan `financial_cashflow_forecasts` (columna `scenario` ya existe según Fase 1) + parámetros en `settings_json` del tenant o columna nueva `assumptions jsonb` en `financial_cashflow_forecasts`.
- Stubs de proveedores viven en `src/lib/finance/providers/*` (misma carpeta que Fase 1).

---

## 1. Reportes financieros (PDF + CSV)

**Librerías nuevas** (mínimas y probadas):
- `jspdf` + `jspdf-autotable` → PDF con tablas.
- CSV nativo (Blob + `text/csv`), abre directo en Excel/Numbers/Sheets. Sin dependencia extra.

**Archivos nuevos**:
- `src/lib/finance/reports/pdf.ts` — helper `renderFinancePdf({ tenantName, period, currency, title, sections })` con header estándar (tenant · periodo · moneda · fecha de generación) y footer con paginación.
- `src/lib/finance/reports/csv.ts` — helper `downloadCsv(filename, rows[])`.
- `src/components/finance/ReportExportMenu.tsx` — dropdown reutilizable "Exportar ▾ (PDF · CSV)".

**Archivos extendidos** (solo se agrega el botón + wiring, cero cambio de lógica):
- `src/pages/finance/FinanceDashboardPage.tsx` → Resumen financiero.
- `src/pages/finance/FinanceCashflowPage.tsx` → Estado de flujo de caja.
- `src/pages/finance/FinanceBudgetsPage.tsx` → Presupuesto vs real.
- `src/pages/finance/AgingPages.tsx` → AR y AP aging.
- `src/pages/finance/FinanceHealthPage.tsx` → Health Score.

Cada reporte incluye: nombre del tenant, periodo, moneda base, timestamp de generación.

## 2. Conciliación avanzada

**Migración (una sola, reversible)**:
```sql
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'unmatched'
    CHECK (reconciliation_status IN ('unmatched','suggested','auto_matched','manual_matched','duplicate','rejected')),
  ADD COLUMN IF NOT EXISTS reconciled_with_expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_confidence numeric(4,3);
CREATE INDEX IF NOT EXISTS idx_ft_recon ON public.financial_transactions(tenant_id, reconciliation_status);
```

**SQL function nueva** (SECURITY DEFINER, tenant-scoped):
- `suggest_transaction_matches(_tenant_id uuid, _lookback_days int default 60)` → devuelve sugerencias score = f(distancia_monto, distancia_dias, similitud_descripcion via `similarity()` de `pg_trgm` si existe, si no LIKE) con umbrales: `>=0.90` auto, `0.65-0.90` suggested, `<0.65` sin match.

**Archivos nuevos**:
- `src/pages/finance/FinanceReconciliationPage.tsx` — nueva sub-ruta `/finance/reconciliation` con tabs: Sugeridas / Sin conciliar / Conciliadas / Duplicados. Acciones: confirmar sugerencia, rechazar, conciliar manual (buscador de expenses), marcar duplicado. KPI de % conciliación por cuenta y periodo.
- `src/lib/finance/reconciliation.ts` — cliente de sugerencias + mutaciones.

**Archivos extendidos**:
- `src/pages/finance/FinanceLayout.tsx` → agregar item "Conciliación".
- `src/hooks/useFinance.ts` → `useReconciliationSuggestions`, `useConfirmMatch`, `useReconciliationRate`.

## 3. Escenarios what-if en forecast

**Migración**:
```sql
ALTER TABLE public.financial_cashflow_forecasts
  ADD COLUMN IF NOT EXISTS assumptions jsonb NOT NULL DEFAULT '{}'::jsonb;
```
(La columna `scenario` ya existe desde Fase 1.)

**Archivos extendidos**:
- `src/lib/finance/cashflow.ts` → `projectCashflow` acepta `{ revenueDelta, expenseDelta, collectionDelayDays }`.
- `src/pages/finance/FinanceCashflowPage.tsx` → panel de escenarios (Conservador / Base / Optimista / Personalizado con 3 sliders), gráfica Recharts con múltiples series superpuestas, selector de horizonte 7/30/60/90 días. Guardar escenario nombrado (persistencia opcional en `financial_cashflow_forecasts`).

## 4. Stubs de integraciones reales (sin activar)

**Archivos nuevos** en `src/lib/finance/providers/`:
- `belvo.ts` · `plaid.ts` · `finerio.ts` · `prometeo.ts` — cada uno implementa `FinancialDataProvider` con `available=false`, `requiredSecrets: string[]` (ej. Belvo: `BELVO_SECRET_ID`, `BELVO_SECRET_PASSWORD`), y cada método lanza `Error('provider_not_configured — solicitar credenciales')`.

**Archivos extendidos**:
- `src/lib/finance/providers/index.ts` → registrar los 4 stubs.
- `src/pages/finance/FinanceIntegrationsPage.tsx` → renderizar cada provider con badge amarillo **"Requiere credenciales"** y lista textual de qué secrets pedirá.

**NO se crean secrets ni se llaman APIs externas** en esta fase.

---

## Archivos tocados (resumen)

| Tipo | Ruta |
|---|---|
| Nuevo | `src/lib/finance/reports/pdf.ts` |
| Nuevo | `src/lib/finance/reports/csv.ts` |
| Nuevo | `src/lib/finance/reconciliation.ts` |
| Nuevo | `src/components/finance/ReportExportMenu.tsx` |
| Nuevo | `src/pages/finance/FinanceReconciliationPage.tsx` |
| Nuevo | `src/lib/finance/providers/{belvo,plaid,finerio,prometeo}.ts` |
| Extensión | `src/pages/finance/{FinanceDashboard,FinanceCashflow,FinanceBudgets,AgingPages,FinanceHealth,FinanceIntegrations,FinanceLayout}Page.tsx` |
| Extensión | `src/lib/finance/{cashflow,providers/index}.ts` |
| Extensión | `src/hooks/useFinance.ts` |
| Extensión | `src/App.tsx` (ruta `/finance/reconciliation`) |
| Migración | ALTER `financial_transactions` + ALTER `financial_cashflow_forecasts` + fn `suggest_transaction_matches` |
| Dependencias | `bun add jspdf jspdf-autotable` |

## Fuera de alcance (explícito)

- No se activa ninguna API bancaria real.
- No se toca Stripe SaaS, Voz, WhatsApp, Recordatorios, RLS ya validada, módulo de obra.
- No se crea segundo asistente de IA (el CFO AI actual sigue igual).

## Rollback (adelanto)

- **Migración**: `ALTER TABLE financial_transactions DROP COLUMN reconciliation_status, ...;` + `DROP FUNCTION suggest_transaction_matches;` + `ALTER TABLE financial_cashflow_forecasts DROP COLUMN assumptions;`.
- **Código**: eliminar archivos nuevos + revertir extensiones en los 7 archivos listados.
- **Deps**: `bun remove jspdf jspdf-autotable`.

Confirma para ejecutar Fase 2 completa.
