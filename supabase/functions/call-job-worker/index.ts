import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_JOBS_PER_RUN = 10;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const results: Array<{ job_id: string; job_type: string; status: string; error?: string }> = [];

  try {
    // Fetch queued jobs ready to run
    const { data: jobs, error: fetchErr } = await supabase
      .from('call_jobs')
      .select('*')
      .eq('status', 'queued')
      .lte('run_after', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(MAX_JOBS_PER_RUN);

    if (fetchErr) throw fetchErr;
    if (!jobs || jobs.length === 0) {
      return jsonResp({ message: 'No jobs to process', processed: 0 });
    }

    console.log(`[call-job-worker] Processing ${jobs.length} jobs`);

    for (const job of jobs) {
      // Mark as running
      await supabase.from('call_jobs').update({
        status: 'running',
        attempts: job.attempts + 1,
      }).eq('id', job.id);

      try {
        let resultData: Record<string, any> = {};

        switch (job.job_type) {
          case 'fetch_recording':
            resultData = await jobFetchRecording(supabase, job, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
            break;
          case 'transcribe_call':
            resultData = await jobTranscribeCall(supabase, job);
            break;
          case 'summarize_call':
            resultData = await jobSummarizeCall(supabase, job, LOVABLE_API_KEY);
            break;
          case 'extract_appointment':
            resultData = await jobExtractAppointment(supabase, job, LOVABLE_API_KEY, SUPABASE_URL, SERVICE_KEY);
            break;
          default:
            throw new Error(`Unknown job type: ${job.job_type}`);
        }

        await supabase.from('call_jobs').update({
          status: 'success',
          result_data: resultData,
        }).eq('id', job.id);

        results.push({ job_id: job.id, job_type: job.job_type, status: 'success' });
        console.log(`[call-job-worker] Job ${job.job_type} for call ${job.call_id}: SUCCESS`);

      } catch (jobErr: any) {
        const errMsg = jobErr.message || 'Unknown error';
        const shouldRetry = job.attempts + 1 < job.max_attempts;
        const backoffMinutes = Math.pow(2, job.attempts + 1) * 2; // 4, 8, 16 min
        const runAfter = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

        await supabase.from('call_jobs').update({
          status: shouldRetry ? 'queued' : 'error',
          last_error: errMsg,
          run_after: shouldRetry ? runAfter : job.run_after,
        }).eq('id', job.id);

        // Audit log on final failure
        if (!shouldRetry) {
          await supabase.from('audit_events').insert({
            tenant_id: job.tenant_id,
            event_type: 'call_job.failed',
            resource_type: 'call_job',
            resource_id: job.id,
            payload: { job_type: job.job_type, call_id: job.call_id, error: errMsg, attempts: job.attempts + 1 },
          });
        }

        results.push({ job_id: job.id, job_type: job.job_type, status: shouldRetry ? 'retry' : 'error', error: errMsg });
        console.error(`[call-job-worker] Job ${job.job_type} for call ${job.call_id}: FAILED - ${errMsg}`);
      }
    }

    return jsonResp({ processed: results.length, results });

  } catch (error: any) {
    console.error('[call-job-worker] Fatal error:', error.message);
    return jsonResp({ error: error.message }, 500);
  }
});

