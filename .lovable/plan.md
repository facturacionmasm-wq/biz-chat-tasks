## Diagnóstico read-only (sin cambios aplicados)

---

### 1) `SELECT` sobre `whatsapp_usage_events` — el que aparece como ~141 ms

**Ubicación real del `SELECT` sin filtro por `tenant_id`:**
`src/components/SuperAdminConsumptionTab.tsx`, líneas **43–46** (dentro del query `sa-tenant-usage`, es el que se ejecuta al abrir el tab de SuperAdmin → Consumo):

```ts
// líneas 43–46
const { data: waEvents } = await supabase
  .from('whatsapp_usage_events')
  .select('tenant_id, units, event_type')
  .gte('occurred_at', monthStart);
```

- **Columnas seleccionadas:** `tenant_id, units, event_type` (no es literalmente `*`; `pg_stat_statements` lo reporta así porque no hay `WHERE tenant_id=…`).
- **Filtro:** solo `occurred_at >= primer día del mes`. **No filtra por `tenant_id`** (a propósito: es la vista de super_admin que agrega todos los tenants).
- **Uso posterior (líneas 61–66):** en JS se agrupa por tenant con `.filter(e => e.tenant_id === t.id)` y se suma `units`, separando `message_out` vs `message_in`.
- **Impacto:** al crecer `whatsapp_usage_events` este query se vuelve el más caro del SuperAdmin. Ya existe `idx_wa_usage_events_tenant_created(tenant_id, created_at DESC)` creado en la migración P1+P2, pero **este query filtra por `occurred_at` (no `created_at`) y no por `tenant_id`**, así que ese índice no le aplica.

**Segundo lugar donde se lee (con filtro correcto):**
`src/hooks/useTenantBilling.ts`, líneas **36–43** — este sí filtra `.eq('tenant_id', tenantId).gte('occurred_at', monthStart)`, es el que consume `UsagePage`.

**Sobre `SuperAdminConsumptionTab.tsx` líneas 118 y 132** (las que mencionaste):
- **línea 118:** `supabase.from('tenants').select('id, name').order('name')` — es de `tenants`, no de `whatsapp_usage_events`. Está cubierto por PK.
- **línea 132:** `supabase.from('usage_packages' as any).insert({...})` — es un `INSERT`, no un `SELECT`.

**En `src/pages/UsagePage.tsx` línea 18:** es `supabase.from('profiles').select('tenant_id').eq('user_id', user.id).maybeSingle()`. **No toca `whatsapp_usage_events`.** El acceso a `whatsapp_usage_events` desde `UsagePage` ocurre indirectamente vía `useTenantBilling` (ya filtrado por tenant).

**Conclusión punto 1:** el `SELECT` de ~141 ms es el de `SuperAdminConsumptionTab.tsx` líneas 43–46. Para optimizarlo sin cambiar lo que muestra hay dos opciones (a decidir después):
- A) añadir índice `(occurred_at)` — ayuda al escaneo por rango del mes actual.
- B) reescribir la agregación en SQL (RPC) con `GROUP BY tenant_id, event_type` para que Postgres devuelva ya sumado en vez de traer todas las filas al cliente.

---

### 2) Cómo carga hoy el inbox de WhatsApp los mensajes

**Archivo/hook:** `src/hooks/useWhatsAppData.ts` (usado por `WhatsAppInboxPage.tsx`).

**Query exacta al abrir una conversación**, líneas **69–77**:

```ts
const fetchMessages = useCallback(async (conversationId: string) => {
  activeConvIdRef.current = conversationId;
  try {
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    if (data) setMessages(data as DBMessage[]);
```

- **`select('*')`** — trae todas las columnas.
- **Filtro:** `conversation_id = <id>`.
- **Orden:** `created_at ASC`.
- **`limit` / `range`: NO hay.** Se traen todos los mensajes históricos de la conversación en una sola llamada. Ya existe `idx_whatsapp_messages_conv_created(conversation_id, created_at DESC)` (P0), que sirve tanto para ASC como DESC, pero no limita el volumen devuelto.

