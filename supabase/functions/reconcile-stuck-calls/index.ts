import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

/**
 * reconcile-stuck-calls
 *
 * Recovers call_records that got stuck without transcript/summary because the
 * ElevenLabs post-call webhook never landed (401, network drop, workspace
 * misconfig, etc.).
 *
 * Modes:
 *  - Batch (default): processes stuck calls in a bounded batch.
 *  - Single call: pass { call_id } to force reconciliation for one record
 *    (used by UI "Reintentar transcripción" and by the call-jobs watchdog).
 *
 * Idempotent: safe to call repeatedly, safe to run in parallel with the
 * regular post-call webhook. It only writes when the record still lacks a
 * transcript/summary.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STUCK_STATES_TRANSCRIPT = ['pending', 'processing', 'not_requested'];
const STUCK_STATES_SUMMARY = ['pending', 'processing'];
const MAX_BATCH = 25;
const GIVE_UP_AFTER_HOURS = 2;
const MIN_AGE_MINUTES = 10;

const EL_BASE = 'https://api.elevenlabs.io/v1/convai';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const EL_KEY = Deno.env.get('ELEVENLABS_API_KEY') || '';
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: any = {};
  try { body = req.method === 'POST' ? await req.json() : {}; } catch { body = {}; }

  const singleCallId: string | undefined = body?.call_id;
  const trigger: string = body?.trigger || (singleCallId ? 'single' : 'batch');

  try {
    let stuck: any[] = [];

    if (singleCallId) {
      const { data } = await supabase
        .from('call_records')
        .select('id, tenant_id, external_call_id, extracted_data, ended_at, transcript, transcript_status, summary_status')
        .eq('id', singleCallId)
        .is('deleted_at', null)
        .maybeSingle();
      if (data) stuck = [data];
    } else {
      const cutoff = new Date(Date.now() - MIN_AGE_MINUTES * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('call_records')
        .select('id, tenant_id, external_call_id, extracted_data, ended_at, transcript, transcript_status, summary_status')
        .is('deleted_at', null)
        .is('transcript', null)
        .lt('ended_at', cutoff)
        .or(
          `transcript_status.in.(${STUCK_STATES_TRANSCRIPT.join(',')}),summary_status.in.(${STUCK_STATES_SUMMARY.join(',')})`
        )
        .order('ended_at', { ascending: true })
        .limit(MAX_BATCH);
      stuck = data || [];
    }

    const counters = { candidates: stuck.length, backfilled: 0, gave_up: 0, still_pending: 0, errors: 0 };
    const details: any[] = [];

    for (const rec of stuck) {
      try {
        // Skip records where a concurrent post-call already filled the transcript.
        if (rec.transcript && rec.transcript.trim().length > 0) {
          counters.still_pending += 1;
          continue;
        }

        // Resolve ElevenLabs conversation_id.
        let convId: string | null =
          rec.extracted_data?.elevenlabs_conversation_id ||
          rec.extracted_data?.conversation_id ||
          null;

        // If we only have a Twilio CallSid (CA...), ask ElevenLabs to map it.
        if (!convId && EL_KEY && rec.external_call_id?.startsWith('CA')) {
          try {
            const r = await fetch(`${EL_BASE}/conversations?call_sid=${encodeURIComponent(rec.external_call_id)}`, {
              headers: { 'xi-api-key': EL_KEY },
            });
            if (r.ok) {
              const j = await r.json();
              const first = Array.isArray(j?.conversations) ? j.conversations[0] : (j?.conversation || j?.data?.[0]);
              convId = first?.conversation_id || first?.id || null;
            }
          } catch (e) {
            console.warn(`[reconcile] mapping call_sid → conversation_id failed for ${rec.id}:`, (e as Error).message);
          }
        }

        // Fetch the full conversation payload from ElevenLabs.
        let convPayload: any = null;
        if (convId && EL_KEY) {
          try {
            const r = await fetch(`${EL_BASE}/conversations/${encodeURIComponent(convId)}`, {
              headers: { 'xi-api-key': EL_KEY },
            });
            if (r.ok) convPayload = await r.json();
            else console.warn(`[reconcile] GET conversation ${convId} → ${r.status}`);
          } catch (e) {
            console.warn(`[reconcile] fetch conversation ${convId} failed:`, (e as Error).message);
          }
        }

        // Extract transcript / summary from the ElevenLabs payload.
        let transcript = '';
        let summary = '';
        let recordingUrl: string | null = null;
        let durationSecs: number | null = null;

        if (convPayload) {
          const raw = convPayload.transcript ?? convPayload.conversation_transcript;
          if (typeof raw === 'string') transcript = raw;
          else if (Array.isArray(raw)) {
            transcript = raw
              .map((t: any) => `${t.role || 'unknown'}: ${t.message || t.text || ''}`)
              .join('\n');
          }
          const analysis = convPayload.analysis || convPayload.call_analysis || {};
          summary = analysis.summary || analysis.call_summary || convPayload.summary || '';
          recordingUrl = convPayload.recording_url || convPayload.audio_url || null;
          durationSecs = convPayload.call_duration_secs ?? convPayload.duration ?? null;
        }

        if (transcript.trim().length > 0) {
          // Backfill success — mirror the shape of elevenlabs-post-call.
          const updateData: Record<string, any> = {
            status: 'completed',
            transcript,
            transcript_status: 'ready',
          };
          if (summary) { updateData.summary_system = summary; updateData.summary_status = 'ready'; }
          if (recordingUrl) { updateData.audio_url = recordingUrl; updateData.recording_status = 'ready'; }
          if (durationSecs && durationSecs > 0) updateData.duration = durationSecs;
          updateData.extracted_data = {
            ...(rec.extracted_data || {}),
            elevenlabs_conversation_id: convId,
            reconciled_at: new Date().toISOString(),
            reconciled_by: 'reconcile-stuck-calls',
          };
          await supabase.from('call_records').update(updateData).eq('id', rec.id);

          // Enqueue downstream jobs (summarize if summary missing, extract_appointment).
          const jobsToEnqueue: string[] = [];
          if (!summary) jobsToEnqueue.push('summarize_call');
          jobsToEnqueue.push('extract_appointment');
          for (const jobType of jobsToEnqueue) {
            await supabase.from('call_jobs').upsert({
              tenant_id: rec.tenant_id,
              call_id: rec.id,
              job_type: jobType,
              status: 'queued',
              run_after: new Date().toISOString(),
            }, { onConflict: 'call_id,job_type' });
          }

          await supabase.from('audit_events').insert({
            tenant_id: rec.tenant_id,
            event_type: 'call.reconciled_backfill',
            resource_type: 'call_record',
            resource_id: rec.id,
            payload: { conversation_id: convId, source: 'elevenlabs_api', trigger },
          });

          counters.backfilled += 1;
          details.push({ call_id: rec.id, outcome: 'backfilled', conversation_id: convId });
          continue;
        }

        // No transcript recoverable. Decide: give up terminally or wait more.
        const ageHours = rec.ended_at
          ? (Date.now() - new Date(rec.ended_at).getTime()) / 3_600_000
          : 999;

        if (ageHours >= GIVE_UP_AFTER_HOURS) {
          await supabase.from('call_records').update({
            transcript_status: 'failed_transcription',
            summary_status: 'no_summary_available',
          }).eq('id', rec.id);

          await supabase.from('audit_events').insert({
            tenant_id: rec.tenant_id,
            event_type: 'call.reconciliation_gave_up',
            resource_type: 'call_record',
            resource_id: rec.id,
            payload: {
              conversation_id: convId,
              age_hours: Number(ageHours.toFixed(2)),
              reason: convId ? 'elevenlabs_returned_empty' : 'no_conversation_id_resolved',
              trigger,
            },
          });

          counters.gave_up += 1;
          details.push({ call_id: rec.id, outcome: 'failed_terminal', age_hours: Number(ageHours.toFixed(2)) });
        } else {
          counters.still_pending += 1;
          details.push({ call_id: rec.id, outcome: 'still_pending', age_hours: Number(ageHours.toFixed(2)) });
        }
      } catch (e) {
        counters.errors += 1;
        console.error(`[reconcile] error on ${rec.id}:`, (e as Error).message);
        details.push({ call_id: rec.id, outcome: 'error', error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ ok: true, trigger, counters, details }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[reconcile-stuck-calls] fatal:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
