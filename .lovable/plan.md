
# Plan · 2 pendientes (auditado, sin duplicar)

## Auditoría previa (hechos)

### PIN hoy
- Columna única: `profiles.pin_hash` (formato `salt:hash`, PBKDF2 100k SHA-256).
- Edge function `pin-service` con acciones `hash_pin`, `verify_pin`. Sin `reset_pin`, sin PIN temporal, sin flag de "cambio obligatorio".
- Se usa en: WhatsApp bot (auth de empleados), voz (confirmaciones), `SettingsPage` (cambio propio). No hay UI de admin para resetear.
- Invitaciones: `invite-member` crea el usuario con `password` (Supabase Auth) — nunca genera PIN. No hay canal de "envío de PIN" hoy; el canal de invitación existente es **email** (Supabase invita o el owner comparte password) y opcionalmente WhatsApp si el owner captura `whatsapp_number` al invitar.

### Gastos hoy
- Tabla `expenses` completa: `status` (`pending`/`pending_approval`/`approved`/`rejected`/`paid`), `approval_required`, `approver_user_id`, `paid_at`, `receipt_url`, `document_*_drive_url`, `folio`, `vendor_name`, `concept`, `type` (expense|budget), `source`.
- `category` es **text libre**, NO hay FK a `financial_categories` (que sí existe con `kind='expense'`).
- NO existe `project_id` en `expenses`.
- Pantalla `src/pages/ExpensesPage.tsx` (312 líneas) en ruta `/expenses` (fuera de /finance): listado con filtros por período/tipo/estado, vista por usuario, sin formulario de alta/edición ni acción de aprobar/rechazar/pagar desde UI (solo lectura). Se alimenta hoy vía WhatsApp bot (OCR) y app externa.
- Módulo obra: `project_costs` es tabla separada; no hay pantalla de expenses en obra que reutilizar.
- `expenses` ya alimenta AR/AP (`compute_tenant_financial_summary`), conciliación (`suggest_transaction_matches` vía `financial_transactions.reconciled_with_expense_id`) y health score (overdue payables). Se preserva íntegro.

**Anti-duplicación**: se **extiende** `ExpensesPage.tsx` reutilizándolo dentro de `/finance/expenses` (no se crea segunda pantalla). Se **agregan** FK a `financial_categories` y `project_id` como columnas opcionales, sin romper el text libre existente.

---

## PENDIENTE 1 · Reset de PIN + PIN temporal en invitación

### Migración (una sola)
- `profiles`: agregar `pin_must_change boolean DEFAULT false`, `pin_temp_expires_at timestamptz`, `pin_updated_at timestamptz`, `pin_set_by uuid` (quién lo asignó, para audit).
- Función `admin_reset_user_pin(_target_user uuid)` SECURITY DEFINER: valida caller es `owner`/`admin`/`super_admin` del tenant del target; genera PIN de 6 dígitos aleatorio server-side, lo hashea (PBKDF2 con el mismo esquema), guarda `pin_hash`, `pin_must_change=true`, `pin_temp_expires_at = now()+72h`, escribe `audit_events`, y **devuelve el PIN en claro solo en el retorno** (nunca se persiste en claro).
- Trigger: al hacer `UPDATE` de `pin_hash` desde `pin-service` con `action='hash_pin'` (usuario cambiando), el edge fuerza `pin_must_change=false`, `pin_temp_expires_at=null`, `pin_updated_at=now()`.

### Edge functions
- **Extender** `pin-service/index.ts`:
  - Nueva acción `admin_reset_pin` → llama `admin_reset_user_pin` y opcionalmente envía por WhatsApp (si el target tiene `whatsapp_number` y hay Twilio configurado) o email (Resend `no-reply@rybixholding.com`). Retorna `{ pin_temp, expires_at, sent_via }`.
  - Nueva acción `verify_pin` (si no existe con este contrato): ya devuelve además `must_change` y `expired`.
  - En `hash_pin` (cambio propio): limpiar flags temporales.
- **Extender** `invite-member/index.ts`:
  - Si `payload.generate_temp_pin=true` (default true), después de crear el user llama a `admin_reset_user_pin` para ese user y adjunta el PIN al mismo email/mensaje de invitación existente. Sin nueva función de correo — se reutiliza el helper de email ya presente en el flujo de invitación.

### Frontend
- **Extender** `src/pages/SettingsPage.tsx` (sección PIN): si `pin_must_change=true` al montar → forzar modal "Cambia tu PIN temporal" bloqueando cierre; al guardar llama `hash_pin` y limpia flags.
- **Extender** `src/components/AppLayout.tsx` (o guard equivalente): banner global "Tu PIN temporal expira en Xh — cámbialo ahora" con link a Settings, si `pin_must_change=true`.
- **Nuevo** `src/components/team/ResetPinDialog.tsx`: botón "Resetear PIN" en la lista de miembros (ubicación existente: `src/pages/SettingsPage.tsx` sección equipo, o donde ya se listan miembros) → llama `pin-service` acción `admin_reset_pin`, muestra el PIN una sola vez con botón copiar y aviso "válido 72h, debe cambiarse en primer uso".
- **Extender** WhatsApp bot verify (`whatsapp-bot/*` autenticación con PIN): si `must_change=true` o `expired`, responder "Debes actualizar tu PIN desde la app antes de continuar" — no bloquea funciones de solo lectura ya definidas.

### Archivos pendiente 1

