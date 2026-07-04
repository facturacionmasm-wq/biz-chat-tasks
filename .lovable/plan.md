## Rotar `ELEVENLABS_WEBHOOK_SECRET`

Objetivo: generar un valor nuevo aleatorio y mostrártelo una sola vez para que lo pegues en el panel de ElevenLabs (Agent → Tools → Server-side Webhook → Header `x-elevenlabs-secret`).

### Pasos
1. `delete_secret` sobre `ELEVENLABS_WEBHOOK_SECRET` (necesario porque `generate_secret` no sobreescribe secretos existentes).
2. `generate_secret` con `name: ELEVENLABS_WEBHOOK_SECRET`, `length: 48` (alfanumérico, suficientemente fuerte para un shared secret HTTP).
3. Mostrarte el nuevo valor en el chat, una sola vez.
4. No se toca código. La función `elevenlabs-actions-webhook` ya lee `Deno.env.get('ELEVENLABS_WEBHOOK_SECRET')` en cada request, así que toma el nuevo valor automáticamente sin redeploy.

### Impacto / ventana de corte
- Entre el paso 2 y el momento en que actualices el header en ElevenLabs, cualquier tool call entrante de ElevenLabs recibirá **401 Unauthorized** desde `elevenlabs-actions-webhook`. Ten la pestaña de ElevenLabs abierta y lista para pegar.
- No afecta: `call-transfer`, `call-transfer-twiml`, `elevenlabs-post-call`, WhatsApp, ni el gate de suscripciones.

### Archivos tocados
Ninguno. Solo cambio de secreto en Lovable Cloud.

¿Confirmas para ejecutar?
