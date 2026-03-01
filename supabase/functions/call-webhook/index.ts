import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();

    const {
      call_id,
      from_number,
      to_number,
      status,
      duration,
      started_at,
      ended_at,
      transcript,
      audio_url,
      tenant_id: tenantIdParam,
    } = body;

    // ═══════════ RESOLVE TENANT ═══════════
    let tenant_id = tenantIdParam;

    // If no tenant_id provided, try to resolve from phone numbers
    if (!tenant_id) {
      for (const phone of [to_number, from_number].filter(Boolean)) {
        const { data: phoneMatch } = await supabase
          .from('tenant_phone_numbers')
          .select('tenant_id')
          .eq('phone_e164', phone)
          .eq('active', true)
          .maybeSingle();
        if (phoneMatch) {
          tenant_id = phoneMatch.tenant_id;
          console.log(`[call-webhook] Resolved tenant ${tenant_id} from phone ${phone}`);
          break;
        }
      }
    }

    if (!tenant_id) {
      return new Response(JSON.stringify({ error: 'tenant_id could not be resolved' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[call-webhook] call_id=${call_id} tenant=${tenant_id} status=${status}`);

    // ---- Pre-call fraud check: rate limiting ----
    const { data: rateLimit } = await supabase
      .from('tenant_rate_limits')
      .select('is_blocked, blocked_until')
      .eq('tenant_id', tenant_id)
      .maybeSingle();

    if (rateLimit?.is_blocked) {
      const blockedUntil = rateLimit.blocked_until ? new Date(rateLimit.blocked_until) : null;
      if (!blockedUntil || blockedUntil > new Date()) {
        console.log(`[call-webhook] Tenant ${tenant_id} BLOCKED`);
        return new Response(JSON.stringify({
          error: 'Tenant temporarily blocked',
          blocked_until: rateLimit.blocked_until,
        }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        await supabase.from('tenant_rate_limits').update({
          is_blocked: false,
          blocked_reason: null,
          blocked_at: null,
          blocked_until: null,
          updated_at: new Date().toISOString(),
        }).eq('tenant_id', tenant_id);
      }
    }

    // UPSERT call record by external_call_id for idempotency
    const callData: Record<string, any> = {
      tenant_id,
      external_call_id: call_id || null,
      from_number: from_number || null,
      to_number: to_number || null,
      status: status || 'completed',
      duration: duration || 0,
      started_at: started_at || new Date().toISOString(),
      ended_at: ended_at || new Date().toISOString(),
      transcript: transcript || null,
      audio_url: audio_url || null,
      recording_status: audio_url ? 'ready' : 'not_requested',
      transcript_status: transcript?.trim() ? 'ready' : 'pending',
      summary_status: 'pending',
    };

    let callRecord: { id: string } | null = null;

    // Try to find existing record
    if (call_id) {
      const { data: existing } = await supabase
        .from('call_records')
        .select('id')
        .eq('external_call_id', call_id)
        .maybeSingle();

      if (existing) {
        await supabase.from('call_records').update(callData).eq('id', existing.id);
        callRecord = existing;
        console.log(`[call-webhook] Updated existing call ${existing.id}`);
      }
    }

    if (!callRecord) {
      const { data: newRecord, error } = await supabase
        .from('call_records')
        .insert(callData)
        .select('id')
        .single();
      if (error) throw error;
      callRecord = newRecord;
      console.log(`[call-webhook] Created new call ${newRecord.id}`);
    }

    // Enqueue async jobs (idempotent via unique constraint)
    const jobsToEnqueue = [];

    if (audio_url || call_id) {
      jobsToEnqueue.push({ job_type: 'fetch_recording' });
    }

    if (transcript?.trim()) {
      jobsToEnqueue.push({ job_type: 'summarize_call' });
    } else {
      jobsToEnqueue.push({ job_type: 'transcribe_call' });
    }

    for (const job of jobsToEnqueue) {
      await supabase.from('call_jobs').upsert({
        tenant_id,
        call_id: callRecord!.id,
        job_type: job.job_type,
        status: 'queued',
        run_after: new Date().toISOString(),
      }, { onConflict: 'call_id,job_type' }).then(({ error }) => {
        if (error) console.error(`[call-webhook] Job enqueue error (${job.job_type}):`, error.message);
      });
    }

    // Trigger cost calculation immediately
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/calculate-usage-cost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({
          call_record_id: callRecord!.id,
          tenant_id,
          duration_seconds: duration || 0,
          ai_tokens_used: transcript ? Math.ceil(transcript.length / 4) : 0,
        }),
      });
    } catch (e) {
      console.error('[call-webhook] Cost calc error:', e);
    }

    // Trigger fraud detection
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/fraud-detection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({
          tenant_id,
          call_record_id: callRecord!.id,
          duration_seconds: duration || 0,
          cost_total: 0,
          from_number,
          started_at: started_at || new Date().toISOString(),
        }),
      });
    } catch (e) {
      console.error('[call-webhook] Fraud detection error:', e);
    }

    // Audit event
    await supabase.from('audit_events').insert({
      tenant_id,
      event_type: 'call.webhook_received',
      resource_type: 'call_record',
      resource_id: callRecord?.id,
      payload: { call_id, status, duration, jobs_enqueued: jobsToEnqueue.map(j => j.job_type) },
    });

    // Trigger job worker (fire and forget)
    fetch(`${SUPABASE_URL}/functions/v1/call-job-worker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ trigger: 'call-webhook' }),
    }).catch(() => {});

    return new Response(JSON.stringify({ success: true, callRecordId: callRecord?.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[call-webhook] Error:', errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
