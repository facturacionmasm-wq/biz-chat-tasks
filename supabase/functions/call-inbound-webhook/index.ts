import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Inbound Call Webhook — Production-grade
 *
 * Twilio → this webhook → registers call in DB → resolves tenant →
 * calls ElevenLabs register-call API → returns TwiML with fallback.
 *
 * The register-call API returns TwiML with <Connect><Stream> pointing
 * to ElevenLabs' WebSocket. We wrap it with a fallback <Say> so the
 * call never dies silently if the stream fails.
 */

// ═══════════ Twilio HMAC-SHA1 Signature Validation ═══════════
async function validateTwilioSignature(
  authToken: string, signature: string, url: string, params: Record<string, string>
): Promise<boolean> {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) data += key + params[key];
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === signature;
}

function parseRequestBody(contentType: string, rawBody: string): Record<string, string> {
  const body = (rawBody || '').trim();
  if (!body) return {};
  if (contentType.includes('application/x-www-form-urlencoded') ||
      (!contentType.includes('application/json') && body.includes('='))) {
    const params: Record<string, string> = {};
    new URLSearchParams(body).forEach((v, k) => { params[k] = v; });
    return params;
  }
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object') {
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v ?? '')]));
    }
  } catch {
    const params: Record<string, string> = {};
    new URLSearchParams(body).forEach((v, k) => { params[k] = v; });
    return params;
  }
  return {};
}

/**
 * Uses ElevenLabs TwiML AS-IS without wrapping.
 * 
 * CRITICAL: Do NOT add an `action` attribute to <Connect>.
 * When `action` is present, Twilio POSTs to that URL when the stream ends
 * and uses the response as the next TwiML. If that URL returns empty TwiML,
 * the call hangs up immediately — causing the "connects but cuts off" bug.
 * 
 * Without `action`, Twilio naturally falls through to the next verb
 * after <Connect> in the same TwiML document.
 */
