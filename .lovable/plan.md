## Diagnóstico de rendimiento de BD (read-only)

Analicé `pg_stat_statements` (slow queries reales), `pg_indexes` para todas las tablas, `pg_stat_user_tables` (volumen), y todas las llamadas `.from(...)`, `.rpc(...)`, `.functions.invoke(...)` en `src/` y `supabase/functions/`.

---

### 1. Volumen actual de datos (top tablas)

| Tabla | Filas | Tamaño |
|---|---|---|
| webhook_logs | 3.438 | 1.4 MB |
| whatsapp_messages | 1.407 | 1.1 MB |
| whatsapp_usage_events | 1.201 | 696 kB |
| audit_events | 973 | 568 kB |
| call_events | 150 | 152 kB |
| appointments | 137 | 248 kB |
| call_jobs | 131 | 152 kB |
| appointment_notifications | 128 | 144 kB |
| call_records | 76 | 288 kB |

Volumen aún moderado; muchos "escaneos" hoy son baratos pero **crecen linealmente**. Prioricé según `total_ms` real de `pg_stat_statements`.

---

### 2. Frecuencia de acceso (llamadas en código)

Top tablas leídas desde app + edge functions (conteo de referencias):
`tenants` 84 · `profiles` 75 · `call_records` 70 · `appointments` 68 · `audit_events` 35 · `stripe_customers` 29 · `google_calendar_tokens` 25 · `whatsapp_messages/conversations` 24+24 · `call_jobs` 24 · `knowledge_items` 23 · `appointment_notifications` 23 · `tenant_subscriptions` 22 · `contacts` 22 · `expenses` 19 · `user_roles` 16.

---

### 3. Queries realmente lentas (de `pg_stat_statements`)

Ordenado por `total_ms` acumulado. Marcadas con **[SEQ SCAN probable]** las que no tienen índice que las cubra.

| # | Query (resumida) | Calls | Total ms | Estado del índice |
|---|---|---|---|---|
| 1 | `appointment_notifications WHERE status IN(pending,failed) AND scheduled_at<=now() ORDER BY scheduled_at` (cron `send-reminders`) | 46.383 | 19.162 | ✅ Cubierta por `idx_appt_notif_due(status, scheduled_at) WHERE status IN (...)` |
| 2 | `reminders WHERE (status=$1 OR status=$2) AND remind_at<=$3 ORDER BY remind_at` (cron `send-reminders`) | 46.383 | 11.921 | ❌ **[SEQ SCAN]** — no hay ningún índice en `reminders` (solo PK) |
| 3 | `appointments WHERE calendar_sync_status IN(PENDING_SYNC,FAILED_SYNC) AND status<>cancelled AND deleted_at IS NULL AND sync_attempts<N ORDER BY last_sync_attempt ASC NULLS FIRST` (cron `calendar-sync`) | 23.944 | 7.885 | ⚠️ Parcial `idx_appointments_sync_status(calendar_sync_status)` cubre filtro pero **no el ORDER BY last_sync_attempt** |
| 4 | `call_jobs WHERE status='queued' AND run_after<=now() ORDER BY created_at` (cron `call-job-worker`) | 23.969 | 4.883 | ⚠️ Parcial `idx_call_jobs_queue(status, run_after)` cubre filtro pero **no ordena por created_at** |
| 5 | `whatsapp_messages WHERE metadata @> $1 ORDER BY created_at DESC` | 502 | 3.784 | ❌ **[SEQ SCAN]** — sin índice GIN en `metadata` y sin índice en `created_at` |
| 6 | `whatsapp_messages WHERE conversation_id=$1 ORDER BY created_at ASC` (inbox al abrir chat) | 45 | 1.520 (mean 34 ms) | ⚠️ Sin índice compuesto `(conversation_id, created_at)` |
| 7 | `whatsapp_messages WHERE conversation_id=$1 AND direction=$2 AND metadata @> $3` | 139 | 1.167 | ❌ Igual que #6, sin cubrir |
| 8 | `whatsapp_usage_events` sin filtros (`SELECT *`) | 14 | 1.976 (mean 141 ms) | ❌ Es un `SELECT *` sin WHERE — problema de aplicación, no de índice |
| 9 | `user_roles WHERE user_id=$1 AND tenant_id=$2` | 799 | 1.446 | ⚠️ Verificar índice `(user_id, tenant_id)` — hay PK y varios parciales, pero mean 1.8 ms sugiere cubierto adecuadamente |
| 10 | `tenants WHERE id=$1` | 149 | 842 | ✅ PK |

---

### 4. Consultas probablemente `Seq Scan` (por código, sin índice conocido)

Analizando `.from(...).eq/.gte/.order` en el código contra `pg_indexes`:

