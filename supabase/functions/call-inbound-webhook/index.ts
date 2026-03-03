import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Inbound Call Webhook — Professional Flow
 *
 * Twilio → this webhook → registers call in DB → resolves tenant →
 * routes to ElevenLabs via <Connect><Stream> → fallback if unavailable.
 *
 * Configure in Twilio Console:
 *   Phone Number → Voice → "A Call Comes In" → Webhook POST
 *   URL: https://<project>.supabase.co/functions/v1/call-inbound-webhook
 *   Status Callback URL: https://<project>.supabase.co/functions/v1/call-status-webhook
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

  try {
    // ═══════════ 1. PARSE TWILIO PARAMS ═══════════
    const contentType = req.headers.get('content-type') || '';
    let params: Record<string, string> = {};
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      formData.forEach((value, key) => { params[key] = String(value); });
    } else {
      params = await req.json();
    }

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

    // ═══════════ 3. RESOLVE TENANT (multi-tenant) ═══════════
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

    // Fallback: match by configured TWILIO_PHONE_NUMBER
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

    // ═══════════ 4. IDEMPOTENCY: Check existing record by CallSid ═══════════
    let callRecordId: string | null = null;

    const { data: existing } = await supabase
      .from('call_records').select('id').eq('external_call_id', callSid).maybeSingle();

    if (existing) {
      callRecordId = existing.id;
      console.log(`[inbound] Idempotent hit: existing record ${callRecordId}`);
    } else {
      // ═══════════ 5. CREATE CALL RECORD ═══════════
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
        // Race condition on unique index — retry lookup
        const { data: retry } = await supabase
          .from('call_records').select('id').eq('external_call_id', callSid).maybeSingle();
        callRecordId = retry?.id || null;
      } else {
        callRecordId = newRecord.id;
        console.log(`[inbound] Created call record ${callRecordId}`);
      }
    }

    // Record initial events
    if (callRecordId) {
      await Promise.all([
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
      ]);
    }

    // ═══════════ LOAD TENANT SETTINGS ═══════════
    const { data: tenant } = await supabase
      .from('tenants').select('name, settings_json').eq('id', tenantId).single();
    const companyName = tenant?.name || '';
    const greeting = companyName
      ? `Hola, bienvenido a ${escapeXml(companyName)}.`
      : 'Hola, bienvenido.';

    // ═══════════ 6–7. ROUTE TO ELEVENLABS VIA REGISTER-CALL API ═══════════
    let routingMethod = 'record';
    let sessionState = 'fallback_recording';
    let twiml: string | null = null;
    let elevenlabsConversationId: string | null = null;
    const statusCallbackUrl = `${SUPABASE_URL}/functions/v1/call-status-webhook`;

    if (ELEVENLABS_API_KEY && ELEVENLABS_AGENT_ID) {
      // Use the ElevenLabs Register Call API which returns ready-to-use TwiML
      // This is the correct integration path for Twilio ↔ ElevenLabs
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const registerBody: Record<string, any> = {
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

          if (elRes.ok) {
            const contentType = elRes.headers.get('content-type') || '';
            let twimlContent: string | null = null;

            if (contentType.includes('application/json')) {
              const elData = await elRes.json();
              twimlContent = elData.twiml || null;
              elevenlabsConversationId = elData.conversation_id || null;
            } else {
              // API may return TwiML directly as XML
              twimlContent = await elRes.text();
              elevenlabsConversationId = extractConversationIdFromTwiml(twimlContent);
            }

            if (twimlContent && twimlContent.includes('<Response>')) {
              routingMethod = 'register_call';
              sessionState = 'connected_to_agent';
              twiml = addPostStreamFallback(twimlContent, statusCallbackUrl);
              console.log(`[inbound] ElevenLabs register-call TwiML obtained (attempt ${attempt + 1})`);
              break;
            } else {
              console.error(`[inbound] ElevenLabs register-call: no valid TwiML in response (attempt ${attempt + 1}), body: ${String(twimlContent).substring(0, 200)}`);
            }
          } else {
            const errText = await elRes.text();
            console.error(`[inbound] ElevenLabs register-call error: ${elRes.status} ${errText} (attempt ${attempt + 1})`);
          }
        } catch (e) {
          console.error(`[inbound] ElevenLabs register-call fetch error (attempt ${attempt + 1}):`, e);
        }
      }

      if (routingMethod !== 'register_call') {
        sessionState = 'failed_routing';
        console.error(`[inbound] ElevenLabs routing FAILED after retries`);
      }
    } else {
      console.warn(`[inbound] ElevenLabs not configured, using recording fallback`);
    }

    // ═══════════ CREATE CALL SESSION ═══════════
    if (callRecordId) {
      await supabase.from('call_sessions').upsert({
        tenant_id: tenantId,
        call_record_id: callRecordId,
        call_sid: callSid,
        agent_mode: 'elevenlabs',
        elevenlabs_agent_id: ELEVENLABS_AGENT_ID || null,
        language: 'es',
        routing_method: routingMethod,
        target_url: null,
        state: sessionState,
        retry_count: routingMethod === 'register_call' ? 0 : 1,
      }, { onConflict: 'call_sid' });

      // Store ElevenLabs conversation_id for later transcript retrieval
      if (elevenlabsConversationId) {
        await supabase.from('call_records').update({
          extracted_data: { direction: 'inbound', callerCity, callerState, callerCountry, accountSid, elevenlabs_conversation_id: elevenlabsConversationId },
        }).eq('id', callRecordId);
        console.log(`[inbound] Stored elevenlabs_conversation_id=${elevenlabsConversationId}`);
      }

      if (sessionState === 'failed_routing') {
        await supabase.from('call_records').update({ status: 'failed' }).eq('id', callRecordId);
        await supabase.from('call_events').insert({
          call_record_id: callRecordId,
          tenant_id: tenantId,
          event_type: 'failed_routing',
          twilio_call_sid: callSid,
          event_data: { reason: 'elevenlabs_unavailable', timestamp: new Date().toISOString() },
        });
      }
    }

    // ═══════════ GENERATE TwiML RESPONSE (fallback cases) ═══════════
    if (!twiml) {
      if (sessionState === 'failed_routing') {
        twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Mia-Neural" language="es-MX">Lo sentimos, nuestro asistente no está disponible en este momento. Por favor intente más tarde.</Say>
</Response>`;
      } else {
        // Fallback: Record mode (ElevenLabs not configured)
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

function addPostStreamFallback(twiml: string, statusCallbackUrl: string): string {
  if (!twiml.includes('<Connect>') || !twiml.includes('</Connect>')) return twiml;

  const connectBlockMatch = twiml.match(/<Connect>[\s\S]*?<\/Connect>/i);
  const connectBlock = connectBlockMatch?.[0] || '';

  return twiml.replace(
    '</Connect>',
    `</Connect>
  <Say voice="Polly.Mia-Neural" language="es-MX">Estamos reconectando con el asistente. Un momento por favor.</Say>
  <Pause length="1"/>
  ${connectBlock}
  <Say voice="Polly.Mia-Neural" language="es-MX">Tuvimos una desconexión con el asistente. Por favor deja tu mensaje después del tono.</Say>
  <Pause length="1"/>
  <Record
    maxLength="180"
    recordingStatusCallback="${escapeXml(statusCallbackUrl)}"
    recordingStatusCallbackEvent="completed"
    transcribe="false"
    playBeep="true"
    trim="trim-silence"
  />`
  );
}

function extractConversationIdFromTwiml(twiml: string): string | null {
  const match = twiml.match(/<Parameter\s+name=["']conversation_id["']\s+value=["']([^"']+)["']/i);
  return match?.[1] || null;
}

function twimlSay(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Mia-Neural" language="es-MX">${escapeXml(message)}</Say>
</Response>`;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
