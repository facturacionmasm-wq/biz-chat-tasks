
## Hechos del análisis (respuestas a tus 4 preguntas)

### (1) ¿Dónde vive hoy el `first_message`?

**No existe en nuestro código.** Búsqueda exhaustiva en `supabase/functions/` y `src/`: cero coincidencias de `first_message` / `firstMessage` / "primer mensaje del agente".

El PATCH que hace `elevenlabs-staff-sync/index.ts` (líneas 338‑356) solo toca `conversation_config.agent.prompt.prompt` y `conversation_config.agent.prompt.tools`:

```ts
const patchBody = {
  conversation_config: {
    agent: {
      prompt: {
        prompt: newPrompt,
        tools: nextTools,
      },
    },
  },
};
```

Conclusión: el "¡Hola! te estás comunicando a RYBIX holding llc…" vive **directamente en la config del agente en el dashboard de ElevenLabs** (`conversation_config.agent.first_message`). Nunca lo escribimos desde aquí, por eso es global y no por-tenant.

### (2) `settings_json` — cómo se actualiza hoy

Campos conocidos hoy: `phone, slogan, address, website, logo_url, favicon_url, primary_color, secondary_color, timezone, elevenlabs_agent_id, verified_caller_ids, subscription, stripe`.

Es un `jsonb` libre — **agregar `welcome_message` no rompe nada** (patrón spread `{...current, nuevo_campo}` ya usado en `handleSaveBranding` líneas 872‑900, `BillingSection.tsx` 168‑177, `twilio-verify-caller-id`).

Patrón de save desde el frontend (no hay edge function intermedia para settings de tenant):

```ts
const { data: tenant } = await supabase.from('tenants').select('settings_json').eq('id', tenantId).maybeSingle();
const updated = { ...(tenant?.settings_json || {}), welcome_message: value };
await supabase.from('tenants').update({ settings_json: updated }).eq('id', tenantId);
```

### (3) Pestañas de `SettingsPage.tsx` y dónde encaja

Secciones registradas (líneas 27‑36):
`profile · drive · general · branding · team · billing · ai`.

- **`branding`** (líneas 1252‑1380): guarda `slogan, website, phone, address, colors, logo, favicon` vía `handleSaveBranding` (876‑900). Bloque de "Información de la empresa".
- **`ai`** (líneas 1714‑1737): actualmente solo tiene toggles decorativos hardcodeados, **sin persistencia real**.

**Recomendación:** ponerlo en **`branding`**, en la sección "Información de la empresa" (después de dirección) como campo `<textarea>` "Mensaje de bienvenida del agente de voz", e incluir `welcome_message` en el objeto `updated` de `handleSaveBranding`. Es la pestaña que ya guarda contenido corporativo customizable por tenant y que ya persiste en `settings_json`.

Alternativa: pestaña `ai` — pero requeriría montar todo el patrón de save desde cero y hoy no tiene inputs reales.

### (4) ¿Existe UI de agente de voz que reutilizar?

**No.** Grepeando `first_message|firstMessage|welcome|voice.*agent.*message` en `src/` no hay ningún input relacionado con mensajes del agente. `VoiceAgentWizard.tsx` es setup técnico (Twilio number → ElevenLabs), no editor de guión.

---

## Plan de implementación (2 archivos)

### A) `src/pages/SettingsPage.tsx` — pestaña Branding
1. Agregar estado `const [welcomeMessage, setWelcomeMessage] = useState('')`.
2. Hidratarlo en el `useEffect` de carga de tenant (línea ~161) desde `settings.welcome_message ?? ''`.
3. Renderizar `<textarea>` nuevo dentro del bloque "Información de la empresa" (~línea 1340), con label "Mensaje de bienvenida del agente de voz", placeholder de ejemplo, `maxLength={500}` y helper text: "Es lo primero que dice el agente al contestar una llamada".
4. Añadir `welcome_message: welcomeMessage` al objeto `updated` en `handleSaveBranding` (línea 878‑888).

### B) `supabase/functions/elevenlabs-staff-sync/index.ts` — push al agente
1. Después de cargar `settings_json` para resolver `agent_id` (líneas ~245‑254), extraer también `welcome_message`:
   ```ts
   const welcomeMessage = (t?.settings_json as any)?.welcome_message?.trim() || null;
   ```
2. En el `patchBody` (líneas 338‑349), añadir `first_message` solo si viene definido:
   ```ts
   const agentPatch: any = { prompt: { prompt: newPrompt, tools: nextTools } };
   if (welcomeMessage) agentPatch.first_message = welcomeMessage;
   const patchBody = { conversation_config: { agent: agentPatch } };
   ```
3. Loguear en el `audit_events` payload el flag `welcome_message_updated: !!welcomeMessage`.

**Sin tocar:** RLS, `handle_new_user`, WhatsApp, Cal.com, ni otras edge functions. Sin borrar datos. El guard de aislamiento por tenant (master vs. otros) ya en vigor sigue siendo respetado — solo tenants con `elevenlabs_agent_id` propio (o el master) reciben el push del `first_message`.

### Verificación posterior
- `tsgo --noEmit` limpio.
- Deploy solo de `elevenlabs-staff-sync`.
- Manual: guardar un mensaje en Branding → invocar staff-sync (ya lo dispara `handleSaveBranding`? verificar; si no, se dispara al invitar miembro) → confirmar en dashboard ElevenLabs que `first_message` se actualizó.
