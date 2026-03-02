import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // ═══════════ PARSE PARAMS ═══════════
    const contentType = req.headers.get('content-type') || '';
    let params: Record<string, string> = {};
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      formData.forEach((value, key) => { params[key] = String(value); });
    } else {
      params = await req.json();
    }

    const callSid = params.CallSid || params.call_sid || '';
    const callStatus = params.CallStatus || params.status || '';
    const from = params.From || params.from_number || '';
    const to = params.To || params.to_number || '';
    const duration = parseInt(params.CallDuration || params.Duration || params.duration || '0', 10);
    const recordingUrl = params.RecordingUrl || params.recording_url || '';
    const recordingSid = params.RecordingSid || params.recording_sid || '';
    const recordingDuration = parseInt(params.RecordingDuration || '0', 10);
    const tenantIdParam = params.tenant_id || '';

    console.log(`[status] CallSid=${callSid} Status=${callStatus} From=${from} To=${to}`);

    // ═══════════ TWILIO SIGNATURE VALIDATION ═══════════
    if (TWILIO_AUTH_TOKEN) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') || '';
      if (twilioSignature) {
        const webhookUrl = `${SUPABASE_URL}/functions/v1/call-status-webhook`;
        const isValid = await validateTwilioSignature(TWILIO_AUTH_TOKEN, twilioSignature, webhookUrl, params);
        if (!isValid) {
          console.error(`[status] INVALID Twilio signature for CallSid=${callSid}`);
          return new Response(JSON.stringify({ error: 'Invalid signature' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        console.log(`[status] Twilio signature VALID`);
      }
    }

    if (!callSid) {
      return new Response(JSON.stringify({ error: 'Missing CallSid' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const direction = params.Direction || params.direction || '';
    const statusMap: Record<string, string> = {
      'initiated': 'initiated', 'queued': 'initiated', 'ringing': 'ringing',
      'in-progress': 'in_progress', 'completed': 'completed', 'busy': 'busy',
      'failed': 'failed', 'no-answer': 'no_answer', 'canceled': 'canceled',
    };
    const mappedStatus = statusMap[callStatus] || callStatus;

    // ═══════════ RESOLVE TENANT ═══════════
    let resolvedTenantId: string | null = null;
    let callRecord: { id: string; tenant_id: string } | null = null;

    // 1. Find existing call record by CallSid
    const { data: existing } = await supabase
      .from('call_records').select('id, tenant_id').eq('external_call_id', callSid).maybeSingle();
    if (existing) {
      callRecord = existing;
      resolvedTenantId = existing.tenant_id;
    }

    // 2. Resolve by phone number
    if (!resolvedTenantId) {
      for (const phone of [to, from].filter(Boolean)) {
        const { data: phoneMatch } = await supabase
          .from('tenant_phone_numbers').select('tenant_id').eq('phone_e164', phone).eq('active', true).maybeSingle();
        if (phoneMatch) {
          resolvedTenantId = phoneMatch.tenant_id;
          console.log(`[status] Resolved tenant ${resolvedTenantId} from phone ${phone}`);
          break;
        }
      }
    }

    // 3. Fallback to param
    if (!resolvedTenantId && tenantIdParam) resolvedTenantId = tenantIdParam;

    // 4. Last resort: recent call match
    if (!callRecord && !resolvedTenantId) {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recentCall } = await supabase
        .from('call_records').select('id, tenant_id')
        .or(`from_number.eq.${from},to_number.eq.${to}`)
        .is('external_call_id', null)
        .gte('created_at', fiveMinAgo)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (recentCall) {
        callRecord = recentCall;
        resolvedTenantId = recentCall.tenant_id;
        await supabase.from('call_records').update({ external_call_id: callSid }).eq('id', recentCall.id);
      }
    }

    // Create new record if needed
    if (!callRecord && resolvedTenantId) {
      const { data: newRecord, error: insertError } = await supabase
        .from('call_records')
        .insert({
          tenant_id: resolvedTenantId, external_call_id: callSid,
          from_number: from, to_number: to, status: mappedStatus,
          channel: 'twilio', started_at: new Date().toISOString(),
          recording_status: 'not_requested', transcript_status: 'pending',
          summary_status: 'pending', appointment_status: 'not_requested',
        })
        .select('id, tenant_id').single();
      if (insertError) {
        console.error('[status] Insert error:', insertError);
      } else {
        callRecord = newRecord;
      }
    }

    if (!callRecord) {
      console.warn(`[status] No call record for CallSid=${callSid}`);
      return new Response('<Response></Response>', {
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
      });
    }

    // ═══════════ PERSIST EVENT (AUDIT) ═══════════
    await supabase.from('call_events').insert({
      call_record_id: callRecord.id,
      tenant_id: callRecord.tenant_id,
      event_type: mappedStatus,
      twilio_call_sid: callSid,
      event_data: {
        raw_status: callStatus, from, to, duration,
        recording_url: recordingUrl || undefined,
        recording_sid: recordingSid || undefined,
        recording_duration: recordingDuration || undefined,
        timestamp: new Date().toISOString(),
      },
    });

    // ═══════════ UPDATE CALL RECORD ═══════════
    const updateData: Record<string, any> = { status: mappedStatus };
    if (['completed', 'busy', 'failed', 'no_answer', 'canceled'].includes(mappedStatus)) {
      updateData.ended_at = new Date().toISOString();
      if (duration > 0) updateData.duration = duration;
    }
    if (recordingUrl) {
      updateData.audio_url = recordingUrl + '.mp3';
      updateData.recording_status = 'ready';
    }
    await supabase.from('call_records').update(updateData).eq('id', callRecord.id);

    // ═══════════ UPDATE CALL SESSION STATE ═══════════
    if (['completed', 'failed', 'no_answer', 'canceled', 'busy'].includes(mappedStatus)) {
      await supabase.from('call_sessions')
        .update({ state: mappedStatus === 'completed' ? 'completed' : 'ended_' + mappedStatus })
        .eq('call_sid', callSid);
    } else if (mappedStatus === 'in_progress') {
      await supabase.from('call_sessions')
        .update({ state: 'in_progress' })
        .eq('call_sid', callSid);
    }

    // ═══════════ POST-COMPLETION PIPELINE ═══════════
    if (mappedStatus === 'completed') {
      const effectiveTenantId = callRecord.tenant_id;

      // Cost calculation
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/calculate-usage-cost`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ call_record_id: callRecord.id, tenant_id: effectiveTenantId, duration_seconds: duration || 0, ai_tokens_used: 0 }),
        });
      } catch (e) { console.error('[status] Cost calc error:', e); }

      // Fraud detection
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/fraud-detection`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ tenant_id: effectiveTenantId, call_record_id: callRecord.id, duration_seconds: duration || 0, cost_total: 0, from_number: from, started_at: new Date().toISOString() }),
        });
      } catch (e) { console.error('[status] Fraud detection error:', e); }

      // Enqueue async jobs
      const jobTypes = ['fetch_recording', 'transcribe_call'];
      const { data: fullRecord } = await supabase.from('call_records').select('transcript').eq('id', callRecord.id).single();
      if (fullRecord?.transcript?.trim()) {
        jobTypes.push('summarize_call');
        await supabase.from('call_records').update({ transcript_status: 'ready', summary_status: 'pending' }).eq('id', callRecord.id);
      }
      await supabase.from('call_records').update({ recording_status: recordingUrl ? 'ready' : 'pending' }).eq('id', callRecord.id);

      for (const jobType of jobTypes) {
        await supabase.from('call_jobs').upsert({
          tenant_id: effectiveTenantId, call_id: callRecord.id,
          job_type: jobType, status: 'queued', run_after: new Date().toISOString(),
        }, { onConflict: 'call_id,job_type' }).then(({ error }) => {
          if (error) console.error(`[status] Job enqueue error (${jobType}):`, error.message);
        });
      }

      // Trigger job worker (fire and forget)
      fetch(`${SUPABASE_URL}/functions/v1/call-job-worker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ trigger: 'call-status-webhook' }),
      }).catch(() => {});
    }

    return new Response('<Response></Response>', {
      headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[status] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
