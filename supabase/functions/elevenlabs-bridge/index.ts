import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

/**
 * ElevenLabs Media Stream Bridge — Production Grade
 *
 * Twilio <Connect><Stream> → this bridge (WebSocket) → ElevenLabs WebSocket
 *
 * Features:
 * - Bidirectional audio proxy (Twilio μ-law ↔ ElevenLabs)
 * - HMAC-SHA256 signed URL validation
 * - Structured logging to voice_call_logs table
 * - One retry on ElevenLabs connection failure
 * - Graceful cleanup on disconnect
 * - Keepalive ping/pong handling
 * - Stateless — no global memory
 *
 * Query params:
 * - target: ElevenLabs signed WebSocket URL
 * - callSid: Twilio CallSid
 * - tenantId: Tenant UUID
 * - exp: Unix timestamp expiration
 * - sig: HMAC-SHA256 signature
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, upgrade, connection, sec-websocket-key, sec-websocket-version, sec-websocket-extensions, sec-websocket-protocol',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only accept WebSocket upgrades
  const upgrade = req.headers.get('upgrade')?.toLowerCase();
  if (upgrade !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const target = url.searchParams.get('target') || '';
  const callSid = url.searchParams.get('callSid') || 'unknown';
  const tenantId = url.searchParams.get('tenantId') || 'unknown';
  const exp = Number(url.searchParams.get('exp') || '0');
  const sig = url.searchParams.get('sig') || '';
  const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN') || '';

  // ═══════════ SUPABASE CLIENT FOR LOGGING ═══════════
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Fire-and-forget structured log helper
  const logStage = (stage: string, errorCode?: string, errorMessage?: string, metadata?: Record<string, unknown>) => {
    supabase.from('voice_call_logs').insert({
      call_sid: callSid,
      tenant_id: tenantId !== 'unknown' ? tenantId : null,
      stage,
      error_code: errorCode || null,
      error_message: errorMessage || null,
      metadata: metadata || {},
    }).then(({ error }) => {
      if (error) console.error(`[bridge] log insert error: ${error.message}`);
    });
  };

  // ═══════════ VALIDATION ═══════════
  if (!target || !target.startsWith('wss://')) {
    logStage('handshake_failed', 'INVALID_TARGET', 'Missing or non-wss target URL');
    return new Response('Invalid target', { status: 400, headers: corsHeaders });
  }

  try {
    const targetHost = new URL(target).hostname;
    if (!targetHost.endsWith('elevenlabs.io')) {
      logStage('handshake_failed', 'INVALID_HOST', `Host ${targetHost} not allowed`);
      return new Response('Target host not allowed', { status: 400, headers: corsHeaders });
    }
  } catch {
    logStage('handshake_failed', 'INVALID_URL', 'Cannot parse target URL');
    return new Response('Invalid target URL', { status: 400, headers: corsHeaders });
  }

  if (!exp || Number.isNaN(exp) || exp < Math.floor(Date.now() / 1000)) {
    logStage('handshake_failed', 'EXPIRED', `Token expired at ${exp}`);
    return new Response('Expired bridge URL', { status: 401, headers: corsHeaders });
  }

  if (twilioAuthToken) {
    if (!sig) {
      logStage('handshake_failed', 'NO_SIGNATURE', 'Missing bridge signature');
      return new Response('Missing bridge signature', { status: 401, headers: corsHeaders });
    }
    const payload = `${callSid}.${tenantId}.${exp}.${target}`;
    const expectedSig = await signBridgeToken(twilioAuthToken, payload);
    if (!constantTimeEqual(sig, expectedSig)) {
      logStage('handshake_failed', 'INVALID_SIGNATURE', 'Signature mismatch');
      return new Response('Invalid bridge signature', { status: 401, headers: corsHeaders });
    }
  }

  // ═══════════ WEBSOCKET UPGRADE ═══════════
  const { socket: twilioSocket, response } = Deno.upgradeWebSocket(req);

  logStage('handshake_ok', undefined, undefined, { target: target.substring(0, 100) });
  console.log(`[bridge] WS handshake OK callSid=${callSid} tenant=${tenantId}`);

  // ═══════════ SESSION STATE (scoped to this connection) ═══════════
  let elevenSocket: WebSocket | null = null;
  let elevenOpen = false;
  let twilioStreamSid: string | null = null;
  let cleaned = false;
  let reconnectAttempted = false;
  let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

  const cleanup = (reason: string) => {
    if (cleaned) return;
    cleaned = true;
    console.log(`[bridge] cleanup callSid=${callSid} reason=${reason}`);
    logStage('ws_closed', undefined, reason, { streamSid: twilioStreamSid });

    if (keepaliveInterval) {
      clearInterval(keepaliveInterval);
      keepaliveInterval = null;
    }

    try {
      if (twilioSocket.readyState === WebSocket.OPEN) twilioSocket.close(1000, reason);
    } catch (_) { /* ignore */ }
    try {
      if (elevenSocket && elevenSocket.readyState === WebSocket.OPEN) elevenSocket.close(1000, reason);
    } catch (_) { /* ignore */ }
  };

  // ═══════════ ELEVENLABS CONNECTION ═══════════
  const connectElevenLabs = (isRetry = false) => {
    const label = isRetry ? 'retry' : 'initial';
    console.log(`[bridge] connecting ElevenLabs (${label}) callSid=${callSid}`);
    logStage(isRetry ? 'elevenlabs_reconnecting' : 'elevenlabs_connecting');

    elevenSocket = new WebSocket(target);

    elevenSocket.onopen = () => {
      elevenOpen = true;
      console.log(`[bridge] ElevenLabs connected (${label}) callSid=${callSid}`);
      logStage('elevenlabs_connected', undefined, undefined, { retry: isRetry });

      // Start keepalive pings every 15s
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      keepaliveInterval = setInterval(() => {
        try {
          if (elevenSocket?.readyState === WebSocket.OPEN) {
            elevenSocket.send(JSON.stringify({ type: 'ping' }));
          }
        } catch (_) { /* ignore */ }
      }, 15_000);
    };

    elevenSocket.onmessage = (event) => {
      try {
        if (twilioSocket.readyState !== WebSocket.OPEN) return;

        const raw = typeof event.data === 'string' ? event.data : '';
        if (!raw) return;

        // The register-call API already wires ElevenLabs to speak Twilio protocol.
        // So we proxy messages as-is. ElevenLabs sends proper Twilio media events.
        twilioSocket.send(raw);
      } catch (err) {
        console.error(`[bridge] EL→TW proxy error callSid=${callSid}:`, err);
      }
    };

    elevenSocket.onerror = (event) => {
      console.error(`[bridge] ElevenLabs WS error (${label}) callSid=${callSid}:`, event);
      logStage('elevenlabs_error', 'WS_ERROR', `ElevenLabs error during ${label}`);
    };

    elevenSocket.onclose = (event) => {
      elevenOpen = false;
      const reason = `code=${event.code} reason=${event.reason || 'none'}`;
      console.log(`[bridge] ElevenLabs closed (${label}) callSid=${callSid} ${reason}`);
      logStage('elevenlabs_closed', String(event.code), event.reason || 'closed', { retry: isRetry });

      // Single retry attempt
      if (!reconnectAttempted && !cleaned && twilioSocket.readyState === WebSocket.OPEN) {
        reconnectAttempted = true;
        console.log(`[bridge] Attempting reconnect callSid=${callSid}`);
        logStage('elevenlabs_retry');
        setTimeout(() => {
          if (!cleaned && twilioSocket.readyState === WebSocket.OPEN) {
            connectElevenLabs(true);
          }
        }, 500);
      } else if (!cleaned) {
        // Send fallback message via Twilio clear message
        logStage('fallback_triggered', 'ELEVENLABS_UNAVAILABLE', 'All connection attempts exhausted');
        cleanup('elevenlabs_final_close');
      }
    };
  };

  // ═══════════ TWILIO SOCKET HANDLERS ═══════════
  twilioSocket.onopen = () => {
    console.log(`[bridge] Twilio WS open callSid=${callSid}`);
    logStage('ws_open');
    connectElevenLabs();
  };

  twilioSocket.onmessage = (event) => {
    try {
      const raw = typeof event.data === 'string' ? event.data : '';
      if (!raw) return;

      // Parse Twilio Media Streams protocol events for observability
      try {
        const parsed = JSON.parse(raw);

        switch (parsed?.event) {
          case 'start':
            twilioStreamSid = parsed?.start?.streamSid || null;
            console.log(`[bridge] Twilio stream started callSid=${callSid} streamSid=${twilioStreamSid}`);
            logStage('twilio_stream_started', undefined, undefined, {
              streamSid: twilioStreamSid,
              tracks: parsed?.start?.tracks,
              mediaFormat: parsed?.start?.mediaFormat,
            });
            break;

          case 'stop':
            console.log(`[bridge] Twilio stream stop callSid=${callSid}`);
            logStage('twilio_stream_stopped');
            break;

          case 'mark':
            // Twilio mark events — no action needed, just pass through
            break;
        }
      } catch (_) {
        // Non-JSON from Twilio — unusual but proxy anyway
      }

      // Proxy everything to ElevenLabs as-is
      // register-call wires ElevenLabs to understand Twilio protocol directly
      if (elevenOpen && elevenSocket?.readyState === WebSocket.OPEN) {
        elevenSocket.send(raw);
      }
    } catch (err) {
      console.error(`[bridge] TW→EL proxy error callSid=${callSid}:`, err);
    }
  };

  twilioSocket.onerror = (event) => {
    console.error(`[bridge] Twilio WS error callSid=${callSid}:`, event);
    logStage('twilio_error', 'WS_ERROR', 'Twilio WebSocket error');
    cleanup('twilio_error');
  };

  twilioSocket.onclose = (event) => {
    console.log(`[bridge] Twilio WS closed callSid=${callSid} code=${event.code}`);
    logStage('twilio_closed', String(event.code), event.reason || 'closed');
    cleanup('twilio_closed');
  };

  return response;
});

// ═══════════ CRYPTO HELPERS ═══════════

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
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}
