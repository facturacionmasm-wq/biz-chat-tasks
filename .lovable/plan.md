## Corrección Bug A + Bug B

### Bug A — `invite-member` no crea el profile del invitado

**Archivo**: `supabase/functions/invite-member/index.ts` (líneas ~120-160).

**Cambios**:
1. Eliminar el bloque que asume que `handle_new_user` creó un profile/tenant auto (lectura de `autoProfile`, borrado de `auto role`, borrado de `tenants` auto). Ya no aplica: en la práctica no se crean por el orden interno del trigger + `EXCEPTION WHEN OTHERS`.
2. **Invertir el orden**: primero `upsert` en `user_roles` (staff en `targetTenantId`), después `upsert` en `profiles`. Esto satisface el trigger `prevent_profile_tenant_change`, que exige membership previa para insertar profile.
3. Reemplazar el `.update()` sobre `profiles` por un **`.upsert()`** con `onConflict: 'user_id'` insertando: `user_id: newUserId, tenant_id: targetTenantId, email, name, department, status: 'pending_approval', onboarding_completed: true`. Chequear el `error` y devolver 500 con mensaje claro si falla (hoy es silencioso).
4. Log explícito de éxito/fracaso de cada paso (`[invite-member] profile upsert ok / role upsert ok`).

**No se toca**: guardas de autorización, resolución de `targetTenantId` (fix previo), creación de `auth.users`, `availability_rules`, disparo de `elevenlabs-staff-sync`, RLS, `handle_new_user`, WhatsApp, Cal.com.

### Bug B — `elevenlabs-staff-sync` falla con 400 en `tools[17].webhook.api_schema.request_headers`

**Archivo**: `supabase/functions/elevenlabs-staff-sync/index.ts`.

**Cambios**:
1. Antes de hacer `PATCH` al agente, si el payload incluye `conversation_config.agent.prompt.tools`, normalizar **cada tool**:
   - Si `tool.webhook?.api_schema?.request_headers` es `null`, `undefined`, array o cualquier no-objeto → convertirlo a `{}`.
   - Aplicar la misma normalización defensiva a `query_params_schema.properties` y `path_params_schema.properties` si aparecen como no-dict.
2. Log claro del número de tools normalizadas: `[elevenlabs-staff-sync] normalized N tool headers`.
3. Mantener el manejo de error actual (ya loguea el body 400 completo). No cambiar el resto del flujo.

**No se toca**: cómo se construye el bloque `STAFF_DIRECTORY`, cómo se resuelve el `agent_id`, autenticación con `xi-api-key`, el resto del prompt del agente ni sus voice settings.

### Verificación
- `tsgo --noEmit` limpio.
- Deploy limpio de `invite-member` y `elevenlabs-staff-sync`.
- Prueba manual sugerida (tú la ejecutas): invitar a un tercer usuario de prueba y confirmar:
  - Aparece fila en `profiles` con `department` y `status='pending_approval'`.
  - `list_status` lo devuelve.
  - Logs de `elevenlabs-staff-sync` muestran `members=3` y **200 OK** (sin 400).

### Archivos
- **Modifica**: `supabase/functions/invite-member/index.ts`
- **Modifica**: `supabase/functions/elevenlabs-staff-sync/index.ts`
- **No crea migraciones**, **no toca** RLS, `handle_new_user`, WhatsApp, Cal.com, `team-management`.