function buildTwimlWithElevenLabs(elTwiml: string, statusCallbackUrl: string, companyName: string): string {
  console.log(`[inbound] Raw ElevenLabs TwiML: ${elTwiml}`);

  // Keep ElevenLabs TwiML untouched, but append a safe fallback message.
  // If the WebSocket closes early, Twilio will continue with this <Say>
  // instead of ending the call abruptly.
  if (elTwiml.includes('<Response')) {
    const fallback = `<Say voice="Polly.Mia-Neural" language="es-MX">Tuvimos una desconexión con el asistente. Por favor intente de nuevo en unos segundos.</Say>`;
    if (elTwiml.includes('</Response>')) {
      return elTwiml.replace('</Response>', `${fallback}</Response>`);
    }
    return elTwiml;
  }

  // Safety fallback only when ElevenLabs doesn't return full TwiML
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${elTwiml}"/>
  </Connect>
  <Say voice="Polly.Mia-Neural" language="es-MX">Tuvimos una desconexión con el asistente. Por favor intente de nuevo en unos segundos.</Say>
</Response>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
  const ELEVENLABS_AGENT_ID = Deno.env.get('ELEVENLABS_AGENT_ID');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const voiceLog = (callSidVal: string, tenantIdVal: string | null, stage: string, errorCode?: string, errorMsg?: string, meta?: Record<string, unknown>) => {
    supabase.from('voice_call_logs').insert({
      call_sid: callSidVal,
      tenant_id: tenantIdVal,
      stage,
      error_code: errorCode || null,
      error_message: errorMsg || null,
      metadata: meta || {},
    }).then(({ error }) => {
      if (error) console.error(`[inbound] voiceLog error: ${error.message}`);
    });
  };

  try {
    // ═══════════ 1. PARSE TWILIO PARAMS ═══════════
    const contentType = req.headers.get('content-type') || '';
    const rawBody = await req.text();
    const params = parseRequestBody(contentType, rawBody);

    const callSid = params.CallSid || '';
    const from = params.From || '';
    const to = params.To || '';
    const direction = params.Direction || 'inbound';
    const callerCity = params.CallerCity || '';
    const callerState = params.CallerState || '';
    const callerCountry = params.CallerCountry || '';
    const accountSid = params.AccountSid || '';

    console.log(`[inbound] CallSid=${callSid} From=${from} To=${to} Dir=${direction}`);

    // ═══════════ 2. TWILIO SIGNATURE VALIDATION ═══════════
    if (TWILIO_AUTH_TOKEN) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') || '';
      if (twilioSignature) {
        const webhookUrl = `${SUPABASE_URL}/functions/v1/call-inbound-webhook`;
        const isValid = await validateTwilioSignature(TWILIO_AUTH_TOKEN, twilioSignature, webhookUrl, params);
        if (!isValid) {
          console.error(`[inbound] INVALID Twilio signature for CallSid=${callSid}`);
          voiceLog(callSid, null, 'signature_invalid', 'HMAC_FAIL', 'Twilio signature validation failed');
          return new Response(twimlSay('Solicitud no autorizada.'), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
          });
        }
        console.log(`[inbound] Twilio signature VALID`);
      } else {
        console.warn(`[inbound] No X-Twilio-Signature header`);
      }
    }

    if (!callSid) {
      return new Response(twimlSay('Error interno. Intente más tarde.'), {
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
      });
    }

    // ═══════════ 3. RESOLVE TENANT ═══════════
    let tenantId: string | null = null;

    for (const phone of [to, from].filter(Boolean)) {
      const { data: phoneMatch } = await supabase
        .from('tenant_phone_numbers')
        .select('tenant_id')
        .eq('phone_e164', phone)
        .eq('active', true)
        .maybeSingle();
      if (phoneMatch) {
        tenantId = phoneMatch.tenant_id;
        console.log(`[inbound] Tenant ${tenantId} from phone ${phone}`);
        break;
      }
    }

    if (!tenantId) {
      const twilioPhone = Deno.env.get('TWILIO_PHONE_NUMBER') || '';
      if (twilioPhone && (to === twilioPhone || to === `+${twilioPhone.replace(/^\+/, '')}`)) {
        const { data: anyTenant } = await supabase.from('tenants').select('id').limit(1).single();
        if (anyTenant) {
          tenantId = anyTenant.id;
          console.log(`[inbound] Fallback tenant ${tenantId}`);
        }
      }
    }

    if (!tenantId) {
      console.warn(`[inbound] No tenant found for To=${to}`);
      return new Response(twimlSay('Este número no está configurado. Disculpe las molestias.'), {
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
      });
    }

    // ═══════════ SOFT CLEANUP: CLOSE STALE ACTIVE CALLS ═══════════
    const staleThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    await supabase
      .from('call_records')
      .update({ status: 'failed', ended_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .is('ended_at', null)
      .in('status', ['initiated', 'ringing', 'in_progress'])
      .lt('started_at', staleThreshold);

    // ═══════════ RATE LIMIT CHECK ═══════════
    const { data: rateLimit } = await supabase
      .from('tenant_rate_limits').select('is_blocked, blocked_until').eq('tenant_id', tenantId).maybeSingle();
    if (rateLimit?.is_blocked) {
      const blockedUntil = rateLimit.blocked_until ? new Date(rateLimit.blocked_until) : null;
      if (!blockedUntil || blockedUntil > new Date()) {
        console.log(`[inbound] Tenant ${tenantId} BLOCKED`);
        return new Response(twimlSay('El servicio no está disponible en este momento. Intente más tarde.'), {
          headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
        });
      }
    }

    // ═══════════ 4. IDEMPOTENCY ═══════════
    let callRecordId: string | null = null;

    const { data: existing } = await supabase
      .from('call_records').select('id').eq('external_call_id', callSid).maybeSingle();

    if (existing) {
      callRecordId = existing.id;
      console.log(`[inbound] Idempotent hit: existing record ${callRecordId}`);
    } else {
      const { data: newRecord, error: insertError } = await supabase
        .from('call_records')
        .insert({
          tenant_id: tenantId,
          external_call_id: callSid,
          from_number: from,
          to_number: to,
          status: 'ringing',
          channel: 'twilio_inbound',
          started_at: new Date().toISOString(),
          recording_status: 'not_requested',
          transcript_status: 'pending',
          summary_status: 'pending',
          appointment_status: 'not_requested',
          extracted_data: { direction: 'inbound', callerCity, callerState, callerCountry, accountSid },
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('[inbound] Insert error:', insertError);
        const { data: retry } = await supabase
          .from('call_records').select('id').eq('external_call_id', callSid).maybeSingle();
        callRecordId = retry?.id || null;
      } else {
        callRecordId = newRecord.id;
        console.log(`[inbound] Created call record ${callRecordId}`);
      }
    }

    // Record initial events (fire-and-forget)
    if (callRecordId) {
      Promise.all([
        supabase.from('call_events').insert({
          call_record_id: callRecordId,
          tenant_id: tenantId,
          event_type: 'ringing',
          twilio_call_sid: callSid,
          event_data: { from, to, direction, callerCity, callerState, callerCountry, timestamp: new Date().toISOString() },
        }),
        supabase.from('audit_events').insert({
          tenant_id: tenantId,
          event_type: 'call.inbound_received',
          resource_type: 'call_record',
          resource_id: callRecordId,
          payload: { call_sid: callSid, from, to },
        }),
      ]).catch(e => console.error('[inbound] Event insert error:', e));
    }

    // ═══════════ LOAD TENANT SETTINGS ═══════════
    const { data: tenant } = await supabase
      .from('tenants').select('name, settings_json').eq('id', tenantId).single();
    const companyName = tenant?.name || '';

    // ═══════════ 5. ROUTE TO ELEVENLABS VIA REGISTER-CALL ═══════════
    let routingMethod = 'record';
    let sessionState = 'fallback_recording';
    let twiml: string | null = null;
    const statusCallbackUrl = `${SUPABASE_URL}/functions/v1/call-status-webhook`;

    if (ELEVENLABS_API_KEY && ELEVENLABS_AGENT_ID) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const registerBody = {
            agent_id: ELEVENLABS_AGENT_ID,
            from_number: from,
            to_number: to,
            direction: 'inbound',
            conversation_initiation_client_data: {
              dynamic_variables: {
                tenant_id: tenantId,
                call_record_id: callRecordId || '',
                call_sid: callSid,
                company_name: companyName || 'la empresa',
              },
            },
          };

          console.log(`[inbound] Calling register-call (attempt ${attempt + 1})...`);

          const elRes = await fetch(
            'https://api.elevenlabs.io/v1/convai/twilio/register-call',
            {
              method: 'POST',
              headers: {
                'xi-api-key': ELEVENLABS_API_KEY,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(registerBody),
            }
          );

          console.log(`[inbound] register-call response: status=${elRes.status} content-type=${elRes.headers.get('content-type')}`);

          if (elRes.ok) {
            const elContentType = elRes.headers.get('content-type') || '';
            let twimlContent: string | null = null;

            if (elContentType.includes('application/json')) {
              const elData = await elRes.json();
              console.log(`[inbound] register-call JSON keys: ${Object.keys(elData).join(', ')}`);
              twimlContent = elData.twiml || null;
            } else {
              twimlContent = await elRes.text();
            }

            if (twimlContent && twimlContent.includes('<Response')) {
              // Wrap with fallback so call never dies silently
              twiml = buildTwimlWithElevenLabs(twimlContent, statusCallbackUrl, companyName);
              routingMethod = 'register_call_native';
              sessionState = 'connected_to_agent';
              console.log(`[inbound] ElevenLabs TwiML OK (attempt ${attempt + 1})`);
              voiceLog(callSid, tenantId, 'routing_ok', undefined, undefined, { 
                method: 'register_call_native', 
                attempt: attempt + 1,
                raw_twiml_length: twimlContent.length,
              });
              break;
            } else {
              const preview = String(twimlContent).substring(0, 300);
              console.error(`[inbound] Invalid TwiML (attempt ${attempt + 1}): ${preview}`);
              voiceLog(callSid, tenantId, 'routing_invalid_twiml', 'INVALID_TWIML', preview);
            }
          } else {
            const errText = await elRes.text();
            console.error(`[inbound] register-call error: ${elRes.status} ${errText.substring(0, 300)} (attempt ${attempt + 1})`);
            voiceLog(callSid, tenantId, 'routing_api_error', `HTTP_${elRes.status}`, errText.substring(0, 300));
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.error(`[inbound] register-call fetch error (attempt ${attempt + 1}): ${errMsg}`);
          voiceLog(callSid, tenantId, 'routing_fetch_error', 'FETCH_ERROR', errMsg);
        }
      }

      if (!twiml) {
        sessionState = 'failed_routing';
        console.error(`[inbound] ElevenLabs routing FAILED after 2 attempts`);
        voiceLog(callSid, tenantId, 'routing_failed', 'ELEVENLABS_UNAVAILABLE', 'Register-call failed after 2 attempts');
      }
    } else {
      console.warn(`[inbound] ElevenLabs not configured, using recording fallback`);
    }

    // ═══════════ CREATE CALL SESSION (fire-and-forget) ═══════════
    if (callRecordId) {
      supabase.from('call_sessions').upsert({
        tenant_id: tenantId,
        call_record_id: callRecordId,
        call_sid: callSid,
        agent_mode: 'elevenlabs',
        elevenlabs_agent_id: ELEVENLABS_AGENT_ID || null,
        language: 'es',
        routing_method: routingMethod,
        state: sessionState,
        retry_count: 0,
      }, { onConflict: 'call_sid' }).then(({ error }) => {
        if (error) console.error('[inbound] Session upsert error:', error);
      });

      if (sessionState === 'failed_routing') {
        supabase.from('call_records').update({ status: 'failed' }).eq('id', callRecordId)
          .then(() => supabase.from('call_events').insert({
            call_record_id: callRecordId!,
            tenant_id: tenantId!,
            event_type: 'failed_routing',
            twilio_call_sid: callSid,
            event_data: { reason: 'elevenlabs_unavailable', timestamp: new Date().toISOString() },
          })).catch(e => console.error('[inbound] Failed routing event error:', e));
      }
    }

    // ═══════════ GENERATE TwiML RESPONSE (fallback cases) ═══════════
    if (!twiml) {
      const greeting = companyName
        ? `Hola, bienvenido a ${escapeXml(companyName)}.`
        : 'Hola, bienvenido.';

      if (sessionState === 'failed_routing') {
        twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Mia-Neural" language="es-MX">${greeting} Nuestro asistente no está disponible en este momento. Por favor deje su mensaje después del tono.</Say>
  <Record
    maxLength="120"
    recordingStatusCallback="${escapeXml(statusCallbackUrl)}"
    recordingStatusCallbackEvent="completed"
    transcribe="false"
    playBeep="true"
    trim="trim-silence"
  />
  <Say voice="Polly.Mia-Neural" language="es-MX">Gracias por su llamada. Hasta pronto.</Say>
</Response>`;
      } else {
        twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Mia-Neural" language="es-MX">${greeting} Por favor espere mientras lo conectamos.</Say>
  <Pause length="1"/>
  <Record
    maxLength="3600"
    recordingStatusCallback="${escapeXml(statusCallbackUrl)}"
    recordingStatusCallbackEvent="completed"
    transcribe="false"
    playBeep="false"
    trim="trim-silence"
  />
  <Say voice="Polly.Mia-Neural" language="es-MX">Gracias por su llamada. Hasta pronto.</Say>
</Response>`;
      }
    }

    // Log the final TwiML being returned (first 500 chars)
    console.log(`[inbound] FINAL TwiML (${twiml.length} chars): ${twiml.substring(0, 500)}`);
    console.log(`[inbound] Response: routing=${routingMethod} state=${sessionState} callRecordId=${callRecordId}`);

    return new Response(twiml, {
      headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[inbound] Fatal error:', msg);
    return new Response(twimlSay('Ha ocurrido un error. Por favor intente más tarde.'), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
    });
  }
});

function twimlSay(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Mia-Neural" language="es-MX">${escapeXml(message)}</Say>
</Response>`;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
