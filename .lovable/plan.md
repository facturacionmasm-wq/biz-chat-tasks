
# Finanzas Inteligentes · Fase 4 (corregida) — Plan

Extensión sobre Fase 1-3. NO se toca Voz / WhatsApp / Recordatorios / Stripe SaaS / RLS ya endurecida / obra / stubs actuales de Fase 3. Cuatro puntos exactos:

## 1. Alertas financieras proactivas (cron)

**Edge Function nueva** `supabase/functions/financial-alerts-scan/index.ts`:
- Sin JWT (cron interno). Valida header `x-cron-secret` contra `CRON_SHARED_SECRET`. Si no existe todavía, se solicita vía `add_secret`.
- Itera tenants activos (no bloqueados). Por cada tenant llama `compute_tenant_financial_summary` + `compute_tenant_health_score` y evalúa:
  - `runway_days < 30` → alerta `low_runway`, severity `high`.
  - Cualquier `financial_accounts.current_balance < 0` (no oculta) → `overdraft`, severity `critical`.
  - `financial_budgets` con gasto real > 90% del planeado (JOIN `financial_budget_lines` + `financial_transactions` del periodo) → `budget_overrun`, severity `medium`.
  - `expenses` con `paid_at IS NULL` y `expense_date < now() - 30d` → `overdue_payable`, severity `medium` (agrega monto total y conteo).
- Inserta en `financial_alerts` existente con **dedupe**: no crear si ya existe una `active` del mismo `alert_type` en las últimas 24h.
- Notifica al owner del tenant vía `internal_messages` + email Resend (`no-reply@rybixholding.com`) reutilizando helper. Como el helper hoy vive incrustado en `send-reminders`, se **extrae a `supabase/functions/_shared/notify-admin.ts`** (refactor no-op; `send-reminders` sigue funcionando idéntico importando desde ahí).

**Cron**: `pg_cron` cada 30 min invocando la function con `x-cron-secret`.

**Frontend**:
- `FinanceDashboardPage.tsx` → banner de `financial_alerts` activas con botón "Reconocer" (`status='acknowledged'`).
- Nuevo hook `useFinanceAlerts` en `useFinance.ts` si aún no existe.

## 2. Briefing semanal del CFO AI

**Extracción no-op**: mover `buildFinancialContext` de `cfo-ai/index.ts` a `supabase/functions/_shared/cfo-context.ts` sin cambiar comportamiento.

**Edge Function nueva** `supabase/functions/cfo-ai-weekly-briefing/index.ts`:
- Cron dominical 08:00 en `America/Mexico_City` (para v1; iteraciones posteriores pueden respetar tz por tenant).
- Reutiliza `buildFinancialContext` + Lovable AI Gateway `google/gemini-2.5-flash`.
- Prompt fijo: "Redacta briefing ejecutivo semanal (máx 6 bullets) en español: saldo consolidado, flujo neto, top 3 gastos, alertas activas, runway, recomendación concreta."
- Persiste en tabla nueva `cfo_ai_briefings(id, tenant_id, week_start, summary, context_snapshot jsonb, created_at)` con RLS tenant-scoped.
- Envía email al owner con el briefing.

**Frontend**:
- `CFOAssistantPage.tsx` → panel lateral "Briefings anteriores" con historial (últimos 8).

**Migración**:
```sql
CREATE TABLE public.cfo_ai_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  summary text NOT NULL,
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, week_start)
);
GRANT SELECT ON public.cfo_ai_briefings TO authenticated;
GRANT ALL ON public.cfo_ai_briefings TO service_role;
ALTER TABLE public.cfo_ai_briefings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant members read briefings" ON public.cfo_ai_briefings
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));
```

## 3. Adaptadores REALES de Belvo, Finerio y Prometeo (código listo, NO activados)

Mismo patrón que Plaid en Fase 3: adaptador en `_shared/finance-providers.ts` + wiring en `financial-connection-init` / `-callback` / `-disconnect`. Cada proveedor detecta ausencia de secrets y devuelve `configured: false` (idéntico a Plaid hoy). Endpoints y flujos tomados de la documentación oficial pública vigente; cualquier ambigüedad se marca con comentario `// TODO(<provider>): <duda concreta>` y el adaptador cae al camino seguro.

