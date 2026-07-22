# Plan — Productos/Inventario + CFDI-SAT

## Verificación anti-duplicación
- `service_packages` y `package_catalog` existen pero son **paquetes prepagados de uso SaaS** (WhatsApp/Voz), no productos comerciales. No hay tabla de productos/servicios en Proyectos ni en Avance de Obra. **No hay duplicación** — se crea `public.products` nueva.
- No existe módulo CFDI actual. Nada de tablas `cfdi_*`, ni proveedores PAC.

---

## Parte A — Productos / Inventario

### Migración
- `CREATE TABLE public.products`: `id, tenant_id, sku, name, description, unit_price numeric(14,4), currency text default 'MXN', unit_of_measure text, sat_clave_prod_serv text, sat_clave_unidad text, stock_quantity numeric(14,4) default 0, category_id uuid FK financial_categories, is_active bool default true, created_at, updated_at`.
- Índice `(tenant_id, is_active)`, único `(tenant_id, sku)` cuando sku not null.
- GRANT `authenticated` (SELECT/INSERT/UPDATE/DELETE) + `service_role` ALL. RLS: `tenant_id = get_user_tenant_id(auth.uid())`, mutaciones limitadas a `owner/admin/staff` (mismo patrón que `expenses`).
- Trigger `update_updated_at_column`.
- Trigger de auditoría → `audit_events` (`product_created/updated/deleted`) mismo patrón que `expenses`.
- Validación SAT vía CHECK: `sat_clave_prod_serv ~ '^[0-9]{8}$'` y `sat_clave_unidad ~ '^[A-Z0-9]{2,3}$'` (permitir NULL).

### Frontend (nuevo)
| Archivo | Tipo |
|---|---|
| `src/hooks/useProducts.ts` | Nuevo — `useProducts`, `useUpsertProduct`, `useDeleteProduct` (soft delete `is_active=false`) |
| `src/pages/ProductsPage.tsx` | Nuevo — tabla + buscador + modal alta/edición con validación Zod (formato SAT) |
| Ruta `/products` en `App.tsx` + entrada en menú | Extensión |

---

## Parte B — Adjuntar productos a Presupuestos

### Migración
- `ALTER TABLE financial_budget_lines ADD COLUMN product_id uuid REFERENCES products(id) ON DELETE SET NULL`.
- `ALTER TABLE financial_budget_lines ADD COLUMN quantity numeric(14,4)` (opcional; cálculo `planned_amount = quantity * unit_price` en cliente, campo sigue editable).
- RPC `upsert_budget` extendida para aceptar `product_id` y `quantity` por línea (backward compatible).

### Frontend
- `src/components/finance/BudgetEditor.tsx` — extensión: selector opcional "Producto" que autocompleta `category_name`, `unit_price*quantity → planned_amount`. Si no hay producto: comportamiento actual sin cambios.
- `src/hooks/useFinance.ts` — extender `BudgetLineInput` con `product_id?`, `quantity?`.

---

## Parte C — CFDI-SAT

### Migración
- `CREATE TABLE public.cfdi_documents`: `id, tenant_id, series, folio, tipo_comprobante text, uso_cfdi text, forma_pago text, metodo_pago text, moneda text default 'MXN', receptor_rfc text, receptor_nombre text, receptor_uso_cfdi text, subtotal numeric(14,2), iva numeric(14,2), total numeric(14,2), estado text default 'borrador' check in ('borrador','timbrado','cancelado','error'), uuid_fiscal text, xml_url text, pdf_url text, provider text, error_message text, created_at, updated_at`.
- `CREATE TABLE public.cfdi_concepts`: `id, cfdi_document_id uuid FK ON DELETE CASCADE, product_id uuid FK products NULL, clave_prod_serv text, clave_unidad text, descripcion text, cantidad numeric(14,4), valor_unitario numeric(14,4), importe numeric(14,2), iva_tasa numeric(5,4) default 0.16`.
- GRANTs + RLS por tenant (mismo patrón). Mutaciones `owner/admin`.
- Trigger auditoría `cfdi_issued/cfdi_cancelled` (disparado por cambio de `estado`).

### Backend edge functions
| Función | Rol |
|---|---|
| `supabase/functions/_shared/cfdi-providers.ts` | Nuevo — registro `getCfdiAdapter(id)`, interfaz `issue/cancel/status`, adaptadores `facturama` (real, sandbox), `sw` (stub), `finkok` (stub) |
| `supabase/functions/cfdi-issue/index.ts` | Nuevo — arma payload desde `cfdi_documents`+`cfdi_concepts`, llama adaptador, guarda `uuid_fiscal/xml_url/pdf_url`, actualiza estado |
| `supabase/functions/cfdi-cancel/index.ts` | Nuevo — recibe `motivo` SAT (01/02/03/04) |
| `supabase/functions/cfdi-status/index.ts` | Nuevo — consulta status por UUID |

Secrets requeridos: `FACTURAMA_API_KEY`, `FACTURAMA_API_SECRET`, `FACTURAMA_ENV` (sandbox por defecto). Se solicitan solo cuando el usuario aprieta "Timbrar" por primera vez, o los añade en Integraciones. Adapter devuelve `configured:false, missing_secrets:[...]` si faltan; UI muestra badge **"Requiere credenciales"**.

### Frontend
| Archivo | Tipo |
|---|---|
| `src/pages/finance/CFDIPage.tsx` | Nuevo — listado con filtros (estado/fecha/receptor), botón Nuevo CFDI |
| `src/components/finance/CFDIEditor.tsx` | Nuevo — receptor (RFC/nombre/uso), catálogo básico de usos CFDI (G01/G02/G03/P01/S01…), conceptos (selector producto o libre), cálculo automático subtotal/iva/total, botón Timbrar/Cancelar |
| `src/hooks/useCFDI.ts` | Nuevo — `useCfdiList`, `useUpsertCfdi`, `useIssueCfdi`, `useCancelCfdi` |
| `src/pages/finance/FinanceLayout.tsx` | Extensión — tab "CFDI" con ícono `FileText` |

---

## Resumen de archivos

**Migración única** (una sola pasada, reversible):
1. `products` + índices + RLS + trigger + audit
2. `financial_budget_lines`: `product_id`, `quantity` + `upsert_budget` extendida
3. `cfdi_documents` + `cfdi_concepts` + RLS + audit

**Nuevos edge functions**: `cfdi-issue`, `cfdi-cancel`, `cfdi-status`, `_shared/cfdi-providers.ts`.

**Nuevos frontend**: `useProducts.ts`, `ProductsPage.tsx`, `useCFDI.ts`, `CFDIPage.tsx`, `CFDIEditor.tsx`.

**Extensiones**: `BudgetEditor.tsx`, `useFinance.ts`, `FinanceLayout.tsx`, `App.tsx` (rutas `/products`, `/finance/cfdi`).

**No se toca**: Voz, WhatsApp, Recordatorios, Stripe SaaS, RLS existente de otros módulos.

## Rollback
- `DROP TABLE cfdi_concepts, cfdi_documents, products CASCADE;`
- `ALTER TABLE financial_budget_lines DROP COLUMN product_id, DROP COLUMN quantity;`
- Restaurar `upsert_budget` previa (guardo versión anterior en el DO block de migración).
- Eliminar edge functions y archivos frontend nuevos (git revert).

¿Apruebo y ejecuto?
