
Solo diagnóstico. No se modifica código.

## Problema 1 — Usuarios/contactos eliminados siguen apareciendo en Chat Interno

**Cómo se listan los miembros y canales hoy**
- `src/pages/ChatPage.tsx` L46-L67: `memberDirectory` sale de `profiles` filtrado por `.eq('status','active')`. Correcto: si el perfil se marca `inactive`, desaparece de "Usuarios".
- `src/hooks/useChatPersistence.ts`:
  - L96-L99: carga `chat_channels` filtrado solo por `tenant_id`, sin distinguir si el DM apunta a un perfil que ya no existe/está inactivo.
  - L18-L42 `getProfilesByUserId`: para mensajes no filtra por `status`, lo cual está OK (historial preserva nombre).
- `chat_channels` (RLS): SELECT `tenant_id = get_user_tenant_id(auth.uid())` (sin condición sobre miembros).
- No existe tabla `chat_channel_members`; los DMs se representan como filas `type='direct'` en `chat_channels` con `name = memberName` (ver `createDM` L281-L307 en `useChatPersistence.ts`).

**Causa raíz**
Cuando se elimina/desactiva un usuario:
1. Su perfil queda con `status != 'active'` (o borrado), por lo que se cae de la lista "Usuarios" — bien.
2. Pero los `chat_channels` `type='direct'` creados hacia ese usuario siguen en la BD sin ninguna referencia a `user_id`, así que la sidebar los sigue mostrando como DM huérfano.
3. Aún peor: `resolveDirectRecipient` en `ChatPage.tsx` L94-L104 hace match por `name`, así que si otro miembro tuviera el mismo nombre podría "heredar" el DM.

**Fix mínimo propuesto (sin aplicar)**
- Filtrar en `useChatPersistence.ts` (load, L96-L110) los canales `type='direct'` cuya contraparte ya no exista en `memberDirectory`. Como el DM no guarda `user_id`, dos opciones:
  a) **Opcional, mejor**: añadir columna `chat_channels.peer_user_id uuid` y usarla en `createDM` (L297) + filtrar en el load por `EXISTS profiles active`. Requiere migración pequeña.
  b) **Mínimo sin migración**: en el load, tras obtener `memberDirectory`, filtrar `channels.filter(c => c.type!=='direct' || memberDirectory.some(m => m.name === c.name))`. Se hace en `ChatPage.tsx` (o en el hook exponiendo `memberDirectory`). Simple pero frágil ante nombres duplicados.
- Además, opcional: cron/edge o trigger que marque `chat_channels` `type='direct'` cuyo peer quedó inactivo como `archived` para no volver a mostrarlos.

Archivos/líneas involucrados: `src/hooks/useChatPersistence.ts` L96-L189, `src/pages/ChatPage.tsx` L43-L67, L94-L104. Política RLS: `chat_channels` SELECT `Users can view channels in their tenant`.

---

## Problema 2 — Botones "Eliminar" y "Limpiar" del módulo WhatsApp no persisten

**Componentes y handler**
- Botón "Eliminar conversación" en `src/pages/WhatsAppInboxPage.tsx` L38-L40, L304, handler `handleDeleteConversation` L97-L112.
- El handler ejecuta desde el cliente:
  - L101: `supabase.from('whatsapp_messages').delete().eq('conversation_id', convId)`
  - L102: `supabase.from('whatsapp_conversations').delete().eq('id', convId)`
- No hay RPC/edge involucrado. No hay botón "Limpiar chat" en `WhatsAppInboxPage.tsx` ni en `MessageComposer.tsx` (búsqueda `rg` no encuentra `clear/limpiar/purge`).

**Causa raíz — RLS bloquea el DELETE en silencio**
Políticas actuales:
- `whatsapp_messages`: solo `SELECT (Tenant users can view wa messages)` y `INSERT (Staff can create wa messages)`. **No hay policy DELETE ni UPDATE.** Con RLS habilitado, `DELETE` desde `authenticated` no borra ninguna fila y no arroja error (0 filas afectadas → el `try` pasa y aparece el toast "Conversación eliminada", pero los mensajes siguen ahí).
- `whatsapp_conversations`: tiene `ALL (Staff can manage wa conversations)` con `tenant_id = get_user_tenant_id(auth.uid())`. El DELETE de la fila conversación sí procede… salvo que exista FK `whatsapp_messages.conversation_id → whatsapp_conversations(id)` sin `ON DELETE CASCADE`, en cuyo caso falla por violación de FK; si es CASCADE, borra la conv y sus mensajes en la BD por cascada (bypassea RLS de mensajes) — pero la UI ya intentó borrar mensajes antes y esa parte no aplicó.

Diagnóstico neto: el bug real es la ausencia de policy DELETE en `whatsapp_messages`; según la FK, el DELETE de la conversación además puede fallar o funcionar sólo por cascade sin feedback consistente.

Adicionalmente en L106 se muestra "Conversación eliminada" incluso si RLS filtró todas las filas (Supabase no lanza error por 0 rows) — el usuario cree que funcionó.

**Fix mínimo propuesto (sin aplicar)**
1. Migración: crear policies faltantes escoped a tenant y a rol staff/admin/owner:
   ```sql
   CREATE POLICY "Staff can delete wa messages" ON public.whatsapp_messages
     FOR DELETE TO authenticated
     USING (tenant_id = public.get_user_tenant_id(auth.uid()));
   -- (opcional UPDATE si se quiere marcar leído desde UI)
   ```
   La de `whatsapp_conversations` ya cubre DELETE vía `ALL`.
