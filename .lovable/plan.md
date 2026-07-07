
## Hallazgos (solo lectura)

### 1) Menú de opciones por cita (vista Lista)
- Archivo: `src/pages/AppointmentsPage.tsx`
- Render del bloque Lista: L601–L678
- Dropdown de acciones por cita: L629–L660
  - L634 Editar
  - L639 Confirmar (si `status !== 'confirmed'`)
  - L644 Completar (si `status !== 'completed'`)
  - L649 No asistió (si `status !== 'no_show'`)
  - **L654–L658 ya existe una opción "Cancelar"** (roja, con icono `XCircle`), oculta cuando `status === 'cancelled'`, que abre `showDeleteDialog` y llama a `handleCancel` (L714–L726, handler en L304–L329).

Conclusión de causa: **la opción "Cancelar cita" ya está implementada**, pero:
- Se oculta cuando la cita ya está en `cancelled` (por eso puede parecer que "no está" al inspeccionar una cita cancelada).
- No existe una opción de **borrado real** (`DELETE`).
- El label del diálogo dice "cancelar cita" (soft, cambia `status='cancelled'`), sin opción destructiva dura.

### 2) Tabla `appointments` – estados y RLS
- Columna `status` usada en el código: `scheduled | confirmed | completed | no_show | cancelled` (ver `statusConfig` L70–L76 y filtros L468).
- Políticas RLS actuales (verificadas en DB):
  - `Staff can manage appointments` → `FOR ALL USING (tenant_id = get_user_tenant_id(auth.uid()))` → **UPDATE y DELETE permitidos** para cualquier miembro del tenant.
  - `Tenant users can view appointments` → `FOR SELECT` mismo predicado.
- No hay restricción de rol (staff/owner/admin) para DELETE; basta con pertenecer al tenant. Aislamiento por `tenant_id` garantizado por RLS.

### 3) Patrón actual de cambio de estado
- `handleStatusChange(apt, newStatus)` L332–L349:
  - `update({ status: newStatus }).eq('id', apt.id)` (RLS filtra por tenant).
  - Si `newStatus === 'cancelled' && apt.calendarEventId` → `triggerCalendarSync(apt.id, 'cancel_event')` (L341–L343).
- `handleCancel()` L304–L329: mismo update a `cancelled` + `triggerCalendarSync(..., 'cancel_event')` (L316–L318) + toast + cierra diálogo.
- Sync calendario: `triggerCalendarSync` L351–L362 invoca edge `calendar-sync` con acción `cancel_event`. No hay llamada directa a Cal.com desde el front; Cal.com se maneja server-side por el flujo de sincronización existente. Nada tocaría `pin-service`.

### 4) ¿Existe otra vía para cancelar?
- Sí: `handleCancel` (L304) via diálogo `showDeleteDialog` (L714–L726) — la misma pieza del menú.
- Vista Calendario (semana) L560–L598 solo permite abrir/edit; no tiene menú de acciones (fuera de alcance).
- Cal.com y `voice-scheduling` cancelan del lado del bot / edge; no duplica al del front.

---

## Fix mínimo propuesto (sin aplicar)

Único archivo a modificar: `src/pages/AppointmentsPage.tsx`.

### A) Aclarar/mantener "Cancelar cita" (soft)
- Ya existe (L654–L658). No requiere cambios funcionales.
- Opcional cosmético: mostrar el ítem también cuando `status==='cancelled'` deshabilitado, o dejarlo tal cual. **Recomendado: dejar tal cual** para preservar comportamiento.

### B) Añadir "Eliminar cita" (hard delete)
- Insertar un nuevo `DropdownMenuItem` justo después de L657, dentro del mismo `DropdownMenuContent`:
  - Label: "Eliminar cita" (icono `Trash2`, clase roja).
  - onClick: abre un **segundo diálogo de confirmación** (nuevo estado `showHardDeleteDialog`) explicando que la acción es irreversible.
- Nuevo handler `handleHardDelete` (a colocar junto a `handleCancel` ~L304):
  1. Si `apt.calendarEventId` → `triggerCalendarSync(apt.id, 'cancel_event')` primero (para no dejar el evento huérfano en el calendario / Cal.com que ya escucha ese action).
  2. `await supabase.from('appointments').delete().eq('id', apt.id)` (RLS filtra por tenant, ya validada).
  3. Toast "Cita eliminada" + cerrar diálogo + limpiar `selectedAppointment`.
  4. Manejo de error idéntico al patrón existente (`toast.error(err.message || ...)`).
- Nuevo `Dialog` clonando el patrón de L714–L726, apuntando a `showHardDeleteDialog` y botón destructive → `handleHardDelete`.

### C) Estados y estilo
- Añadir `const [showHardDeleteDialog, setShowHardDeleteDialog] = useState(false);` cerca de L100.
- Importar `Trash2` de `lucide-react` (ya se importan otros iconos del mismo paquete).

### D) Consideraciones de integridad
- No tocar RLS (ya lo permite).
- No tocar `pin-service`, prompts, ni webhook de Stripe.
- Preservar sync de calendario invocando `cancel_event` **antes** del delete para que Cal.com/Google borren el evento; si falla el sync no bloquear el delete (fire-and-forget, mismo patrón que hoy).
- Vista Calendario no requiere cambios.

### Resumen de edición
```text
src/pages/AppointmentsPage.tsx
  ~L100  + useState showHardDeleteDialog
  ~L304  + handleHardDelete (delete real + sync calendario previo)
  ~L657  + DropdownMenuItem "Eliminar cita" (icono Trash2)
  ~L726  + Dialog de confirmación destructiva para hard delete
```

No se requieren migraciones, cambios en edge functions ni en RLS.
