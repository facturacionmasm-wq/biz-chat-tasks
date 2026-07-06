# Voice + Personality por tenant (agente de ElevenLabs)

Reutiliza el mismo patrón que ya funciona para `welcome_message`: campos en `settings_json`, guardado desde la pestaña Branding, push best-effort a `elevenlabs-staff-sync` al guardar. Sin tocar RLS, sin migraciones, sin cambiar aislamiento por tenant.

## A) Nueva edge function `elevenlabs-list-voices` (GET)

- Reutiliza `ELEVENLABS_API_KEY` (ya presente).
- Llama `GET https://api.elevenlabs.io/v1/voices` con header `xi-api-key`.
- Devuelve `{ voices: [{ voice_id, name, category, preview_url, labels }] }` (filtrado, no todo el payload).
- Cache en memoria del isolate 5 min (bandera `let cache: {ts, data}`).
- CORS estándar. Sin auth check (solo lee catálogo, no expone la key).

## B) `SettingsPage.tsx` — pestaña Branding, sección "Información de la empresa"

Debajo del textarea de `welcome_message`:

1. **Selector de voz** — nuevo estado `voiceId` + `voices` list.
   - `useEffect` al montar la pestaña: invoca `elevenlabs-list-voices`, popula `voices`.
   - `<Select>` de shadcn con búsqueda por `name`, cada opción muestra name + botón ▶ que reproduce `preview_url` con `new Audio()`.
   - Placeholder "Voz por defecto del agente" cuando `voiceId` es vacío.
2. **Textarea de personalidad** — nuevo estado `agentPersonality`.
   - `<Textarea>` label "Personalidad y tono del agente", `maxLength={800}`.
   - Helper: "Ej: 'Eres formal, empático, directo. Nunca uses jerga. Confirma cada acción antes de ejecutarla.'"
   - Placeholder con ejemplo.
3. **Hidratación** en el `useEffect` de carga de tenant (junto con `welcome_message`, línea ~167):
   ```ts
   setVoiceId(settings.voice_id ?? '');
   setAgentPersonality(settings.agent_personality ?? '');
   ```
4. **Save** en `handleSaveBranding` (línea 880-891), agregar al objeto `updated`:
   ```ts
   voice_id: voiceId || null,
   agent_personality: agentPersonality || null,
   ```
   El fire-and-forget de `elevenlabs-staff-sync` (línea 901) ya se dispara — no cambia.

## C) `elevenlabs-staff-sync/index.ts` — extender PATCH

1. **Leer settings_json** (línea 243-260): agregar extracción idempotente igual que `welcomeMessage`:
   ```ts
   let voiceId: string | null = null;
   let agentPersonality: string | null = null;
   const vid = (t?.settings_json as any)?.voice_id;
   if (vid && typeof vid === "string" && vid.trim()) voiceId = vid.trim();
   const ap = (t?.settings_json as any)?.agent_personality;
   if (ap && typeof ap === "string" && ap.trim()) agentPersonality = ap.trim();
   ```

2. **Nueva helper `upsertPersonalityBlock`** (copia exacta de `upsertStaffBlock`, línea ~85, con delimitadores propios):
   ```ts
   const PERSONALITY_START = "<!-- TENANT_PERSONALITY_START -->";
   const PERSONALITY_END = "<!-- TENANT_PERSONALITY_END -->";
   ```
   Bloque generado:
   ```
   <!-- TENANT_PERSONALITY_START -->
   PERSONALIDAD Y TONO:
   {agentPersonality}
   <!-- TENANT_PERSONALITY_END -->
   ```
   Encadenar en línea 311-312:
   ```ts
   let newPrompt = upsertStaffBlock(currentPrompt, newBlock);
   if (agentPersonality) newPrompt = upsertPersonalityBlock(newPrompt, personalityBlock);
   ```
   Si el tenant borra `agent_personality`, se puede opcionalmente strip del prompt (o dejar el último valor). MVP: si viene vacío, no tocamos ese bloque para no perder ediciones manuales del dashboard. Documentar en comentario.

3. **PATCH body** (línea 343-356), agregar rama `tts` sin romper la existente:
   ```ts
   const patchBody: any = {
     conversation_config: { agent: agentPatch },
   };
   if (voiceId) {
     patchBody.conversation_config.tts = {
       voice_id: voiceId,
       // model_id/stability/speed opcionales — omitir para heredar defaults del agente
     };
   }
   ```

4. **Audit payload** (línea 380), extender:
   ```ts
   payload: {
     members_count: members.length,
     departments: [...],
     welcome_message_updated: !!welcomeMessage,
     voice_updated: !!voiceId,
     personality_updated: !!agentPersonality,
   }
   ```

## Aislamiento por tenant

Sin cambios. El guard existente (línea 262-289) — tenants sin `elevenlabs_agent_id` propio hacen no-op excepto el master — se aplica igual a voice/personality. Nunca escribimos voz de un tenant en el agente de otro.

## Verificación

- `tsgo --noEmit` limpio.
- Deploy: `elevenlabs-staff-sync` + nueva `elevenlabs-list-voices`.
- Manual: en Branding elegir una voz + escribir personalidad + Guardar → verificar en dashboard ElevenLabs que `tts.voice_id` cambió y el prompt contiene el bloque TENANT_PERSONALITY, sin borrar STAFF_DIRECTORY.
- Llamar al número del tenant → confirmar cambio de voz + tono.

## Fuera de alcance

- No exponemos stability/speed/similarity_boost en UI (MVP). Se pueden agregar después como sliders avanzados.
- No cacheamos previews de audio en Storage — se reproducen directo desde el CDN de ElevenLabs.
- No tocamos RLS, migraciones, WhatsApp, Cal.com, ni otras edge functions.
