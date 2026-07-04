# Plan · Fix `pull_bookings` en `calcom-sync` (error "bookings is not iterable")

Archivo único: `supabase/functions/calcom-sync/index.ts`. Cero migraciones, cero RLS/GRANT, sin tocar `connect`, `list_event_types`, `set_default_event_type`, `disconnect`, `status`, ni el webhook/dedup de `calcom-webhook`.

---

## Diagnóstico (causa raíz)

Ubicación exacta dentro de `supabase/functions/calcom-sync/index.ts`, rama `action === 'pull_bookings'`:

- **Línea 178** — fetch:
  ```ts
  const res = await fetch(`${CALCOM_API}/bookings?status=upcoming`, { headers: { Authorization: `Bearer ${key}` } });
  ```
  Falta el header `cal-api-version` (que sí usamos en `list_event_types`, línea 79). Sin él, Cal.com v2 puede responder con un shape distinto o `451/legacy`.

- **Línea 179** — chequeo pobre:
  ```ts
  if (!res.ok) return json({ error: `Cal.com ${res.status}` }, 502);
  ```
  No incluye el body de Cal.com, así que cuando la API responde con detalle (p. ej. `apiKey missing` o `unauthorized`) se pierde el mensaje.

- **Líneas 180-181** — parse y extracción del array:
  ```ts
  const data = await res.json();
  const bookings = data.data || data.bookings || [];
  ```
  Cal.com v2 real devuelve `{ status, data: { bookings: [...] } }` (bookings anidado dentro de `data`). El código toma `data.data` (que es un **objeto**, no array), lo asigna a `bookings`, y el `for..of` truena con `"bookings is not iterable"`.

- **Línea 182** — iteración:
  ```ts
  for (const b of bookings) {
  ```
  Rompe cuando `bookings` es objeto o `undefined`.

Confirmado por logs de la edge function:
```
calcom-sync error: TypeError: bookings is not iterable
    at Server.<anonymous> (…/calcom-sync/index.ts:267:23)
```
(La línea 267 corresponde al `for..of` en el archivo compilado; en fuente es el `for (const b of bookings)` de `pull_bookings`.)

---

## Cambios propuestos (unificados dentro de la rama `pull_bookings`)

Todo el cambio queda contenido entre las líneas 176-207 del archivo actual. Sin tocar el resto de la función.

1. **Añadir `cal-api-version` al fetch** (misma versión que ya usamos en `list_event_types`, línea 80: `'2024-06-14'`), para consistencia:
   ```ts
   const res = await fetch(`${CALCOM_API}/bookings?status=upcoming`, {
     headers: { Authorization: `Bearer ${key}`, 'cal-api-version': '2024-06-14' },
   });
   ```

2. **Manejo de `!res.ok` con body**:
   ```ts
   if (!res.ok) {
     const t = await res.text();
     return json({ error: `Cal.com ${res.status}: ${t.slice(0, 300)}` }, 502);
   }
   ```

3. **Parse defensivo del array de bookings** — soporta todas las formas típicas de la API sin asumir shape:
   ```ts
   const data = await res.json().catch(() => ({}));
   const bookings: any[] = Array.isArray(data)
     ? data
     : Array.isArray(data?.data?.bookings)
     ? data.data.bookings
     : Array.isArray(data?.bookings)
     ? data.bookings
     : Array.isArray(data?.data)
     ? data.data
     : [];
   ```

4. **Validación antes de iterar** (defensa en profundidad; ya no puede tronar, pero deja early-return limpio cuando no hay reservas):
   ```ts
   if (!Array.isArray(bookings) || bookings.length === 0) {
     await supabase.from('calcom_integrations')
       .update({ last_sync_at: new Date().toISOString() })
       .eq('tenant_id', tenantId);
     return json({ ok: true, created: 0, updated: 0, total: 0 });
   }
   ```

5. **El resto del bloque** (`for (const b of bookings) { … }` con el upsert de `appointments` y el `update last_sync_at` final) queda **idéntico**. Los campos que ya se leen (`b.uid`, `b.startTime`, `b.endTime`, `b.title`, `b.eventType?.title`, `b.attendees[0]`, `b.status`) siguen siendo tolerantes gracias al `if (!uid || !b.startTime || !b.endTime) continue;` existente en la línea 187.

---

## Qué NO se toca

- Sub-acciones `connect` (líneas 116-166), `list_event_types` (67-102), `set_default_event_type` (104-114), `disconnect` (168-181 originales), `status` (183-188).
- `supabase/functions/calcom-webhook/index.ts` y su dedup por `calcom_event_id`.
- Helpers `getKey/encrypt/decrypt`, autenticación del caller, resolución de `tenantId`.
- Ninguna migración, RLS, GRANT ni columna secreta. Ningún archivo `whatsapp-*`, `twilio-*`, `elevenlabs-*`, `call-transfer*` ni configuración del agente de voz.

## Verificación

1. `tsgo --noEmit` limpio.
2. En `/integrations` con Cal.com conectado y **sin reservas**: "Sincronizar reservas ahora" responde `{ ok: true, created: 0, updated: 0, total: 0 }` (no 500).
3. Con al menos una reserva en Cal.com: aparece en `appointments` con `calendar_event_id` prefijo `calcom:` y `calendar_sync_status = 'SYNCED'`.
4. Con API key inválida forzada: el 502 ahora incluye el mensaje textual de Cal.com para diagnóstico inmediato en el toast del frontend.
5. Logs de `calcom-sync` dejan de mostrar `TypeError: bookings is not iterable`.
