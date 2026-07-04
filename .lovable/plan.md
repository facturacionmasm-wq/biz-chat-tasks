## Diagnóstico

**Error exacto (de la consola del cliente):**
```
code: 42703
message: column contacts.starred does not exist
```
Ubicación: `src/pages/ContactsPage.tsx:84` en `.order('starred', { ascending: false })`.

**Causa raíz:** la tabla `public.contacts` en la BD tiene solo estas columnas:
`id, tenant_id, phone, name, email, company, notes, source, created_at, updated_at`.

La UI de contactos espera además `starred` (bool) y `tags` (text[]), que **nunca se crearon** en el esquema. La query hace `select('*').order('starred', ...)` → PostgREST devuelve 42703 y todo el fetch se cae al catch → toast "Error al cargar contactos".

**¿Lo introdujo la migración de seguridad reciente? NO.**
- La migración solo tocó `google_calendar_tokens` y `profiles` (REVOKE/GRANT por columna).
- `contacts` no fue tocada: sus policies y grants siguen intactos (`Tenant users can view contacts` FOR SELECT USING tenant_id = get_user_tenant_id(auth.uid())).
- El código NO hace join con `profiles`, NO selecciona `pin_hash`, NO selecciona tokens. El error es puramente por columna faltante en `contacts`, preexistente al hardening.

**Query real de la página:**
```ts
supabase.from('contacts')
  .select('*')
  .eq('tenant_id', tid)
  .order('starred', { ascending: false })
  .order('name', { ascending: true });
```
Además el resto del componente usa `starred` y `tags` en filtros, formulario (insert/update), toggle de favorito (`.update({ starred: ... })`) y render de chips.

---

## Plan de corrección (mínimo disruptivo)

La opción menos disruptiva es **añadir las dos columnas faltantes** a `contacts` — así la UI ya escrita funciona sin reescribir componentes ni tocar seguridad.

### 1) Migración SQL (única)
Archivo nuevo en `supabase/migrations/`:
```sql
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS starred boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tags   text[]  NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_starred
  ON public.contacts (tenant_id, starred);
```
- `NOT NULL DEFAULT` evita romper inserts existentes del bot de WhatsApp.
- No cambia grants ni RLS: la policy sigue por `tenant_id`.
- No toca `profiles`, `google_calendar_tokens`, ni funciones protegidas.

### 2) Frontend
**Ningún cambio.** `ContactsPage.tsx` ya usa `starred` y `tags` correctamente; solo faltaban en el esquema. Tras regenerar `types.ts` post-migración, TypeScript queda limpio y desaparece el `as any` del toggle en línea 184.

### 3) Verificación
- Recargar `/contacts` → sin toast, listado carga.
- Toggle estrella → update sin error.
- Crear/editar contacto con tags → persiste.
- Bot de WhatsApp sigue insertando contactos (columnas nuevas tienen default).

---

## Confirmaciones de no-regresión
- **Seguridad recién aplicada:** intacta. No se re-expone `pin_hash`, `access_token`, `refresh_token`, ni columnas revocadas.
- **PIN login, Google Calendar, Cal.com, WhatsApp, agente de voz ElevenLabs, funciones protegidas (`call-transfer*`, `elevenlabs-actions-webhook`, `pin-service`, `calendar-sync`, `voice-scheduling`, `calcom-webhook`):** no se tocan.
- **RLS/GRANTs de `contacts`:** sin cambios.

### Archivos
- Nuevo: `supabase/migrations/<timestamp>_contacts_add_starred_tags.sql`
- Regenerado auto tras aprobar migración: `src/integrations/supabase/types.ts`
