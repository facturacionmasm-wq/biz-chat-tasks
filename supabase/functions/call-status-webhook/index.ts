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
    const tenantId = params.tenant_id || '';

    console.log(`[call-status-webhook] CallSid=${callSid} Status=${callStatus} From=${from} To=${to}`);

    if (!callSid) {
      return new Response(JSON.stringify({ error: 'Missing CallSid' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    // Find or create the call record by external_call_id (Twilio CallSid)
    let { data: callRecord } = await supabase
      .from('call_records')
      .select('id, tenant_id')
      .eq('external_call_id', callSid)
      .maybeSingle();

    // If no record exists yet, try to find by tenant_id + recent unlinked call
    if (!callRecord && tenantId) {
      // Create a new record for this Twilio call
      const { data: newRecord, error: insertError } = await supabase
        .from('call_records')
        .insert({
          tenant_id: tenantId,
          external_call_id: callSid,
          from_number: from,
          to_number: to,
          status: mappedStatus,
          channel: 'twilio',
          started_at: new Date().toISOString(),
        })
        .select('id, tenant_id')
        .single();

      if (insertError) {
        console.error('Error creating call record:', insertError);
      } else {
        callRecord = newRecord;
      }
    }

    if (!callRecord) {
      // Try matching by phone number + recent time window as fallback
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
        // Link the CallSid
        await supabase
          .from('call_records')
          .update({ external_call_id: callSid })
          .eq('id', recentCall.id);
      }
    }

    if (!callRecord) {
      console.warn(`[call-status-webhook] No call record found for CallSid=${callSid}`);
      return new Response(JSON.stringify({ warning: 'No matching call record' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

    // Handle recording
    if (recordingUrl) {
      updateData.audio_url = recordingUrl + '.mp3'; // Twilio provides MP3 at .mp3 extension
    }

    await supabase
      .from('call_records')
      .update(updateData)
      .eq('id', callRecord.id);

    // If completed with a transcript, trigger AI summary
    if (mappedStatus === 'completed' && duration > 0) {
      const { data: fullRecord } = await supabase
        .from('call_records')
        .select('transcript')
        .eq('id', callRecord.id)
        .single();

      if (fullRecord?.transcript?.trim()) {
        const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
        if (LOVABLE_API_KEY) {
          try {
            const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                'Content-Type': 'application/json',
              },
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
**Puntos clave:** (bullet list)
**Acciones sugeridas:** (bullet list)
**Sentimiento:** (positivo/neutro/negativo)
**Etiquetas sugeridas:** (lista separada por comas)

Formato del JSON (devuelve al final entre \`\`\`json y \`\`\`):
{"contactName":"","reason":"","intent":"","budget":"","urgency":"","sentiment":"","suggestedTags":[],"agreements":[],"followUp":"ISO date or empty"}`,
                  },
                  { role: 'user', content: fullRecord.transcript },
                ],
              }),
            });

            const aiResult = await aiResponse.json();
            const summary = aiResult.choices?.[0]?.message?.content || '';

            let extractedData = {};
            const jsonMatch = summary.match(/```json\n?([\s\S]*?)\n?```/);
            if (jsonMatch) {
              try { extractedData = JSON.parse(jsonMatch[1]); } catch {}
            }

            // Extract suggested tags
            const tagsFromAI = (extractedData as any).suggestedTags || [];

            await supabase.from('call_records').update({
              summary_system: summary.replace(/```json[\s\S]*?```/, '').trim(),
              extracted_data: extractedData,
              tags: tagsFromAI,
            }).eq('id', callRecord.id);
          } catch (aiErr) {
            console.error('AI summary error:', aiErr);
          }
        }
      }
    }

    // Twilio expects TwiML or 200 OK
    return new Response('<Response></Response>', {
      headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Call status webhook error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
