import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * ElevenLabs Media Stream Bridge
 *
 * Twilio <Connect><Stream> -> this bridge (WebSocket) -> ElevenLabs signed WebSocket URL
 *
 * Query params expected:
 * - target: ElevenLabs signed WebSocket URL
 * - callSid: Twilio CallSid (for traceability)
 * - tenantId: Tenant id (for traceability)
 * - exp: Unix expiration timestamp
 * - sig: Optional HMAC-SHA256 signature from inbound webhook
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const upgrade = req.headers.get('upgrade')?.toLowerCase();
  if (upgrade !== 'websocket') {
    return new Response('Expected websocket upgrade', { status: 426, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const target = url.searchParams.get('target') || '';
    const callSid = url.searchParams.get('callSid') || 'unknown';
    const tenantId = url.searchParams.get('tenantId') || 'unknown';
    const exp = Number(url.searchParams.get('exp') || '0');
    const sig = url.searchParams.get('sig') || '';
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN') || '';

    if (!target || !target.startsWith('wss://')) {
      return new Response('Invalid target', { status: 400, headers: corsHeaders });
    }

    const targetHost = new URL(target).hostname;
    if (!targetHost.endsWith('elevenlabs.io')) {
      return new Response('Target host not allowed', { status: 400, headers: corsHeaders });
    }

    if (!exp || Number.isNaN(exp) || exp < Math.floor(Date.now() / 1000)) {
      return new Response('Expired bridge URL', { status: 401, headers: corsHeaders });
    }

    if (twilioAuthToken) {
      if (!sig) {
        return new Response('Missing bridge signature', { status: 401, headers: corsHeaders });
      }
      const payload = `${callSid}.${tenantId}.${exp}.${target}`;
      const expectedSig = await signBridgeToken(twilioAuthToken, payload);
      if (!constantTimeEqual(sig, expectedSig)) {
        return new Response('Invalid bridge signature', { status: 401, headers: corsHeaders });
      }
    }

    const { socket: twilioSocket, response } = Deno.upgradeWebSocket(req);

    console.log(`[bridge] WS handshake OK callSid=${callSid} tenant=${tenantId}`);

    let elevenSocket: WebSocket | null = null;
    let twilioStreamSid: string | null = null;
    let elevenOpen = false;

    const cleanup = (reason: string) => {
      console.log(`[bridge] cleanup callSid=${callSid} reason=${reason}`);
      try {
        if (twilioSocket.readyState === WebSocket.OPEN || twilioSocket.readyState === WebSocket.CONNECTING) {
          twilioSocket.close(1000, reason);
        }
      } catch (_) {}
      try {
        if (elevenSocket && (elevenSocket.readyState === WebSocket.OPEN || elevenSocket.readyState === WebSocket.CONNECTING)) {
          elevenSocket.close(1000, reason);
        }
      } catch (_) {}
    };

    const connectEleven = () => {
      console.log(`[bridge] connecting to ElevenLabs callSid=${callSid}`);
      elevenSocket = new WebSocket(target);

      elevenSocket.onopen = () => {
        elevenOpen = true;
        console.log(`[bridge] ElevenLabs WS connected callSid=${callSid}`);
      };

      elevenSocket.onmessage = (event) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : '';
          if (!raw) return;

          // Proxy as-is first (for register-call native Twilio messages).
          if (twilioSocket.readyState === WebSocket.OPEN) {
            twilioSocket.send(raw);
          }

          // Also attempt optional translation when ElevenLabs emits explicit audio events.
          try {
            const parsed = JSON.parse(raw);
            const maybeAudio = parsed?.audio_event?.audio_base_64 || parsed?.audio?.chunk || parsed?.audio;
            if (maybeAudio && twilioStreamSid && twilioSocket.readyState === WebSocket.OPEN) {
              twilioSocket.send(JSON.stringify({
                event: 'media',
                streamSid: twilioStreamSid,
                media: { payload: String(maybeAudio) },
              }));
            }
          } catch (_) {
            // Non-JSON or unknown payload, already proxied as-is.
          }
        } catch (err) {
          console.error(`[bridge] Eleven->Twilio proxy error callSid=${callSid}:`, err);
        }
      };

      elevenSocket.onerror = (event) => {
        console.error(`[bridge] ElevenLabs WS error callSid=${callSid}:`, event);
        cleanup('elevenlabs_error');
      };

      elevenSocket.onclose = (event) => {
        elevenOpen = false;
        console.log(`[bridge] ElevenLabs WS closed callSid=${callSid} code=${event.code} reason=${event.reason}`);
        cleanup('elevenlabs_closed');
      };
    };

    twilioSocket.onopen = () => {
      connectEleven();
    };

    twilioSocket.onmessage = (event) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : '';
        if (!raw) return;

        // Parse for observability + fallback translation if needed.
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.event === 'start') {
            twilioStreamSid = parsed?.start?.streamSid || twilioStreamSid;
            console.log(`[bridge] Twilio stream started callSid=${callSid} streamSid=${twilioStreamSid}`);
          }
          if (parsed?.event === 'stop') {
            console.log(`[bridge] Twilio stream stop callSid=${callSid}`);
          }

          // If Eleven endpoint expects explicit user_audio_chunk protocol, send translated chunk too.
          if (parsed?.event === 'media' && parsed?.media?.payload && elevenSocket?.readyState === WebSocket.OPEN) {
            elevenSocket.send(JSON.stringify({ user_audio_chunk: parsed.media.payload }));
          }
        } catch (_) {
          // Non-JSON from Twilio; continue proxying.
        }

        if (elevenOpen && elevenSocket?.readyState === WebSocket.OPEN) {
          elevenSocket.send(raw);
        }
      } catch (err) {
        console.error(`[bridge] Twilio->Eleven proxy error callSid=${callSid}:`, err);
      }
    };

    twilioSocket.onerror = (event) => {
      console.error(`[bridge] Twilio WS error callSid=${callSid}:`, event);
      cleanup('twilio_error');
    };

    twilioSocket.onclose = (event) => {
      console.log(`[bridge] Twilio WS closed callSid=${callSid} code=${event.code} reason=${event.reason}`);
      cleanup('twilio_closed');
    };

    return response;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[bridge] Fatal error:', msg);
    return new Response(msg, {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
    });
  }
});

async function signBridgeToken(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}
