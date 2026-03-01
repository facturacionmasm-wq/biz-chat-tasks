import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Inbound Call Webhook
 * 
 * Twilio calls this URL when someone dials the Twilio phone number.
 * It creates a call_record immediately and returns TwiML to handle the call.
 * 
 * Configure in Twilio Console:
 *   Phone Number → Voice → "A Call Comes In" → Webhook → POST
 *   URL: https://<project>.supabase.co/functions/v1/call-inbound-webhook
 *   
 *   Status Callback URL: https://<project>.supabase.co/functions/v1/call-status-webhook
 */

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Parse Twilio form-encoded or JSON
    const contentType = req.headers.get('content-type') || '';
    let params: Record<string, string> = {};

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      formData.forEach((value, key) => { params[key] = String(value); });
    } else {
      params = await req.json();
    }

    const callSid = params.CallSid || params.call_sid || '';
    const from = params.From || params.from_number || '';
    const to = params.To || params.to_number || '';
    const direction = params.Direction || 'inbound';
    const callerCity = params.CallerCity || '';
    const callerState = params.CallerState || '';
    const callerCountry = params.CallerCountry || '';

    console.log(`[call-inbound-webhook] CallSid=${callSid} From=${from} To=${to} Direction=${direction}`);

    if (!callSid) {
      return new Response(
        twimlSay('Error interno. Por favor intente más tarde.'),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // ═══════════ RESOLVE TENANT ═══════════
    let tenantId: string | null = null;

    // Resolve by the Twilio phone number (the "To" number for inbound)
    for (const phone of [to, from].filter(Boolean)) {
      const { data: phoneMatch } = await supabase
        .from('tenant_phone_numbers')
        .select('tenant_id')
        .eq('phone_e164', phone)
        .eq('active', true)
        .maybeSingle();
      if (phoneMatch) {
        tenantId = phoneMatch.tenant_id;
        console.log(`[call-inbound-webhook] Resolved tenant ${tenantId} from phone ${phone}`);
        break;
      }
    }

    // Fallback: check if TWILIO_PHONE_NUMBER matches and use a default tenant
    if (!tenantId) {
      const twilioPhone = Deno.env.get('TWILIO_PHONE_NUMBER') || '';
      if (twilioPhone && (to === twilioPhone || to === `+${twilioPhone.replace(/^\+/, '')}`)) {
        // Find any tenant that has this number or get the first active tenant
        const { data: anyTenant } = await supabase
          .from('tenants')
          .select('id')
          .limit(1)
          .single();
        if (anyTenant) {
          tenantId = anyTenant.id;
          console.log(`[call-inbound-webhook] Fallback tenant ${tenantId}`);
        }
      }
    }

    if (!tenantId) {
      console.warn(`[call-inbound-webhook] No tenant found for To=${to}`);
      return new Response(
        twimlSay('Este número no está configurado. Disculpe las molestias.'),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // ═══════════ RATE LIMIT CHECK ═══════════
    const { data: rateLimit } = await supabase
      .from('tenant_rate_limits')
      .select('is_blocked, blocked_until')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (rateLimit?.is_blocked) {
      const blockedUntil = rateLimit.blocked_until ? new Date(rateLimit.blocked_until) : null;
      if (!blockedUntil || blockedUntil > new Date()) {
        console.log(`[call-inbound-webhook] Tenant ${tenantId} BLOCKED`);
        return new Response(
          twimlSay('El servicio no está disponible en este momento. Intente más tarde.'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }
    }

    // ═══════════ CREATE CALL RECORD ═══════════
    const { data: callRecord, error: insertError } = await supabase
      .from('call_records')
      .insert({
        tenant_id: tenantId,
        external_call_id: callSid,
        from_number: from,
        to_number: to,
        status: 'ringing',
        channel: 'twilio_inbound',
        started_at: new Date().toISOString(),
        recording_status: 'not_requested',
        transcript_status: 'pending',
        summary_status: 'pending',
        appointment_status: 'not_requested',
        extracted_data: {
          direction: 'inbound',
          callerCity,
          callerState,
          callerCountry,
        },
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[call-inbound-webhook] Insert error:', insertError);
    } else {
      console.log(`[call-inbound-webhook] Created call record ${callRecord.id}`);
    }

    // ═══════════ RECORD INITIAL EVENT ═══════════
    if (callRecord) {
      await supabase.from('call_events').insert({
        call_record_id: callRecord.id,
        tenant_id: tenantId,
        event_type: 'ringing',
        twilio_call_sid: callSid,
        event_data: {
          from, to, direction,
          callerCity, callerState, callerCountry,
          timestamp: new Date().toISOString(),
        },
      });

      // Audit event
      await supabase.from('audit_events').insert({
        tenant_id: tenantId,
        event_type: 'call.inbound_received',
        resource_type: 'call_record',
        resource_id: callRecord.id,
        payload: { call_sid: callSid, from, to },
      });
    }

    // ═══════════ LOAD TENANT SETTINGS FOR GREETING ═══════════
    let companyName = '';
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name, settings_json')
      .eq('id', tenantId)
      .single();

    if (tenant) {
      companyName = tenant.name || '';
    }

    const greeting = companyName
      ? `Bienvenido a ${escapeXml(companyName)}. Su llamada está siendo atendida.`
      : 'Bienvenido. Su llamada está siendo atendida.';

    // Build statusCallback URL for ongoing status updates
    const statusCallbackUrl = `${SUPABASE_URL}/functions/v1/call-status-webhook`;

    // ═══════════ RETURN TwiML ═══════════
    // Record the call and connect; Twilio will send status updates to call-status-webhook
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Mia-Neural" language="es-MX">${greeting}</Say>
  <Pause length="1"/>
  <Say voice="Polly.Mia-Neural" language="es-MX">Por favor espere mientras lo conectamos.</Say>
  <Record 
    maxLength="3600"
    recordingStatusCallback="${escapeXml(statusCallbackUrl)}"
    recordingStatusCallbackEvent="completed"
    transcribe="false"
    playBeep="false"
    trim="trim-silence"
  />
  <Say voice="Polly.Mia-Neural" language="es-MX">Gracias por su llamada. Hasta pronto.</Say>
</Response>`;

    return new Response(twiml, {
      headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[call-inbound-webhook] Error:', msg);
    return new Response(
      twimlSay('Ha ocurrido un error. Por favor intente más tarde.'),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
    );
  }
});

function twimlSay(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Mia-Neural" language="es-MX">${escapeXml(message)}</Say>
</Response>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