### 3.1 Belvo
- Docs base: `https://developers.belvo.com/`. Base API: `https://api.belvo.com` (sandbox: `https://sandbox.belvo.com`).
- **Init**: `POST /api/token/` con Basic Auth (`BELVO_SECRET_ID:BELVO_SECRET_PASSWORD`) para obtener `access` widget token; devuelve `{ configured:true, provider:'belvo', widget_token, widget_url:'https://widget.belvo.io' }`.
- **Callback (link_id)**: el widget devuelve `link_id` al frontend. Backend hace `GET /api/accounts/?link=<link_id>` para hidratar cuentas, encripta `link_id` con `CREDENTIALS_ENCRYPTION_KEY` (AES-GCM), upsert en `financial_connections` (`external_item_id=link_id`, `provider='belvo'`).
- **Sync**: `GET /api/accounts/?link=` + `POST /api/transactions/` con `link`, `date_from`, `date_to` (paginado con `next`).
- **Disconnect**: `DELETE /api/links/{link_id}/`.
- Secrets esperados: `BELVO_SECRET_ID`, `BELVO_SECRET_PASSWORD`, `BELVO_ENV` (`sandbox`|`production`).
- Webhook opcional: `POST` al futuro `belvo-webhook` (fuera de esta fase; sólo se anota `// TODO(belvo): webhook signing header exact name`).

### 3.2 Finerio Connect
- Docs base: `https://finerioconnect.com/docs/` (Finerio Connect API). Base: `https://api.finerioconnect.com/v2`.
- Auth: `Authorization: Bearer <FINERIO_API_KEY>` en cada request.
- **Init**: `POST /users` (crea/reutiliza customer, idempotente por `customerId=tenant_id`) → luego `POST /widget-tokens` para obtener token del widget. Devuelve `{ configured, provider:'finerio', widget_token, widget_url:'https://widget.finerioconnect.com' }`.
- **Callback (credential_id)**: el widget devuelve `credentialId`. Backend `GET /accounts?customerId=...` para listar, encripta `credentialId`, upsert.
- **Sync**: `GET /accounts` + `GET /transactions?accountId=...&dateFrom=&dateTo=` con paginación.
- **Disconnect**: `DELETE /credentials/{credentialId}`.
- Secrets: `FINERIO_API_KEY`, `FINERIO_ENV` (`sandbox`|`production` → cambia base URL si aplica; `// TODO(finerio): confirmar host de sandbox exacto — dejar override por env`).

### 3.3 Prometeo
- Docs base: `https://docs.prometeoapi.com/`. Base: `https://banking.prometeoapi.net` (sandbox: `https://banking.sandbox.prometeoapi.com`).
- Auth por request: header `X-API-Key: <PROMETEO_API_KEY>`.
- **Init**: `POST /login/` con `{ provider, username, password }` — Prometeo es login-server-side (no widget). En esta fase el **init devuelve `configured:false` con `requires_custom_ui:true`** y una lista textual de proveedores soportados (`GET /provider/`), para que el wizard sepa que Prometeo requiere formulario propio de credenciales bancarias (a implementar en fase posterior con UI dedicada). No se piden credenciales de banco al usuario en Fase 4.
- **Callback**: cuando la fase futura mande `{ provider, username, password }`, backend hace `POST /login/`, recibe `key` de sesión, encripta la `key` + credenciales (AES-GCM con `CREDENTIALS_ENCRYPTION_KEY`), upsert en `financial_connections`. Todo el flujo queda escrito y comentado, gated por env flag `PROMETEO_ENABLE_LOGIN_FLOW`.
- **Sync**: `GET /account/?key=` + `GET /movement/?key=&account=&date_start=&date_end=`.
- **Logout**: `GET /logout/?key=`.
- Secrets: `PROMETEO_API_KEY`, `PROMETEO_ENV`.
- Nota explícita: Prometeo maneja credenciales bancarias sensibles; en Fase 4 **solo se deja el andamiaje**; la activación real exige revisión de compliance separada (`// TODO(prometeo): revisar requerimientos legales antes de activar login flow en producción`).

### Cambios de código para los 3 adaptadores

- `supabase/functions/_shared/finance-providers.ts`: agregar `BelvoAdapter`, `FinerioAdapter`, `PrometeoAdapter` con misma interfaz que `PlaidAdapter` (`init`, `exchangeCallback`, `disconnect`, `getAccounts`, `getTransactions`, `configured()`).
- `financial-connection-init` / `-callback` / `-disconnect`: switch por `provider` que enruta al adaptador correcto. Sin cambios de contrato para Plaid.
- `src/lib/finance/providers/{belvo,finerio,prometeo}.ts`: reemplazar stubs por wrappers que llamen a `financial-connection-init` / `-callback` (mismo shape que el wrapper Plaid actual). Siguen devolviendo `available` según lo que responda el edge.
- `src/components/finance/ConnectBankWizard.tsx`: cargar widget SDK correspondiente on-demand (`https://cdn.belvo.io/belvo-widget-1-stable.js`, `https://widget.finerioconnect.com/sdk.js`) y para Prometeo mostrar aviso "Este proveedor requiere formulario dedicado — próxima fase".
- `FinanceIntegrationsPage.tsx`: los 4 proveedores muestran su estado real (`configured` o "Requiere credenciales" con nombres de secrets esperados).

**No se piden secrets en esta fase**; la UI seguirá mostrando "Requiere credenciales" hasta que el usuario los cargue. Cero llamadas externas hasta entonces.

