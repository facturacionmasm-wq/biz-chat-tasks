# Fix OKRs — Opción A (solo cliente, cero cambios en BD)

**Archivo único a modificar:** `src/pages/OKRsPage.tsx`
Sin migraciones, sin tocar seguridad, RLS, funciones protegidas ni ElevenLabs.

---

## Cambios exactos

### 1) `fetchOKRs` — select (líneas 65–75)

**Antes:**
```ts
const { data: okrData, error } = await (supabase as any)
  .from('projects')
  .select(`
    id, name, description, status, created_at,
    project_milestones ( id, title, description, progress, due_date )
  `)
  .eq('tenant_id', tid)
  .eq('type', 'okr')
  .is('deleted_at', null)
  .order('created_at', { ascending: false });
```

**Después:**
```ts
const { data: okrData, error } = await supabase
  .from('projects')
  .select(`
    id, name, description, status, created_at,
    project_milestones ( id, name, target_date, completed )
  `)
  .eq('tenant_id', tid)
  .order('created_at', { ascending: false });
```
- Se eliminan `.eq('type','okr')` y `.is('deleted_at', null)` (columnas inexistentes).
- Subselect usa columnas reales: `id, name, target_date, completed`.
- Se quita el cast `as any` porque ahora las columnas existen en `types.ts`.

### 2) `fetchOKRs` — map (líneas 82–107)

**Antes:**
```ts
const krs: KeyResult[] = (p.project_milestones || []).map((m: any) => ({
  id: m.id,
  title: m.title,
  current_value: m.progress || 0,
  target_value: 100,
  unit: '%',
  progress: m.progress || 0,
}));
const avgProgress = krs.length > 0
  ? Math.round(krs.reduce((s, k) => s + k.progress, 0) / krs.length)
  : 0;
```

**Después:**
```ts
const krs: KeyResult[] = (p.project_milestones || []).map((m: any) => ({
  id: m.id,
  title: m.name,                                   // name → title en UI
  current_value: m.completed ? 100 : 0,
  target_value: 100,
  unit: '%',
  progress: m.completed ? 100 : 0,                 // completed → progress binario
}));
const avgProgress = krs.length > 0
  ? Math.round(krs.reduce((s, k) => s + k.progress, 0) / krs.length)
  : 0;                                             // ratio completados/total (0 o 100 promediado)
```
- `title` viene de `m.name`.
- `progress` derivado de `completed` (100 si true, 0 si false).
- `avgProgress` sigue siendo el promedio → equivale al ratio `completados/total × 100`.
- `target_date` no se usa en el render actual, así que no requiere mapeo (queda disponible por si el UI lo agrega luego).

### 3) `handleCreate` — insert (líneas 127–139)

**Antes:**
```ts
.insert({
  tenant_id: tenantId,
  name: form.title.trim(),
  description: form.description.trim() || null,
  status: 'active',
  type: 'okr',
  created_by: user.id,
})
```

**Después:**
```ts
.insert({
  tenant_id: tenantId,
  name: form.title.trim(),
  description: form.description.trim() || null,
  status: 'active',
  created_by: user.id,
})
```
- Se elimina `type: 'okr'` (columna inexistente).
- Nota funcional: sin discriminador, el "OKR" creado aparecerá también en la lista de Proyectos. Aceptable en Opción A.

### 4) `handleDelete` — update (líneas 152–160)

**Antes:**
```ts
const { error } = await supabase
  .from('projects')
  .update({ deleted_at: new Date().toISOString(), status: 'archived' })
  .eq('id', id)
  .eq('tenant_id', tenantId);
```

**Después (delete real):**
```ts
const { error } = await supabase
  .from('projects')
  .delete()
  .eq('id', id)
  .eq('tenant_id', tenantId);
```
- Elimina definitivamente el proyecto/OKR.
- `project_milestones` y `project_tasks` tienen `ON DELETE CASCADE` en su FK a `projects` → se limpian automáticamente sin dejar huérfanos.
- Sin `deleted_at` (columna inexistente) ni `status: 'archived'` (viola el check-constraint que solo acepta `planning|active|completed|on_hold`).

---

## Verificación post-fix

1. `/okrs` carga sin warning en consola.
2. La lista muestra los proyectos del tenant como OKRs; cada milestone completado suma 100 al promedio.
3. "Nuevo OKR" crea sin error rojo.
4. "Eliminar" borra sin toast rojo, y la fila desaparece.
5. Consola sin `[OKRs] table/column not found`.
6. `tsgo --noEmit` sigue limpio.

## No-regresión confirmada

- **BD:** cero migraciones, cero cambios de RLS/GRANT.
- **Otros archivos:** no se tocan. `useProjectsPersistence` sigue leyendo `name`/`target_date`/`completed` como hoy → Proyectos y Kanban intactos.
- **Seguridad reciente** (`profiles`, `google_calendar_tokens`): sin cambios.
- **Funciones protegidas / ElevenLabs / WhatsApp / Twilio / Voice / PIN / Cal.com:** sin cambios.