**Realtime (mismo archivo, líneas ~99–137):** un solo canal `whatsapp-realtime-${tenantId}` con dos suscripciones:
- `whatsapp_conversations` filtrado por `tenant_id=eq.${tenantId}` → recarga la lista.
- `whatsapp_messages` **sin filtro server-side** (Supabase Realtime no soporta filtros compuestos aquí) → en el handler compara `newMsg.conversation_id === activeConvIdRef.current` y hace `setMessages(prev => [...prev, newMsg])` evitando duplicados por `id`. Cleanup con `supabase.removeChannel(channel)` en el `return` del `useEffect`.

**Implicación para paginar sin romper realtime:** cualquier paginación tiene que
- ordenar `DESC` en la query inicial (últimos N) y luego invertir en cliente,
- mantener el mismo `activeConvIdRef` y el mismo append por INSERT del realtime (los mensajes nuevos siempre van al final),
- gestionar un "cargar más antiguos" con `range()` o `.lt('created_at', oldestLoaded)` sin tocar el canal ya suscrito.

**Otros lugares que tocan `whatsapp_messages`** (para referencia, no requieren cambio ahora):
- `src/pages/WhatsAppInboxPage.tsx:86` — `INSERT` al crear nueva conversación.
- `src/pages/WhatsAppInboxPage.tsx:101` — `DELETE` por `conversation_id` al borrar conversación.
- `src/pages/AnalyticsPage.tsx:139` — `select('id, created_at').eq('tenant_id').gte('created_at', since)` (analytics).

---

### 3) Monitoreo de queries y `pg_stat_statements`

- **`pg_stat_statements` está instalado:** `extname=pg_stat_statements`, `extversion=1.11`. Es la fuente que ya usamos vía el tool `supabase--slow_queries`.
- **Otras extensiones relevantes presentes:** `vector` (0.8.0). **NO está instalado `pg_trgm`** (haría falta para el `GIN (name gin_trgm_ops)` en `contacts` cuando lo abordemos).
- **Vistas/funciones de monitoreo propias en `public`:** ninguna. La búsqueda `pg_class` en schema `public` con nombres tipo `%stat%|%monitor%|%slow%` solo devuelve índices de features existentes (`idx_reminders_status_remind_at`, `idx_call_records_tenant_status`, `idx_appointments_sync_status`, etc.) y la tabla `realtime_margin_state`. No hay vista tipo `v_slow_queries` ni función `get_slow_queries()`.
- **Consecuencia:** sí es posible crear un **monitor read-only** (una vista `SECURITY DEFINER` o RPC `SECURITY DEFINER` restringida a `super_admin` que exponga `pg_stat_statements` filtrado por schema `public`). Ese cambio requeriría migración; por ahora queda solo diagnosticado.

---

### Resumen ejecutivo

| # | Hallazgo | Ubicación exacta | Estado |
|---|---|---|---|
| 1 | `SELECT` sin `tenant_id` sobre `whatsapp_usage_events` (~141 ms) | `src/components/SuperAdminConsumptionTab.tsx:43–46` | Diseño intencional del panel super_admin. Se optimiza con índice en `occurred_at` o RPC agregada. |
| 2 | Inbox WhatsApp carga **todo el historial** de la conversación sin `limit` | `src/hooks/useWhatsAppData.ts:69–77` (query) + `:99–137` (realtime) | Índice compuesto ya cubre; falta paginación en app. Realtime seguro de mantener si se pagina con `DESC + range`. |
| 3 | `pg_stat_statements` disponible (v1.11), sin monitor propio en `public` | — | Posible crear vista/RPC restringida a super_admin más adelante. |

No se ejecutó ningún cambio. ¿Apruebas pasar a la fase de propuesta de fixes concretos (índice `occurred_at`, paginación del inbox, y RPC de monitor)?