## 4. Vista financiera consolidada para Super Admin

**Ruta**: `/admin/finance-overview`, sólo visible cuando `has_role(auth.uid(),'super_admin')`. Se enlaza desde `SuperAdminPage.tsx`.

**Regla de oro**: nunca exponer detalle transaccional cruzado entre tenants. Sólo agregados por tenant.

**RPC nueva `admin_finance_overview()`** (SECURITY DEFINER, valida rol adentro):

```sql
CREATE OR REPLACE FUNCTION public.admin_finance_overview()
RETURNS TABLE (
  tenant_id uuid,
  tenant_name text,
  currency text,
  health_score int,
  total_balance numeric,
  net_flow_30d numeric,
  receivables numeric,
  payables numeric,
  active_alerts_count int,
  critical_alerts_count int,
  last_activity_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Only super_admin can read finance overview' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.name,
    'MXN'::text,
    COALESCE((public.compute_tenant_health_score(t.id)->>'score')::int, 0),
    COALESCE((public.compute_tenant_financial_summary(t.id)->>'total_balance')::numeric, 0),
    COALESCE((public.compute_tenant_financial_summary(t.id)->>'net_flow')::numeric, 0),
    COALESCE((public.compute_tenant_financial_summary(t.id)->>'receivables')::numeric, 0),
    COALESCE((public.compute_tenant_financial_summary(t.id)->>'payables')::numeric, 0),
    (SELECT COUNT(*)::int FROM public.financial_alerts fa WHERE fa.tenant_id = t.id AND fa.status='active'),
    (SELECT COUNT(*)::int FROM public.financial_alerts fa WHERE fa.tenant_id = t.id AND fa.status='active' AND fa.severity='critical'),
    (SELECT MAX(posted_at) FROM public.financial_transactions WHERE tenant_id = t.id)
  FROM public.tenants t
  ORDER BY t.name;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_finance_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_finance_overview() TO authenticated;
```

**Frontend**:
- `src/pages/admin/FinanceOverviewPage.tsx` — tabla ordenable con columnas listadas arriba + badges de severidad + búsqueda por tenant. Gate doble: guard en `App.tsx` (`role !== 'super_admin'` → redirect a `/`) y RLS por la RPC.
- Enlace en `SuperAdminPage.tsx`.

---

## Archivos tocados (resumen)

| Tipo | Ruta |
|---|---|
| Nuevo | `supabase/functions/financial-alerts-scan/index.ts` |
| Nuevo | `supabase/functions/cfo-ai-weekly-briefing/index.ts` |
| Nuevo | `supabase/functions/_shared/notify-admin.ts` (extract) |
| Nuevo | `supabase/functions/_shared/cfo-context.ts` (extract) |
| Nuevo | `src/pages/admin/FinanceOverviewPage.tsx` |
| Extensión | `supabase/functions/_shared/finance-providers.ts` (+3 adapters) |
| Extensión | `supabase/functions/financial-connection-{init,callback,disconnect}/index.ts` |
| Extensión | `supabase/functions/cfo-ai/index.ts` (import desde `_shared/cfo-context.ts`) |
| Extensión | `supabase/functions/send-reminders/index.ts` (import desde `_shared/notify-admin.ts`) |
| Extensión | `src/lib/finance/providers/{belvo,finerio,prometeo}.ts` |
| Extensión | `src/components/finance/ConnectBankWizard.tsx` |
| Extensión | `src/pages/finance/{FinanceDashboard,FinanceIntegrations,CFOAssistant}Page.tsx` |
| Extensión | `src/pages/SuperAdminPage.tsx`, `src/App.tsx` (ruta admin) |
| Extensión | `src/hooks/useFinance.ts` |
| Migración | CREATE `cfo_ai_briefings`, CREATE fn `admin_finance_overview`, 2 cron jobs |
| Secrets nuevos | Ninguno obligatorio en esta fase. `CRON_SHARED_SECRET` se solicita si no existe. Belvo/Finerio/Prometeo se piden sólo cuando el usuario decida activar cada uno. |

## Fuera de alcance (explícito)

- NO auto-conciliación ni reglas de categorización.
- NO sandbox demo por tenant.
- NO activación real de ningún banco (los adaptadores quedan listos, sin secrets cargados).
- NO se toca Voz, WhatsApp, Recordatorios, Stripe SaaS, RLS endurecida, obra, Plaid ya funcionando.

## Rollback

- **Código**: eliminar los 5 archivos nuevos + revertir extensiones en los archivos listados.
- **Migración**:
  ```sql
  DROP TABLE public.cfo_ai_briefings;
  DROP FUNCTION public.admin_finance_overview();
  SELECT cron.unschedule('financial-alerts-scan');
  SELECT cron.unschedule('cfo-ai-weekly-briefing');
  ```
- **Deps**: ninguna nueva.

Confirma para ejecutar Fase 4 con estos 4 puntos.