// ═══════════════════════════════════════════════
// JOB: fetch_recording
// Fetches recording URL from Twilio and optionally stores in Storage
// ═══════════════════════════════════════════════
async function jobFetchRecording(
  supabase: any, job: any,
  twilioSid?: string, twilioToken?: string
) {
  const { data: call } = await supabase
    .from('call_records')
    .select('external_call_id, audio_url, tenant_id')
    .eq('id', job.call_id)
    .single();

  if (!call) throw new Error('Call record not found');

  // If audio_url already set (from webhook), we're done
  if (call.audio_url) {
    await supabase.from('call_records').update({ recording_status: 'available' } as any).eq('id', job.call_id);
    return { audio_url: call.audio_url, source: 'existing' };
  }

  // Try fetching from Twilio API
  if (!twilioSid || !twilioToken || !call.external_call_id) {
    throw new Error('No recording available and Twilio credentials not configured');
  }

  const twilioAuth = btoa(`${twilioSid}:${twilioToken}`);
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls/${call.external_call_id}/Recordings.json`,
    { headers: { Authorization: `Basic ${twilioAuth}` } }
  );

  if (!res.ok) throw new Error(`Twilio API error: ${res.status}`);
  const data = await res.json();

  if (!data.recordings || data.recordings.length === 0) {
    throw new Error('No recordings found for this call');
  }

  const recording = data.recordings[0];
  const recordingUrl = `https://api.twilio.com${recording.uri.replace('.json', '.mp3')}`;

  await supabase.from('call_records').update({
    audio_url: recordingUrl,
  }).eq('id', job.call_id);

  // Enqueue transcription job now that recording exists
  await supabase.from('call_jobs').upsert({
    tenant_id: job.tenant_id,
    call_id: job.call_id,
    job_type: 'transcribe_call',
    status: 'queued',
    run_after: new Date().toISOString(),
  }, { onConflict: 'call_id,job_type' });

  return { audio_url: recordingUrl, recording_sid: recording.sid };
}

// ═══════════════════════════════════════════════
// JOB: transcribe_call
// Checks if transcript already exists; if not, marks as needing manual/external transcription
// ═══════════════════════════════════════════════
async function jobTranscribeCall(supabase: any, job: any) {
  const { data: call } = await supabase
    .from('call_records')
    .select('transcript, audio_url')
    .eq('id', job.call_id)
    .single();

  if (!call) throw new Error('Call record not found');

  // If transcript already exists (from ElevenLabs real-time capture), chain to summary
  if (call.transcript?.trim()) {
    // Enqueue summarize
    await supabase.from('call_jobs').upsert({
      tenant_id: job.tenant_id,
      call_id: job.call_id,
      job_type: 'summarize_call',
      status: 'queued',
      run_after: new Date().toISOString(),
    }, { onConflict: 'call_id,job_type' });

    return { status: 'transcript_exists', length: call.transcript.length };
  }

  // No transcript and no audio → nothing to do
  if (!call.audio_url) {
    return { status: 'no_audio_no_transcript' };
  }

  // For now, mark that transcript needs external processing
  // In the future, integrate ElevenLabs STT or another provider here
  return { status: 'awaiting_transcription_service', audio_url: call.audio_url };
}