| Tabla | Filtro / Order en código | Índice existente | Riesgo |
|---|---|---|---|
| **reminders** | `status IN(...) AND remind_at<=now() ORDER BY remind_at` (cada minuto) | ninguno | **ALTO** — cron dispara 46k veces |
| **reminders** | `.eq('user_id', …)` y `.eq('tenant_id', …)` (RemindersPage) | ninguno | **MEDIO** |
| **whatsapp_messages** | `conversation_id + ORDER BY created_at` (abrir chat) | ninguno compuesto | **ALTO** — crece 1.4k → millones |
| **whatsapp_messages** | `metadata @> {...}` (búsqueda por provider/message_sid en `daily-reminders`, `twilio-send`) | ninguno GIN | **ALTO** |
| **whatsapp_conversations** | `.eq('tenant_id') .order('last_message_at' DESC)` (inbox realtime) | verificar | **MEDIO** |
| **whatsapp_usage_events** | `.eq('tenant_id') .gte('created_at')` (dashboard uso) | verificar | **MEDIO** |
| **webhook_logs** | INSERTs 770 calls (mean 3.6 ms) + reads por tenant | solo PK | **MEDIO** — tabla crece rápido |
| **expenses** | `.eq('user_id') .eq('status')` (`daily-reminders`), `.eq('tenant_id') .order('date')` (ExpensesPage) | solo PK | **MEDIO** — sin ningún índice secundario |
| **contacts** | `.ilike('name', '%q%')` búsqueda global | `phone` y `starred` sí; **`name` no** y `ilike` con `%…%` no usa btree | **MEDIO** (necesitaría `pg_trgm` GIN si es común) |
| **appointments** | `calendar_sync_status + ORDER BY last_sync_attempt` | parcial cubre filtro, no orden | **MEDIO** |
| **call_jobs** | `status='queued' AND run_after<= ORDER BY created_at` | parcial cubre filtro, no orden | **MEDIO** |
| **audit_events** | `.eq('tenant_id') .order('created_at' DESC)` | ✅ `idx_audit_tenant_created` | OK |
| **call_records** | `.eq('tenant_id') .order('created_at')` / `.eq('tenant_id',status)` | ✅ ambos cubiertos | OK |
| **appointment_notifications** | cron | ✅ cubierta | OK |
| **profiles** | `whatsapp_number + status='active'` | ✅ `idx_profiles_whatsapp_tenant` | OK |
| **user_roles** | `user_id, tenant_id, role` | ✅ | OK |

---

### 5. Tabla priorizada de índices candidatos (SOLO diagnóstico, no ejecutar)

| Prio | Tabla | Índice sugerido | Query que lo motiva | Impacto esperado |
|---|---|---|---|---|
| **P0** | `reminders` | `(status, remind_at)` parcial `WHERE status IN ('pending','failed')` | cron cada minuto, 46k calls, 12 s acumulados | Elimina seq scan recurrente |
| **P0** | `whatsapp_messages` | `(conversation_id, created_at DESC)` | abrir chat en inbox (mean 34 ms) | Reduce a <1 ms; escalabilidad |
| **P0** | `whatsapp_messages` | `GIN (metadata)` | filtros `metadata @>` (3.8 s acumulados) | De seq scan a lookup |
| **P1** | `call_jobs` | `(status, run_after, created_at)` reemplazando `idx_call_jobs_queue` | cron worker, 24k calls | Cubre filtro + orden |
| **P1** | `appointments` | `(calendar_sync_status, last_sync_attempt NULLS FIRST)` parcial | cron calendar-sync, 24k calls, 7.9 s | Cubre filtro + orden |
| **P1** | `whatsapp_conversations` | `(tenant_id, last_message_at DESC)` | inbox principal | Ordenamiento del listado |
| **P2** | `expenses` | `(tenant_id, date DESC)` y `(user_id, status)` | ExpensesPage + daily-reminders | Sin ningún índice hoy |
| **P2** | `whatsapp_usage_events` | `(tenant_id, created_at DESC)` | dashboard uso y billing | Crece rápido |
| **P2** | `reminders` | `(tenant_id, user_id, remind_at)` | RemindersPage listado por usuario | UI listado |
| **P3** | `webhook_logs` | `(tenant_id, created_at DESC)` | trazabilidad; crece más rápido que otras | Preventivo |
| **P3** | `contacts` | `GIN (name gin_trgm_ops)` (requiere extensión) | búsqueda `ilike '%q%'` | Solo si búsqueda global es frecuente |
| **P3** | `whatsapp_usage_events` código | Revisar `SELECT *` sin WHERE (mean 141 ms) | app envía query sin filtro | Fix en código, no índice |

---

### 6. Observaciones no relacionadas con índices

- `whatsapp_usage_events` `SELECT *` sin `WHERE` (14 calls, mean 141 ms): probablemente en `SuperAdminConsumptionTab` o `UsagePage`. Debería filtrarse por `tenant_id` y ventana temporal.
- `DELETE FROM tenants WHERE id=$1` (12 calls, mean 182 ms): normal por cascadas; no optimizar.
- `webhook_logs` INSERTs 770 × 3.6 ms = ~2.8 s acumulados: coste de escritura, no de lectura.
- `SuperAdminConsumptionTab.tsx:118,132` y `UsagePage.tsx:18` leen `whatsapp_usage_events` / `usage_costs_reconciled` — revisar que siempre filtren por `tenant_id`+rango de fechas.

---

### 7. Qué NO hacer todavía

No se ejecutan cambios. Este plan es solo diagnóstico. Cuando apruebes, propondré una migración por prioridad (P0 primero) con `CREATE INDEX` (nunca `CONCURRENTLY` dentro de migración), y verificación con `EXPLAIN (ANALYZE, BUFFERS)` antes/después.

¿Apruebas para pasar a la siguiente fase (proponer migración P0: `reminders`, `whatsapp_messages` compuesto + GIN)?