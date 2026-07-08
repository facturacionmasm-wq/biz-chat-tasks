import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { resolveTenantAgentId } from "../_shared/elevenlabs-agent.ts";
import { assertVoicePlan } from "../_shared/plan-guard.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Voice Outbound Call — triggers a call from the tenant's ElevenLabs agent to a phone number.
 *
 * Uses ElevenLabs Twilio outbound endpoint:
 *   POST https://api.elevenlabs.io/v1/convai/twilio/outbound-call
 *   body: { agent_id, agent_phone_number_id, to_number, conversation_initiation_client_data: { dynamic_variables } }
 *
 * Called by send-reminders for reminder_1h appointment reminders.
 * Also callable directly by internal server-to-server requests with a service-role key.
 */

function normalizeE164(raw: string): string {
  const cleaned = String(raw || '').trim().replace(/[\s().-]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) return cleaned;
  if (/^\d{10,15}$/.test(cleaned)) return `+${cleaned}`;
  return cleaned;
}

async function resolveAgentPhoneNumberId(
  supabase: any,
  tenantId: string,
  elevenlabsApiKey: string,
  fromNumber: string,
): Promise<{ id: string | null; source: string }> {
  // 1) Check tenant's elevenlabs_config
  const { data: tenant } = await supabase
    .from('tenants')
    .select('elevenlabs_config')
    .eq('id', tenantId)
    .maybeSingle();
  const cfg = (tenant?.elevenlabs_config || {}) as Record<string, unknown>;
  const stored = typeof cfg.agent_phone_number_id === 'string' && cfg.agent_phone_number_id.length > 0
    ? String(cfg.agent_phone_number_id) : null;
  if (stored) return { id: stored, source: 'tenant_config' };

  // 2) Fallback: look up in ElevenLabs API and cache it
  const normalized = normalizeE164(fromNumber);
  const digits = normalized.replace(/\D/g, '');
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/convai/phone-numbers', {
      headers: { 'xi-api-key': elevenlabsApiKey },
    });
    if (!res.ok) return { id: null, source: 'lookup_failed' };
    const data = await res.json();
    const numbers = data.phone_numbers || data || [];
    const match = Array.isArray(numbers)
      ? numbers.find((p: any) => String(p.phone_number || '').replace(/\D/g, '') === digits)
      : null;
    const found = match?.phone_number_id || match?.id || null;
    if (found) {
      // Cache in tenants.elevenlabs_config
      const nextCfg = { ...cfg, agent_phone_number_id: found };
      await supabase.from('tenants').update({ elevenlabs_config: nextCfg }).eq('id', tenantId);
      return { id: found, source: 'elevenlabs_lookup' };
    }
  } catch (err) {
    console.error('[voice-outbound-call] agent_phone_number_id lookup error:', err);
  }
  return { id: null, source: 'not_found' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');

  if (!ELEVENLABS_API_KEY) {
    return new Response(JSON.stringify({ success: false, error: 'ELEVENLABS_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const tenantId: string = body.tenant_id;
    const rawTo: string = body.to_number;
    const appointmentId: string | null = body.appointment_id || null;
    const notificationId: string | null = body.notification_id || null;
    const dynamicVariables: Record<string, string> = body.dynamic_variables || {};

    if (!tenantId || !rawTo) {
      return new Response(JSON.stringify({ success: false, error: 'tenant_id and to_number are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Plan guard — voice must be enabled
    const blocked = await assertVoicePlan(supabase, tenantId, corsHeaders);
    if (blocked) return blocked;

    const toNumber = normalizeE164(rawTo);
    if (!/^\+\d{10,15}$/.test(toNumber)) {
      return new Response(JSON.stringify({ success: false, error: `Invalid to_number: ${rawTo}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve agent
    const { agentId } = await resolveTenantAgentId(supabase, tenantId);
    if (!agentId) {
      return new Response(JSON.stringify({ success: false, error: 'Tenant has no ElevenLabs agent configured' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve tenant sender number
    const { data: tenant } = await supabase
      .from('tenants')
      .select('whatsapp_config')
      .eq('id', tenantId)
      .maybeSingle();
    const wa = (tenant?.whatsapp_config || {}) as Record<string, unknown>;
    const fromNumber = typeof wa.phone_number === 'string' && wa.phone_number.length > 0
      ? String(wa.phone_number).replace(/^whatsapp:/i, '')
      : (Deno.env.get('TWILIO_PHONE_NUMBER') || '');

    if (!fromNumber) {
      return new Response(JSON.stringify({ success: false, error: 'Tenant has no phone number configured' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { id: agentPhoneNumberId, source: phoneIdSource } = await resolveAgentPhoneNumberId(
      supabase, tenantId, ELEVENLABS_API_KEY, fromNumber,
    );

    if (!agentPhoneNumberId) {
      return new Response(JSON.stringify({
        success: false,
        error: `Could not resolve agent_phone_number_id for ${fromNumber} (${phoneIdSource})`,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Build dynamic variables (all values must be strings)
    const stringDynVars: Record<string, string> = {};
    for (const [k, v] of Object.entries(dynamicVariables || {})) {
      if (v !== undefined && v !== null) stringDynVars[k] = String(v);
    }
    if (appointmentId) stringDynVars.appointment_id = appointmentId;
    stringDynVars.tenant_id = tenantId;

    // Call ElevenLabs Twilio outbound endpoint
    console.log(`[voice-outbound-call] agent=${agentId} phoneId=${agentPhoneNumberId} to=${toNumber} appt=${appointmentId}`);
    const elRes = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agent_id: agentId,
        agent_phone_number_id: agentPhoneNumberId,
        to_number: toNumber,
        conversation_initiation_client_data: {
          dynamic_variables: stringDynVars,
        },
      }),
    });

    const elText = await elRes.text();
    let elData: any = {};
    try { elData = JSON.parse(elText); } catch { elData = { raw: elText }; }

    if (!elRes.ok || elData?.success === false) {
      console.error(`[voice-outbound-call] ElevenLabs error [${elRes.status}]:`, elText);
      // Record failure on notification
      if (notificationId) {
        await supabase.from('appointment_notifications').update({
          status: 'failed',
          error_message: `voice-outbound-call: ${elData?.message || elData?.detail?.message || elText}`.substring(0, 500),
        }).eq('id', notificationId);
      }
      return new Response(JSON.stringify({
        success: false,
        error: elData?.message || elData?.detail?.message || `ElevenLabs ${elRes.status}`,
        details: elData,
      }), { status: elRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const callSid: string | null = elData?.callSid || elData?.call_sid || null;
    const conversationId: string | null = elData?.conversation_id || elData?.conversationId || null;

    // Record success on notification
    if (notificationId) {
      await supabase.from('appointment_notifications').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        response: JSON.stringify({ call_sid: callSid, conversation_id: conversationId }),
      }).eq('id', notificationId);
    }

    // Audit
    await supabase.from('audit_events').insert({
      tenant_id: tenantId,
      event_type: 'voice.outbound_call.initiated',
      resource_type: 'appointment',
      resource_id: appointmentId,
      payload: {
        to_number: toNumber,
        agent_id: agentId,
        agent_phone_number_id: agentPhoneNumberId,
        call_sid: callSid,
        conversation_id: conversationId,
        purpose: stringDynVars.purpose || 'outbound_call',
      },
    });

    return new Response(JSON.stringify({
      success: true,
      call_sid: callSid,
      conversation_id: conversationId,
      to_number: toNumber,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[voice-outbound-call] error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
