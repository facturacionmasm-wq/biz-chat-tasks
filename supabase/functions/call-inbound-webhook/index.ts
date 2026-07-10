import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { resolveTenantAgentId, MASTER_TENANT } from "../_shared/elevenlabs-agent.ts";
import { resolveTenantTimezone, formatInTimezone } from "../_shared/timezone.ts";


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

  // Build a reconnect URL that points BACK to this same inbound webhook so a
  // dropped ElevenLabs WebSocket does not terminate the call — Twilio will
  // re-fetch fresh TwiML and re-open the stream instead of hanging up.
  const SUPABASE_URL_ENV = Deno.env.get('SUPABASE_URL') || '';
  const reconnectUrl = `${SUPABASE_URL_ENV}/functions/v1/call-inbound-webhook`;
  const fallback = `<Say voice="Polly.Mia-Neural" language="es-MX">Tuvimos una desconexión con el asistente. Reintentando…</Say><Redirect method="POST">${reconnectUrl}</Redirect>`;

  if (elTwiml.includes('<Response')) {
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
  ${fallback}
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
    // ═══════════ 0. ABSENCE-MESSAGE MODE (query-string driven) ═══════════
    // When call-transfer-status <Redirect>s a caller back here because the
    // staff member did not answer, it appends ?mode=absence_message&... .
    // We surface those hints to ElevenLabs via dynamic_variables and a
    // per-conversation prompt override so the agent asks the caller if they
    // want to leave a voice message for the missed staff member.
    const reqUrl = new URL(req.url);
    const absenceMode = reqUrl.searchParams.get('mode') === 'absence_message';
    const absenceTargetName = reqUrl.searchParams.get('target_name') || '';
    const absenceTargetPhone = reqUrl.searchParams.get('target_phone') || '';
    const absenceTargetUserId = reqUrl.searchParams.get('target_user_id') || '';
    const absenceCallerPhoneHint = reqUrl.searchParams.get('caller_phone') || '';
    const absenceCallRecordIdHint = reqUrl.searchParams.get('call_record_id') || '';
    const absenceTenantHint = reqUrl.searchParams.get('tenant_id') || '';

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

    console.log(`[inbound] CallSid=${callSid} From=${from} To=${to} Dir=${direction} absenceMode=${absenceMode}`);

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
    let isReentry = false;

    const { data: existing } = await supabase
      .from('call_records')
      .select('id, status, extracted_data')
      .eq('external_call_id', callSid)
      .maybeSingle();

    if (existing) {
      callRecordId = existing.id;
      isReentry = true;
      console.log(`[inbound] Idempotent hit: existing record ${callRecordId}`);

      // ═══════════ RE-ENTRY DECISION: intentional close vs transient drop ═══════════
      // This handler is re-invoked by Twilio when the <Redirect> after <Connect><Stream>
      // fires. That Redirect fires for BOTH intentional goodbyes and transient WS drops;
      // here we distinguish them and hang up cleanly when the conversation already ended.
      const { data: sessionRow } = await supabase
        .from('call_sessions')
        .select('id, state, retry_count, ended_intentionally')
        .eq('call_sid', callSid)
        .maybeSingle();

      const recStatus = String((existing as any).status || '').toLowerCase();
      const extracted = ((existing as any).extracted_data || {}) as Record<string, unknown>;
      const convEnded = String(extracted?.conversation_ended || '').toLowerCase();

      const endedIntentionally =
        (sessionRow?.ended_intentionally === true) ||
        (typeof sessionRow?.state === 'string' && ['completed', 'ended_completed'].includes(sessionRow.state)) ||
        recStatus === 'completed' ||
        convEnded === 'intentional';

      const currentRetryCount = Number(sessionRow?.retry_count ?? 0);
      const nextRetryCount = currentRetryCount + 1;

      // Bump retry_count for observability + loop guard
      if (sessionRow?.id) {
        await supabase
          .from('call_sessions')
          .update({ retry_count: nextRetryCount })
          .eq('id', sessionRow.id);
      }

      const loopGuardTripped = nextRetryCount > 2;

      if (!absenceMode && (endedIntentionally || loopGuardTripped)) {
        const stage = endedIntentionally ? 'redirect_hangup_intentional' : 'redirect_hangup_loop_guard';
        console.log(`[inbound] Re-entry → HANGUP callSid=${callSid} reason=${stage} retry=${nextRetryCount} endedIntentionally=${endedIntentionally}`);
        voiceLog(callSid, tenantId, stage, undefined, undefined, {
          retry_count: nextRetryCount,
          session_state: sessionRow?.state ?? null,
          ended_intentionally: sessionRow?.ended_intentionally ?? null,
          record_status: recStatus,
          conversation_ended: convEnded || null,
        });

        const hangupTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Mia-Neural" language="es-MX">Gracias por tu llamada. Hasta luego.</Say>
  <Hangup/>
</Response>`;
        return new Response(hangupTwiml, {
          headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
        });
      }

      // Transient drop with room to retry → fall through to reconnect flow
      voiceLog(callSid, tenantId, 'redirect_reconnect_attempt', undefined, undefined, {
        retry_count: nextRetryCount,
        session_state: sessionRow?.state ?? null,
      });
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

    // Resolve per-tenant agent (global fallback only for master tenant)
    const { agentId: tenantAgentId, source: agentSource } = await resolveTenantAgentId(supabase, tenantId);

    // Non-master tenants without a provisioned agent do NOT fall back to the
    // shared global agent — respond with a friendly TwiML and skip ElevenLabs.
    if (!tenantAgentId && tenantId !== MASTER_TENANT) {
      console.warn(`[inbound] Tenant ${tenantId} has no provisioned agent, skipping ElevenLabs`);
      voiceLog(callSid, tenantId, 'no_tenant_agent', 'NO_TENANT_AGENT', 'Tenant has no provisioned ElevenLabs agent');
      return new Response(
        twimlSay('El servicio de asistente de voz aún no está aprovisionado para esta empresa. Por favor intente más tarde.'),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } },
      );
    }

    if (ELEVENLABS_API_KEY && tenantAgentId) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          // Anchor the LLM to the tenant's local calendar date so it never
          // hallucinates a past year when the caller doesn't say one.
          const _tenantTz = await resolveTenantTimezone(supabase, tenantId);
          const _nowInTz = formatInTimezone(new Date(), _tenantTz, {
            year: 'numeric', month: '2-digit', day: '2-digit',
          });
          // es-MX renders as "10/07/2026" (DD/MM/YYYY); reformat to YYYY-MM-DD.
          const _dParts = _nowInTz.split(/[\/\-]/).map(s => s.trim());
          const _todayISO = _dParts.length === 3
            ? `${_dParts[2]}-${_dParts[1].padStart(2,'0')}-${_dParts[0].padStart(2,'0')}`
            : new Date().toISOString().slice(0, 10);
          const _currentYear = _todayISO.slice(0, 4);
          const _weekday = formatInTimezone(new Date(), _tenantTz, { weekday: 'long' });

          const _dynVars: Record<string, string> = {
            tenant_id: tenantId,
            call_record_id: callRecordId || '',
            call_sid: callSid,
            company_name: companyName || 'la empresa',
            current_date: _todayISO,
            today: _todayISO,
            current_year: _currentYear,
            current_weekday: _weekday,
            tenant_timezone: _tenantTz,
          };

          if (absenceMode) {
            _dynVars.absence_mode = 'true';
            _dynVars.absence_target_name = absenceTargetName || 'la persona solicitada';
            _dynVars.absence_target_phone = absenceTargetPhone || '';
            _dynVars.absence_target_user_id = absenceTargetUserId || '';
            _dynVars.absence_caller_phone = absenceCallerPhoneHint || from || '';
          }

          const _absencePrompt = absenceMode
            ? `IMPORTANTE: Estás retomando una llamada porque ${absenceTargetName || 'la persona solicitada'} no pudo atender la transferencia. ` +
              `Discúlpate brevemente con el cliente, dile que ${absenceTargetName || 'la persona'} está ocupada en este momento, ` +
              `y ofrécele dejar un mensaje o sus datos de contacto para que le devuelvan la llamada. ` +
              `Cuando el cliente dicte su mensaje, invoca la herramienta "leave_absence_message" con el texto del mensaje ` +
              `y opcionalmente el nombre del cliente. Después despídete de forma cordial.`
            : '';

          const registerBody: Record<string, unknown> = {
            agent_id: tenantAgentId,

            from_number: from,
            to_number: to,
            direction: 'inbound',
            conversation_initiation_client_data: {
              dynamic_variables: _dynVars,
              ...(absenceMode
                ? {
                    conversation_config_override: {
                      agent: { prompt: { prompt: _absencePrompt } },
                    },
                  }
                : {}),
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

    // ═══════════ CREATE / UPDATE CALL SESSION (fire-and-forget) ═══════════
    // On re-entry we already bumped retry_count above; don't reset it.
    if (callRecordId) {
      const sessionPayload: Record<string, unknown> = {
        tenant_id: tenantId,
        call_record_id: callRecordId,
        call_sid: callSid,
        agent_mode: 'elevenlabs',
        elevenlabs_agent_id: tenantAgentId || null,
        language: 'es',
        routing_method: routingMethod,
        state: sessionState,
      };
      if (!isReentry) sessionPayload.retry_count = 0;
      supabase.from('call_sessions').upsert(sessionPayload, { onConflict: 'call_sid' }).then(({ error }) => {
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
