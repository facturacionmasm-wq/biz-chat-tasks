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
    
    // Webhook from telephony provider (Twilio, ElevenLabs, etc.)
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
      tenant_id,
    } = body;

    // ---- Pre-call fraud check: rate limiting ----
    if (tenant_id) {
      const { data: rateLimit } = await supabase
        .from('tenant_rate_limits')
        .select('is_blocked, blocked_until')
        .eq('tenant_id', tenant_id)
        .maybeSingle();

      if (rateLimit?.is_blocked) {
        const blockedUntil = rateLimit.blocked_until ? new Date(rateLimit.blocked_until) : null;
        if (!blockedUntil || blockedUntil > new Date()) {
          console.log(`Tenant ${tenant_id} is temporarily blocked by fraud detection`);
          return new Response(JSON.stringify({
            error: 'Tenant temporarily blocked',
            blocked_until: rateLimit.blocked_until,
          }), {
            status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } else {
          // Unblock if time has passed
          await supabase.from('tenant_rate_limits').update({
            is_blocked: false,
            blocked_reason: null,
            blocked_at: null,
            blocked_until: null,
            updated_at: new Date().toISOString(),
          }).eq('tenant_id', tenant_id);
        }
      }
    }

    // Save call record
    const { data: callRecord, error } = await supabase
      .from('call_records')
      .insert({
        tenant_id,
        external_call_id: call_id,
        from_number,
        to_number,
        status: status || 'completed',
        duration: duration || 0,
        started_at: started_at || new Date().toISOString(),
        ended_at: ended_at || new Date().toISOString(),
        transcript: transcript || null,
        audio_url: audio_url || null,
      })
      .select('id')
      .single();

    if (error) throw error;

    // If transcript is available, trigger AI summarization
    if (transcript && callRecord) {
      const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
      if (LOVABLE_API_KEY) {
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
**Seguimiento:** (fecha y contexto)

Formato del JSON (devuelve al final entre \`\`\`json y \`\`\`):
{"contactName":"","reason":"","intent":"","budget":"","urgency":"","agreements":[],"followUp":"ISO date"}`,
              },
              { role: 'user', content: transcript },
            ],
          }),
        });

        const aiResult = await aiResponse.json();
        const summary = aiResult.choices?.[0]?.message?.content || '';

        // Extract JSON from the AI response
        let extractedData = {};
        const jsonMatch = summary.match(/```json\n?([\s\S]*?)\n?```/);
        if (jsonMatch) {
          try { extractedData = JSON.parse(jsonMatch[1]); } catch {}
        }

        // Update call record with summary
        await supabase.from('call_records').update({
          summary_system: summary.replace(/```json[\s\S]*?```/, '').trim(),
          extracted_data: extractedData,
        }).eq('id', callRecord.id);
      }
    }

    // Post-call pipeline: cost calculation + fraud detection
    if (callRecord && tenant_id) {
      try {
        // 1. Calculate usage cost
        const costRes = await fetch(`${SUPABASE_URL}/functions/v1/calculate-usage-cost`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({
            call_record_id: callRecord.id,
            tenant_id,
            duration_seconds: duration || 0,
            ai_tokens_used: transcript ? Math.ceil((transcript.length / 4)) : 0,
          }),
        });
        const costData = await costRes.json().catch(() => ({}));

        // 2. Fraud detection
        await fetch(`${SUPABASE_URL}/functions/v1/fraud-detection`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({
            tenant_id,
            call_record_id: callRecord.id,
            duration_seconds: duration || 0,
            cost_total: costData.cost_total || 0,
            from_number,
            started_at: started_at || new Date().toISOString(),
          }),
        });
      } catch (e) {
        console.error('Post-call pipeline error:', e);
      }
    }

    // Log audit event
    await supabase.from('audit_events').insert({
      tenant_id,
      event_type: 'call.webhook_received',
      resource_type: 'call_record',
      resource_id: callRecord?.id,
      payload: { call_id, status, duration },
    });

    return new Response(JSON.stringify({ success: true, callRecordId: callRecord?.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Call webhook error:', errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