// ═══════════════════════════════════════════════
// JOB: summarize_call
// Generates AI summary + extracted data from transcript
// ═══════════════════════════════════════════════
async function jobSummarizeCall(supabase: any, job: any, apiKey: string) {
  const { data: call } = await supabase
    .from('call_records')
    .select('transcript, summary_system')
    .eq('id', job.call_id)
    .single();

  if (!call) throw new Error('Call record not found');
  if (!call.transcript?.trim()) throw new Error('No transcript to summarize');

  // Skip if already has a summary
  if (call.summary_system?.trim()) {
    // Still enqueue appointment extraction
    await supabase.from('call_jobs').upsert({
      tenant_id: job.tenant_id,
      call_id: job.call_id,
      job_type: 'extract_appointment',
      status: 'queued',
      run_after: new Date().toISOString(),
    }, { onConflict: 'call_id,job_type' });
    return { status: 'summary_exists' };
  }

  const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-3-flash-preview',
      messages: [
        {
          role: 'system',
          content: `Analiza esta transcripción de llamada y genera:
1. Un resumen estructurado en markdown
2. Un JSON con datos extraídos

Formato del resumen:
**Resumen:** (2-3 líneas)
**Sentimiento general:** (positivo/neutro/negativo) — Puntuación: X/10
**Puntos clave:** (bullet list)
**Acciones sugeridas:** (bullet list)
**⚠️ Riesgos y alertas:** (bullet list, o "Sin riesgos detectados")
**Temas principales:** tema1, tema2, tema3
**Seguimiento recomendado:** (fecha y contexto)

Formato del JSON (devuelve al final entre \`\`\`json y \`\`\`):
{"contactName":"","reason":"","intent":"","budget":"","urgency":"alta|media|baja","sentiment":"positivo|neutro|negativo","sentimentScore":7,"keyTopics":[],"suggestedTags":[],"objections":[],"agreements":[],"risks":[],"alerts":[],"followUp":"ISO date or empty","appointmentRequested":false,"appointmentDate":"","appointmentTime":"","appointmentService":""}

IMPORTANTE: Si el usuario pidió agendar una cita, establece appointmentRequested=true y extrae fecha/hora/servicio.`,
        },
        { role: 'user', content: call.transcript },
      ],
    }),
  });

  if (!aiResponse.ok) throw new Error(`AI API error: ${aiResponse.status}`);

  const aiResult = await aiResponse.json();
  const summary = aiResult.choices?.[0]?.message?.content || '';

  let extractedData: Record<string, any> = {};
  const jsonMatch = summary.match(/```json\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try { extractedData = JSON.parse(jsonMatch[1]); } catch {}
  }

  const tags = extractedData.suggestedTags || [];

  await supabase.from('call_records').update({
    summary_system: summary.replace(/```json[\s\S]*?```/, '').trim(),
    extracted_data: extractedData,
    tags,
  }).eq('id', job.call_id);

  // If appointment was requested, enqueue extraction
  if (extractedData.appointmentRequested) {
    await supabase.from('call_jobs').upsert({
      tenant_id: job.tenant_id,
      call_id: job.call_id,
      job_type: 'extract_appointment',
      status: 'queued',
      run_after: new Date().toISOString(),
    }, { onConflict: 'call_id,job_type' });
  }

  return { summary_length: summary.length, tags, appointmentRequested: !!extractedData.appointmentRequested };
}

// ═══════════════════════════════════════════════
// JOB: extract_appointment
// If transcript contains appointment request, creates appointment via voice-scheduling
// ═══════════════════════════════════════════════
async function jobExtractAppointment(
  supabase: any, job: any, apiKey: string,
  supabaseUrl: string, serviceKey: string
) {
  const { data: call } = await supabase
    .from('call_records')
    .select('extracted_data, transcript, tenant_id, from_number')
    .eq('id', job.call_id)
    .single();

  if (!call) throw new Error('Call record not found');

  const extracted = call.extracted_data || {};

  // Check if appointment was already created for this call
  const { data: existingApt } = await supabase
    .from('appointments')
    .select('id')
    .eq('call_record_id', job.call_id)
    .maybeSingle();

  if (existingApt) {
    return { status: 'appointment_already_exists', appointment_id: existingApt.id };
  }

  // Need extracted appointment data
  if (!extracted.appointmentRequested) {
    return { status: 'no_appointment_requested' };
  }

  if (!extracted.appointmentDate || !extracted.appointmentTime) {
    return { status: 'incomplete_appointment_data', extracted };
  }

  // Call voice-scheduling to book
  const bookRes = await fetch(`${supabaseUrl}/functions/v1/voice-scheduling`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      action: 'book_appointment',
      data: {
        tenant_id: call.tenant_id,
        contact_name: extracted.contactName || 'Cliente',
        contact_phone: call.from_number || null,
        start_at: `${extracted.appointmentDate}T${extracted.appointmentTime}:00`,
        service_type: extracted.appointmentService || 'general',
        source: 'call',
        call_record_id: job.call_id,
      },
    }),
  });

  if (!bookRes.ok) {
    const errText = await bookRes.text();
    throw new Error(`Booking failed: ${errText}`);
  }

  const bookData = await bookRes.json();

  // Audit
  await supabase.from('audit_events').insert({
    tenant_id: job.tenant_id,
    event_type: 'appointment.auto_created',
    resource_type: 'appointment',
    resource_id: bookData.appointment?.id,
    payload: { call_id: job.call_id, source: 'call_job_worker', extracted },
  });

  return { status: 'appointment_created', appointment: bookData.appointment };
}

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Content-Type': 'application/json',
    },
  });
}