2. En `handleDeleteConversation` (L97-L112): tras cada `.delete()` chequear `error` **y** `count` (`.select('id', { count: 'exact', head: true })` previo o usar `returning`). Si count = 0, mostrar toast de error y NO cerrar el diálogo.
3. Si no hay "Limpiar chat" en UI y el usuario dice que sí existe, hay que localizar el botón (no está en el árbol actual). Sugerir revisar si es un componente aún no montado o si se refiere al mismo botón "Eliminar". Confirmar con el usuario.

Archivos/líneas: `src/pages/WhatsAppInboxPage.tsx` L97-L112 y L304. Políticas: `whatsapp_messages` (falta DELETE), `whatsapp_conversations` (ALL ya existe).

---

## Problema 3 — Aislamiento del Knowledge Hub por tenant en Voz y WhatsApp

**Modelo y RLS (correctos)**
- Tablas: `documents`, `document_chunks`, `knowledge_items` — todas tienen `tenant_id` y RLS por `tenant_id = get_user_tenant_id(auth.uid())` (ver policies listadas: `Tenant members can view documents`, `Tenant members view chunks`, `Tenant users can view knowledge`, más `Admins can manage documents/knowledge`).
- RPC `search_document_chunks(_tenant_id, _query, ...)` (definido en la BD) filtra internamente `WHERE dc.tenant_id = _tenant_id`.

**Bot de WhatsApp — OK**
- `supabase/functions/whatsapp-bot/ai-response.ts` L20-L38: ambos `knowledge_items` queries filtran `.eq('tenant_id', tenantId)`. El `tenantId` se resuelve en el webhook por `businessPhone` (número receptor) → tenant, y se propaga a la conversación.
- Historial: L48-L54 filtra `whatsapp_messages` por `conversation_id`, y la conversación está scoped por `tenant_id` en el webhook.
- `supabase/functions/document-search/index.ts` L30-L45, L94-L118: exige `tenant_id` (400 si falta) y filtra por él en `documents`, en la RPC y en el fallback ilike. Correcto.

**Voz (ElevenLabs) — FUGA CROSS-TENANT CONFIRMADA**
- `supabase/functions/elevenlabs-kb-sync/index.ts` L38-L39, L60, L83, L121: usa **un único `ELEVENLABS_AGENT_ID` global** (secreto de proyecto) para todas las operaciones `list/add/delete` de la KB del agente.
- Consecuencia: cuando un tenant sube un `knowledge_item` a la KB del agente de voz, se agrega al **mismo agente compartido por todos los tenants**. Cualquier llamada entrante/saliente que use ese agente puede recuperar contexto de cualquier tenant → mezcla de conocimiento entre inquilinos.
- Confirmación de que hay un solo agente:
  - `call-inbound-webhook/index.ts` L291, L378: `agent_id: ELEVENLABS_AGENT_ID` (global).
  - `elevenlabs-conversation-token/index.ts` L107: `?agent_id=${ELEVENLABS_AGENT_ID}` (global).
  - No hay lectura de un `agent_id` por tenant en ningún edge function.
- `elevenlabs-actions-webhook/index.ts` (tools del agente) no consulta `documents`/`knowledge_items` directamente; el conocimiento del agente vive dentro de la KB nativa de ElevenLabs — que hoy es única.

**Fix mínimo propuesto (sin aplicar, dos alternativas)**

A) Cortar la fuga sin rediseñar (rápido, seguro por defecto):
1. Deshabilitar/gate la ruta `add` en `elevenlabs-kb-sync/index.ts` L74-L114 mientras exista un único agente compartido: devolver 409 si `!tenant_has_dedicated_agent`. Así ningún nuevo doc contamina la KB compartida.
2. Ejecutar una limpieza única: llamar a `action:'delete'` para todos los `elevenlabs_doc_id` sincronizados hasta ahora (rastreables vía `audit_events.event_type = 'knowledge.synced_to_elevenlabs'`).
3. Documentar que la RAG por tenant se sirva **exclusivamente** vía `document-search` + `knowledge_items` desde tools del agente (ya scoped por `tenant_id` resuelto en `elevenlabs-actions-webhook/index.ts` L60-L72).

B) Solución definitiva (más trabajo, sin aplicar aquí):
1. Añadir columna `tenants.elevenlabs_agent_id text` (o dentro de `settings_json`).
2. Provisionar un agente ElevenLabs por tenant (o al menos por "voice profile") y usarlo en `kb-sync`, `conversation-token`, `call-inbound-webhook`.
3. Cambiar `elevenlabs-kb-sync/index.ts` L60/L83/L121 para leer `agent_id` desde `tenants` según `data.tenant_id` (y validar que quien llama pertenece al tenant vía JWT L31-L37).

**Verificación en WhatsApp/RAG por tenant (todo OK):**
- `document-search/index.ts` L32-L34, L44, L94-L98, L112: `tenant_id` obligatorio y aplicado.
- `whatsapp-bot/ai-response.ts` L22-L36: `tenant_id` aplicado en ambas queries.
- RLS de `documents`, `document_chunks`, `knowledge_items`: correcto (todas restringen por `tenant_id`).

---

## Resumen de acciones (para aprobar luego)

| # | Fix mínimo | Archivos | Riesgo |
|---|---|---|---|
| 1 | Filtrar DMs cuyo peer ya no está `active` | `src/hooks/useChatPersistence.ts`, `src/pages/ChatPage.tsx` | Bajo |
| 2 | Añadir policy `DELETE` en `whatsapp_messages` + validar count en handler | migración SQL + `WhatsAppInboxPage.tsx` L97-L112 | Bajo |
| 3 | Gate la sincronización a KB de ElevenLabs global y purgar docs ya subidos; plan a mediano plazo para agente-por-tenant | `elevenlabs-kb-sync/index.ts` L74-L135 (+ tabla `tenants`) | Medio |

Confírmame cuáles aplicar y paso a Build.
