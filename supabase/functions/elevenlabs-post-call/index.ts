import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { fetchElevenLabsConversationUsage } from "../_shared/elevenlabs-usage.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * ElevenLabs Post-Call Webhook
 *
 * Called by ElevenLabs after each conversation ends.
 * Registers the call in call_records and triggers the processing pipeline.
 *
 * ElevenLabs sends a payload like:
 * {
 *   "agent_id": "...",
 *   "conversation_id": "...",
 *   "status": "done",
 *   "call_duration_secs": 120,
 *   "transcript": "...",
 *   "recording_url": "...",
 *   "metadata": { "tenant_id": "...", "call_sid": "..." },
 *   ...
 * }
 */

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ═══════════ AUTH VALIDATION: HMAC (preferred) or legacy shared-secret ═══════════
  // Read the raw body ONCE (needed unmodified for HMAC verification).
  const rawBody = await req.text();

  const HMAC_SECRET = Deno.env.get('ELEVENLABS_POST_CALL_HMAC_SECRET') || '';
  const LEGACY_SECRET = Deno.env.get('ELEVENLABS_WEBHOOK_SECRET') || '';
  const TOLERANCE_SECS = 30 * 60; // 30 min replay window

  const sigHeader =
    req.headers.get('elevenlabs-signature') ||
    req.headers.get('ElevenLabs-Signature') ||
    '';
  const legacyHeader =
    req.headers.get('x-elevenlabs-secret') ||
    req.headers.get('elevenlabs-secret') ||
    req.headers.get('x-webhook-secret') ||
    '';

  async function verifyHmac(header: string, secret: string, body: string): Promise<{ ok: boolean; reason?: string }> {
    if (!header || !secret) return { ok: false, reason: 'missing_signature_or_secret' };
    // Parse "t=timestamp,v0=hash" (order-independent).
    const parts = header.split(',').map((p) => p.trim());
    let t = '';
    let v0 = '';
    for (const p of parts) {
      if (p.startsWith('t=')) t = p.slice(2);
      else if (p.startsWith('v0=')) v0 = p.slice(3);
    }
    if (!t || !v0) return { ok: false, reason: 'malformed_signature' };
    const ts = Number(t);
    if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - ts) > TOLERANCE_SECS) return { ok: false, reason: 'timestamp_out_of_tolerance' };

    // Strip optional "wsec_" prefix from secret for the raw HMAC key.
    const keyMaterial = secret.startsWith('wsec_') ? secret.slice(5) : secret;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(keyMaterial),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${body}`));
    const computed = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    // Constant-time-ish comparison
    if (computed.length !== v0.length) return { ok: false, reason: 'signature_mismatch' };
    let diff = 0;
    for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ v0.charCodeAt(i);
    return diff === 0 ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
  }

  let authOk = false;
  let authMode = 'none';
  let authReason = '';

  if (HMAC_SECRET && sigHeader) {
    const res = await verifyHmac(sigHeader, HMAC_SECRET, rawBody);
    if (res.ok) { authOk = true; authMode = 'hmac'; }
    else authReason = `hmac:${res.reason}`;
  }
  if (!authOk && LEGACY_SECRET && legacyHeader) {
    if (legacyHeader === LEGACY_SECRET) { authOk = true; authMode = 'legacy'; }
    else authReason = authReason || 'legacy:secret_mismatch';
  }
  // If neither secret is configured at all, allow through (dev fallback) — preserves prior behavior when no secret set.
  if (!HMAC_SECRET && !LEGACY_SECRET) { authOk = true; authMode = 'unconfigured'; }

  if (!authOk) {
    const reason = authReason || (sigHeader || legacyHeader ? 'invalid' : 'missing');
    console.warn(`[el-post-call] 401 ${reason} — request rejected`);

    // Defensive pre-parse: even though auth failed, try to surface which
    // conversation/agent this 401 refers to so the reconcile job can act.
    let peekedAgent = '';
    let peekedConv = '';
    let peekedCallSid = '';
    try {
      const peek = JSON.parse(rawBody);
      peekedAgent = peek?.agent_id || '';
      peekedConv = peek?.conversation_id || peek?.id || '';
      const meta = peek?.metadata || peek?.call_metadata || {};
      peekedCallSid = peek?.call_sid || meta?.call_sid || meta?.twilio_call_sid || '';
    } catch { /* rawBody was not JSON — ignore */ }

    try {
      const MASTER_TENANT = '00000000-0000-0000-0000-000000000001';
      await supabase.from('voice_call_logs').insert({
        call_sid: peekedCallSid || 'unknown',
        tenant_id: MASTER_TENANT,
        stage: 'post_call_unauthorized',
        error_code: 'AUTH_401',
        error_message: reason,
        metadata: {
          has_hmac_header: !!sigHeader,
          has_legacy_header: !!legacyHeader,
          agent_id: peekedAgent || null,
          conversation_id: peekedConv || null,
          call_sid: peekedCallSid || null,
          sender_ip: req.headers.get('x-forwarded-for') || null,
          user_agent: req.headers.get('user-agent') || null,
        },
      });
      await supabase.from('audit_events').insert({
        tenant_id: MASTER_TENANT,
        event_type: 'call.elevenlabs_post_call_unauthorized',
        resource_type: 'elevenlabs_webhook',
        resource_id: peekedCallSid || peekedConv || null,
        payload: {
          reason,
          has_hmac_header: !!sigHeader,
          has_legacy_header: !!legacyHeader,
          agent_id: peekedAgent || null,
          conversation_id: peekedConv || null,
        },
      });

      // Burst alarm: >=5 401s within the last 15 min => secret drift or attack.
      try {
        const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const { count } = await supabase
          .from('voice_call_logs')
          .select('id', { count: 'exact', head: true })
          .eq('stage', 'post_call_unauthorized')
          .gte('created_at', since);
        if ((count ?? 0) >= 5) {
          await supabase.from('audit_events').insert({
            tenant_id: MASTER_TENANT,
            event_type: 'call.elevenlabs_post_call_401_burst',
            resource_type: 'elevenlabs_webhook',
            resource_id: null,
            payload: { window_minutes: 15, count_401: count, hint: 'ElevenLabs HMAC secret may be out of sync' },
          });
        }
      } catch (e) {
        console.error('[el-post-call] 401 burst check failed:', e);
      }
    } catch (e) {
      console.error('[el-post-call] failed to log 401:', e);
    }
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  console.log(`[el-post-call] auth ok via ${authMode}`);

  try {
    const body = JSON.parse(rawBody);
    console.log('[el-post-call] Received payload:', JSON.stringify(body).substring(0, 500));

    // Extract fields from ElevenLabs payload (handle various formats)
    const conversationId = body.conversation_id || body.id || '';
    const agentId = body.agent_id || '';
    const status = body.status || 'done';
    const durationSecs = body.call_duration_secs || body.duration || body.call_duration || 0;
    const recordingUrl = body.recording_url || body.audio_url || null;

    // Transcript can come in different formats
    let transcript = '';
    if (typeof body.transcript === 'string') {
      transcript = body.transcript;
    } else if (Array.isArray(body.transcript)) {
      transcript = body.transcript
        .map((t: any) => `${t.role || 'unknown'}: ${t.message || t.text || ''}`)
        .join('\n');
    } else if (body.conversation_transcript) {
      if (typeof body.conversation_transcript === 'string') {
        transcript = body.conversation_transcript;
      } else if (Array.isArray(body.conversation_transcript)) {
        transcript = body.conversation_transcript
          .map((t: any) => `${t.role || 'unknown'}: ${t.message || t.text || ''}`)
          .join('\n');
      }
    }

    // Extract metadata (may contain tenant_id, call_sid from Twilio)
    const metadata = body.metadata || body.call_metadata || {};
    const callSid = body.call_sid || metadata.call_sid || metadata.twilio_call_sid || '';
    const fromNumber = body.from || body.caller_number || metadata.from || metadata.From || '';
    const toNumber = body.to || body.called_number || metadata.to || metadata.To || '';

    // Analysis/summary from ElevenLabs
    const analysis = body.analysis || body.call_analysis || {};
    const summary = analysis.summary || analysis.call_summary || body.summary || '';

    // ═══════════ RESOLVE TENANT ═══════════
    let tenantId = metadata.tenant_id || body.tenant_id || null;

    if (!tenantId) {
      // Try resolving from phone numbers
      for (const phone of [toNumber, fromNumber].filter(Boolean)) {
        const { data: phoneMatch } = await supabase
          .from('tenant_phone_numbers')
          .select('tenant_id')
          .eq('phone_e164', phone)
          .eq('active', true)
          .maybeSingle();
        if (phoneMatch) {
          tenantId = phoneMatch.tenant_id;
          console.log(`[el-post-call] Resolved tenant ${tenantId} from phone ${phone}`);
          break;
        }
      }
    }

    // Fallback: use configured TWILIO_PHONE_NUMBER to find tenant
    if (!tenantId) {
      const twilioPhone = Deno.env.get('TWILIO_PHONE_NUMBER') || '';
      if (twilioPhone) {
        const { data: phoneMatch } = await supabase
          .from('tenant_phone_numbers')
          .select('tenant_id')
          .eq('phone_e164', twilioPhone)
          .eq('active', true)
          .maybeSingle();
        if (phoneMatch) {
          tenantId = phoneMatch.tenant_id;
        } else {
          // Last resort: get any tenant
          const { data: anyTenant } = await supabase.from('tenants').select('id').limit(1).single();
          if (anyTenant) tenantId = anyTenant.id;
        }
      }
    }

    if (!tenantId) {
      // Ultimate fallback
      const { data: anyTenant } = await supabase.from('tenants').select('id').limit(1).single();
      tenantId = anyTenant?.id;
    }

    if (!tenantId) {
      console.error('[el-post-call] Could not resolve tenant');
      return new Response(JSON.stringify({ error: 'tenant_id not resolved' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[el-post-call] tenant=${tenantId} conv=${conversationId} duration=${durationSecs}s callSid=${callSid}`);

    // ═══════════ CHECK IDEMPOTENCY ═══════════
    let callRecord: { id: string } | null = null;

    // Check by Twilio CallSid
    if (callSid) {
      const { data: existing } = await supabase
        .from('call_records')
        .select('id')
        .eq('external_call_id', callSid)
        .maybeSingle();
      if (existing) {
        callRecord = existing;
        console.log(`[el-post-call] Found existing record by CallSid: ${existing.id}`);
      }
    }

    // Check by ElevenLabs conversation_id in extracted_data
    if (!callRecord && conversationId) {
      const { data: existing } = await supabase
        .from('call_records')
        .select('id')
        .eq('external_call_id', conversationId)
        .maybeSingle();
      if (existing) {
        callRecord = existing;
        console.log(`[el-post-call] Found existing record by conversationId: ${existing.id}`);
      }
    }

    const now = new Date().toISOString();
    const startedAt = body.started_at || body.call_started_at || now;
    const endedAt = body.ended_at || body.call_ended_at || now;

    if (callRecord) {
      // Update existing record
      const updateData: Record<string, any> = {
        status: 'completed',
        duration: durationSecs,
        ended_at: endedAt,
      };
      if (transcript) {
        updateData.transcript = transcript;
        updateData.transcript_status = 'ready';
      }
      if (recordingUrl) {
        updateData.audio_url = recordingUrl;
        updateData.recording_status = 'ready';
      }
      if (summary) {
        updateData.summary_system = summary;
        updateData.summary_status = 'ready';
      }
      updateData.extracted_data = {
        elevenlabs_conversation_id: conversationId,
        agent_id: agentId,
        analysis,
        direction: 'inbound',
        conversation_ended: 'intentional',
      };
      await supabase.from('call_records').update(updateData).eq('id', callRecord.id);
      console.log(`[el-post-call] Updated record ${callRecord.id}`);
    } else {
      // Create new record
      const { data: newRecord, error: insertError } = await supabase
        .from('call_records')
        .insert({
          tenant_id: tenantId,
          external_call_id: callSid || conversationId || null,
          from_number: fromNumber || null,
          to_number: toNumber || null,
          status: 'completed',
          channel: 'elevenlabs_inbound',
          duration: durationSecs,
          started_at: startedAt,
          ended_at: endedAt,
          transcript: transcript || null,
          transcript_status: transcript ? 'ready' : 'pending',
          summary_system: summary || null,
          summary_status: summary ? 'ready' : 'pending',
          audio_url: recordingUrl || null,
          recording_status: recordingUrl ? 'ready' : 'not_requested',
          appointment_status: 'not_requested',
          extracted_data: {
            elevenlabs_conversation_id: conversationId,
            agent_id: agentId,
            analysis,
            direction: 'inbound',
            conversation_ended: 'intentional',
          },
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('[el-post-call] Insert error:', insertError);
        throw insertError;
      }
      callRecord = newRecord;
      console.log(`[el-post-call] Created new record ${newRecord.id}`);
    }

    // ═══════════ MARK SESSION AS ENDED INTENTIONALLY ═══════════
    // Signal to call-inbound-webhook re-entry (post <Redirect>) that a subsequent
    // Twilio re-fetch should hang up instead of re-registering the ElevenLabs stream.
    try {
      const sessionUpdate = {
        state: 'completed',
        ended_intentionally: true,
        ended_at: new Date().toISOString(),
      };
      if (callSid) {
        await supabase.from('call_sessions').update(sessionUpdate).eq('call_sid', callSid);
      } else if (callRecord?.id) {
        await supabase.from('call_sessions').update(sessionUpdate).eq('call_record_id', callRecord.id);
      }
    } catch (e) {
      console.warn('[el-post-call] session end-flag update failed:', e);
    }

    // ═══════════ POST-PROCESSING PIPELINE ═══════════
    // Enqueue jobs for any missing processing
    const jobsToEnqueue: string[] = [];
    if (!transcript) jobsToEnqueue.push('transcribe_call');
    if (transcript && !summary) jobsToEnqueue.push('summarize_call');
    if (recordingUrl) jobsToEnqueue.push('fetch_recording');

    for (const jobType of jobsToEnqueue) {
      await supabase.from('call_jobs').upsert({
        tenant_id: tenantId,
        call_id: callRecord!.id,
        job_type: jobType,
        status: 'queued',
        run_after: now,
      }, { onConflict: 'call_id,job_type' }).then(({ error }) => {
        if (error) console.error(`[el-post-call] Job enqueue error (${jobType}):`, error.message);
      });
    }

    // Fetch real usage/cost from ElevenLabs (tokens, TTS chars, STT secs, total USD)
    const elUsage = await fetchElevenLabsConversationUsage(supabase, tenantId, conversationId);
    const aiTokens = elUsage?.llm_tokens ?? (transcript ? Math.ceil(transcript.length / 4) : 0);
    const effectiveDurationSecs = durationSecs || (elUsage?.duration_secs ?? 0);

    // Cost calculation
    let costCalc: { cost_total?: number; revenue?: number } = {};
    try {
      const costRes = await fetch(`${SUPABASE_URL}/functions/v1/calculate-usage-cost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({
          call_record_id: callRecord!.id,
          tenant_id: tenantId,
          duration_seconds: effectiveDurationSecs,
          ai_tokens_used: aiTokens,
          tts_chars: elUsage?.tts_chars ?? null,
          stt_secs: elUsage?.stt_secs ?? null,
          elevenlabs_cost_usd: elUsage?.total_cost_usd ?? null,
        }),
      });
      if (costRes.ok) {
        try { costCalc = await costRes.json(); } catch { /* ignore */ }
      }
    } catch (e) {
      console.error('[el-post-call] Cost calc error:', e);
    }

    // Persist top-level cost/tokens on the call record for the UI
    try {
      await supabase.from('call_records').update({
        cost_total: costCalc?.cost_total ?? null,
        ai_tokens_used: aiTokens,
      }).eq('id', callRecord!.id);
    } catch (e) {
      console.warn('[el-post-call] Failed to update call_records cost/tokens:', e);
    }

    // Stripe metered usage reporting (or invoice item fallback)
    try {
      const durationMinutes = Math.max((effectiveDurationSecs || 0) / 60, 0);
      if (durationMinutes > 0) {
        const { data: sc } = await supabase
          .from('stripe_customers')
          .select('stripe_subscription_id, stripe_item_id_voice, stripe_customer_id')
          .eq('tenant_id', tenantId)
          .maybeSingle();

        const qty = Math.ceil(durationMinutes);
        if (sc?.stripe_item_id_voice) {
          await fetch(`${SUPABASE_URL}/functions/v1/stripe-billing`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({
              action: 'report_usage',
              tenant_id: tenantId,
              subscription_item_id: sc.stripe_item_id_voice,
              quantity: qty,
              call_record_id: callRecord!.id,
            }),
          }).catch((e) => console.warn('[el-post-call] report_usage failed:', e));
        } else if (sc?.stripe_customer_id && costCalc?.revenue) {
          // Fallback: create a Stripe invoice item for this call
          await fetch(`${SUPABASE_URL}/functions/v1/stripe-billing`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({
              action: 'invoice_item_voice_call',
              tenant_id: tenantId,
              amount_usd: costCalc.revenue,
              call_record_id: callRecord!.id,
              description: `Voice call ${callRecord!.id} (${qty} min)`,
            }),
          }).catch((e) => console.warn('[el-post-call] invoice_item fallback failed:', e));
        }
      }
    } catch (e) {
      console.warn('[el-post-call] Stripe usage reporting error:', e);
    }

    // Audit event
    await supabase.from('audit_events').insert({
      tenant_id: tenantId,
      event_type: 'call.elevenlabs_post_call',
      resource_type: 'call_record',
      resource_id: callRecord!.id,
      payload: {
        conversation_id: conversationId,
        agent_id: agentId,
        duration_secs: durationSecs,
        has_transcript: !!transcript,
        has_recording: !!recordingUrl,
        has_summary: !!summary,
      },
    });

    // Trigger job worker
    fetch(`${SUPABASE_URL}/functions/v1/call-job-worker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ trigger: 'elevenlabs-post-call' }),
    }).catch(() => {});

    console.log(`[el-post-call] Done. callRecordId=${callRecord!.id}`);

    return new Response(JSON.stringify({ success: true, callRecordId: callRecord!.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[el-post-call] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
