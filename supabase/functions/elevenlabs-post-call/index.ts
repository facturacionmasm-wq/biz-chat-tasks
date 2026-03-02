import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

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

  try {
    const body = await req.json();
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

    // Cost calculation
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/calculate-usage-cost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({
          call_record_id: callRecord!.id,
          tenant_id: tenantId,
          duration_seconds: durationSecs,
          ai_tokens_used: transcript ? Math.ceil(transcript.length / 4) : 0,
        }),
      });
    } catch (e) {
      console.error('[el-post-call] Cost calc error:', e);
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
