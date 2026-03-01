import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Twilio sends form-encoded data
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

    console.log(`[call-status-webhook] CallSid=${callSid} Status=${callStatus} From=${from} To=${to}`);

    if (!callSid) {
      return new Response(JSON.stringify({ error: 'Missing CallSid' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Determine call direction from Twilio parameters
    const direction = params.Direction || params.direction || '';
    const isOutbound = direction === 'outbound-api' || direction === 'outbound-dial';
    console.log(`[call-status-webhook] Direction=${direction} isOutbound=${isOutbound}`);

    // Map Twilio status to our internal status
    const statusMap: Record<string, string> = {
      'initiated': 'initiated',
      'queued': 'initiated',
      'ringing': 'ringing',
      'in-progress': 'in_progress',
      'completed': 'completed',
      'busy': 'busy',
      'failed': 'failed',
      'no-answer': 'no_answer',
      'canceled': 'canceled',
    };
    const mappedStatus = statusMap[callStatus] || callStatus;

    // ═══════════ RESOLVE TENANT ═══════════
    // Priority: 1) existing call record, 2) phone number lookup, 3) param, 4) fallback
    let resolvedTenantId: string | null = null;

    // 1. Try to find existing call record by CallSid
    let callRecord: { id: string; tenant_id: string } | null = null;
    const { data: existing } = await supabase
      .from('call_records')
      .select('id, tenant_id')
      .eq('external_call_id', callSid)
      .maybeSingle();

    if (existing) {
      callRecord = existing;
      resolvedTenantId = existing.tenant_id;
    }

    // 2. Resolve tenant by phone number (To first, then From)
    if (!resolvedTenantId) {
      for (const phone of [to, from].filter(Boolean)) {
        const { data: phoneMatch } = await supabase
          .from('tenant_phone_numbers')
          .select('tenant_id')
          .eq('phone_e164', phone)
          .eq('active', true)
          .maybeSingle();
        if (phoneMatch) {
          resolvedTenantId = phoneMatch.tenant_id;
          console.log(`[call-status-webhook] Resolved tenant ${resolvedTenantId} from phone ${phone}`);
          break;
        }
      }
    }

    // 3. Fallback to param
    if (!resolvedTenantId && tenantIdParam) {
      resolvedTenantId = tenantIdParam;
    }

    // 4. Last resort: match by phone + recent time window
    if (!callRecord && !resolvedTenantId) {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recentCall } = await supabase
        .from('call_records')
        .select('id, tenant_id')
        .or(`from_number.eq.${from},to_number.eq.${to}`)
        .is('external_call_id', null)
        .gte('created_at', fiveMinAgo)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentCall) {
        callRecord = recentCall;
        resolvedTenantId = recentCall.tenant_id;
        await supabase
          .from('call_records')
          .update({ external_call_id: callSid })
          .eq('id', recentCall.id);
      }
    }

    // Create new record if none found and we have a tenant
    if (!callRecord && resolvedTenantId) {
      const { data: newRecord, error: insertError } = await supabase
        .from('call_records')
        .insert({
          tenant_id: resolvedTenantId,
          external_call_id: callSid,
          from_number: from,
          to_number: to,
          status: mappedStatus,
          channel: 'twilio',
          started_at: new Date().toISOString(),
          recording_status: 'not_requested',
          transcript_status: 'pending',
          summary_status: 'pending',
          appointment_status: 'not_requested',
        })
        .select('id, tenant_id')
        .single();

      if (insertError) {
        console.error('[call-status-webhook] Insert error:', insertError);
      } else {
        callRecord = newRecord;
      }
    }

    if (!callRecord) {
      console.warn(`[call-status-webhook] No call record and no tenant for CallSid=${callSid}`);
      return new Response('<Response></Response>', {
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
      });
    }

    // Persist the event
    await supabase.from('call_events').insert({
      call_record_id: callRecord.id,
      tenant_id: callRecord.tenant_id,
      event_type: mappedStatus,
      twilio_call_sid: callSid,
      event_data: {
        raw_status: callStatus,
        from, to, duration,
        recording_url: recordingUrl || undefined,
        recording_sid: recordingSid || undefined,
        recording_duration: recordingDuration || undefined,
        timestamp: new Date().toISOString(),
      },
    });

    // Update call record based on status
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

    // ═══════════ POST-COMPLETION PIPELINE ═══════════
    if (mappedStatus === 'completed') {
      const effectiveTenantId = callRecord.tenant_id;

      // 1. Cost calculation
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/calculate-usage-cost`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({
            call_record_id: callRecord.id,
            tenant_id: effectiveTenantId,
            duration_seconds: duration || 0,
            ai_tokens_used: 0,
          }),
        });
      } catch (e) {
        console.error('[call-status-webhook] Cost calc error:', e);
      }

      // 2. Fraud detection
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/fraud-detection`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({
            tenant_id: effectiveTenantId,
            call_record_id: callRecord.id,
            duration_seconds: duration || 0,
            cost_total: 0,
            from_number: from,
            started_at: new Date().toISOString(),
          }),
        });
      } catch (e) {
        console.error('[call-status-webhook] Fraud detection error:', e);
      }

      // 3. Enqueue async jobs with status tracking
      const jobTypes = ['fetch_recording', 'transcribe_call'];

      // Check if transcript already exists
      const { data: fullRecord } = await supabase
        .from('call_records')
        .select('transcript')
        .eq('id', callRecord.id)
        .single();

      if (fullRecord?.transcript?.trim()) {
        jobTypes.push('summarize_call');
        await supabase.from('call_records').update({
          transcript_status: 'ready',
          summary_status: 'pending',
        }).eq('id', callRecord.id);
      }

      // Update recording status
      await supabase.from('call_records').update({
        recording_status: recordingUrl ? 'ready' : 'pending',
      }).eq('id', callRecord.id);

      for (const jobType of jobTypes) {
        await supabase.from('call_jobs').upsert({
          tenant_id: effectiveTenantId,
          call_id: callRecord.id,
          job_type: jobType,
          status: 'queued',
          run_after: new Date().toISOString(),
        }, { onConflict: 'call_id,job_type' }).then(({ error }) => {
          if (error) console.error(`[call-status-webhook] Job enqueue error (${jobType}):`, error.message);
        });
      }

      // 4. Trigger job worker (fire and forget)
      fetch(`${SUPABASE_URL}/functions/v1/call-job-worker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ trigger: 'call-status-webhook' }),
      }).catch(() => {});
    }

    // Twilio expects TwiML or 200 OK
    return new Response('<Response></Response>', {
      headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[call-status-webhook] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