| Tipo | Ruta |
|---|---|
| Migración | `profiles` (+4 cols) + `admin_reset_user_pin()` + índice |
| Extensión | `supabase/functions/pin-service/index.ts` |
| Extensión | `supabase/functions/invite-member/index.ts` |
| Extensión | `src/pages/SettingsPage.tsx` |
| Extensión | `src/components/AppLayout.tsx` (banner) |
| Nuevo | `src/components/team/ResetPinDialog.tsx` |
| Extensión mínima | `supabase/functions/whatsapp-bot/*` (mensaje si must_change) — solo si el helper de auth centraliza; si no, se omite |

---

## PENDIENTE 2 · Módulo Gastos en Finanzas Inteligentes

### Migración (una sola, aditiva)
- `expenses`: agregar `category_id uuid REFERENCES financial_categories(id) ON DELETE SET NULL` y `project_id uuid REFERENCES projects(id) ON DELETE SET NULL`. Se mantiene `category` text por compatibilidad. Índices `(tenant_id, category_id)` y `(tenant_id, project_id)`.
- Backfill idempotente: para cada expense sin `category_id`, intentar match por `name ILIKE category` dentro de `financial_categories` mismo tenant + `kind='expense'`. Deja el text como fallback.
- Nueva RPC `approve_expense(_id uuid, _action text, _reason text)` SECURITY DEFINER: valida rol y transiciona `pending_approval → approved | rejected`, setea `approved_at`/`rejected_at`/`rejection_reason`, escribe `audit_events`. **No** toca `paid_at` (eso queda para conciliación existente).

### Frontend
- **Nuevo** `src/pages/finance/FinanceExpensesPage.tsx`: **wrapper** que reutiliza los mismos hooks/queries de `ExpensesPage.tsx` extraídos a un componente compartido `src/components/expenses/ExpensesList.tsx` (refactor no-op de la lista actual) + agrega:
  - Filtros extra: categoría (`financial_categories`), proyecto (`projects`), rango de fecha.
  - Formulario alta/edición (`ExpenseFormDialog.tsx`): monto, moneda, fecha, categoría (select FK), proyecto (opcional), vendor, concept, notas, `approval_required`, subir comprobante a bucket Storage (`expenses-receipts`, RLS por tenant) → guarda `receipt_url`.
  - Acciones inline: Aprobar / Rechazar (para admins/owners cuando `status='pending_approval'`) → llama `approve_expense`. Marcar pagado (setea `paid_at`) — solo si el usuario tiene rol admin/owner.
- **Extensión** `src/pages/finance/FinanceLayout.tsx`: agregar pestaña "Gastos" apuntando a `/finance/expenses`.
- **Extensión** `src/App.tsx`: ruta `/finance/expenses` → `FinanceExpensesPage` bajo el mismo guard que las otras finance pages.
- La ruta actual `/expenses` sigue viva (compat), pero internamente renderiza el mismo `ExpensesList` compartido.
- **Nuevo** `src/components/expenses/ExpensesList.tsx` y `ExpenseFormDialog.tsx`.
- **Extensión** `src/hooks/useFinance.ts`: agregar `useExpenses`, `useExpenseMutations`, `useApproveExpense` reutilizando patrón existente.

### Storage
- Bucket `expenses-receipts` (privado) + policies: authenticated puede leer/escribir sólo dentro de `tenant_id/…`; `service_role` full.

### Impacto en resto de finanzas
- Cero cambios en `compute_tenant_financial_summary`, `compute_tenant_health_score`, `suggest_transaction_matches`, `financial_alerts` scan. Todo sigue leyendo `expenses` igual (payables por `paid_at IS NULL`, overdue >30d).
- La conciliación existente `suggest_transaction_matches` sigue funcionando por description/amount; ahora se puede además reforzar por `category_id` en fase futura (fuera de alcance).

### Archivos pendiente 2

| Tipo | Ruta |
|---|---|
| Migración | `expenses` (+2 cols FK) + backfill + `approve_expense()` + bucket + policies |
| Nuevo | `src/pages/finance/FinanceExpensesPage.tsx` |
| Nuevo | `src/components/expenses/ExpensesList.tsx` |
| Nuevo | `src/components/expenses/ExpenseFormDialog.tsx` |
| Extensión | `src/pages/finance/FinanceLayout.tsx` (tab) |
| Extensión | `src/App.tsx` (ruta) |
| Extensión | `src/pages/ExpensesPage.tsx` (usar `ExpensesList`) |
| Extensión | `src/hooks/useFinance.ts` |

---

## Fuera de alcance (explícito)
Voz, WhatsApp de citas, recordatorios de citas, Stripe SaaS, RLS existente, adaptadores bancarios, obra (excepto FK opcional `project_id` en expenses).

## Rollback exacto

**Pendiente 1**
```sql
ALTER TABLE public.profiles
  DROP COLUMN pin_must_change,
  DROP COLUMN pin_temp_expires_at,
  DROP COLUMN pin_updated_at,
  DROP COLUMN pin_set_by;
DROP FUNCTION public.admin_reset_user_pin(uuid);
```
Revertir cambios en `pin-service`, `invite-member`, `SettingsPage`, `AppLayout`. Borrar `ResetPinDialog.tsx`.

**Pendiente 2**
```sql
ALTER TABLE public.expenses DROP COLUMN category_id, DROP COLUMN project_id;
DROP FUNCTION public.approve_expense(uuid, text, text);
-- storage: eliminar bucket expenses-receipts si se creó
```
Revertir `FinanceLayout`, `App.tsx`, `ExpensesPage`, `useFinance`. Borrar `FinanceExpensesPage.tsx`, `ExpensesList.tsx`, `ExpenseFormDialog.tsx`.

---

Confirma para ejecutar ambos en orden (1 → 2), migración por pendiente, veredicto item por item al final.
