import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const TWIML_OK = '<Response></Response>';

// Literal copy of validateTwilioSignature from whatsapp-webhook to keep parity.
async function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
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
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') || '';
  const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER') || '';
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const xml = (status: number, body = TWIML_OK) =>
    new Response(body, { status, headers: { ...corsHeaders, 'Content-Type': 'text/xml' } });

  const logWebhook = async (input: {
    tenantId?: string | null;
    stage: string;
    status: 'ok' | 'error' | 'skip';
    error?: string | null;
    messageId?: string | null;
    payload?: Record<string, unknown>;
  }) => {
    try {
      await supabase.from('webhook_logs').insert({
        tenant_id: input.tenantId ?? null,
        provider: 'sms',
        message_id: input.messageId ?? null,
        conversation_id: null,
        stage: input.stage,
        status: input.status,
        error: input.error ?? null,
        payload: input.payload ?? {},
      });
    } catch (e) {
      console.error('[sms-inbound] webhook_logs insert failed:', e);
    }
  };

  try {
    if (req.method !== 'POST') {
      return xml(200);
    }

    const rawFormData = await req.text();
    const params = new URLSearchParams(rawFormData);
    const paramsObj = Object.fromEntries(params.entries());

    // Signature validation (same pattern as whatsapp-webhook).
    if (TWILIO_AUTH_TOKEN) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') || '';
      if (twilioSignature) {
        const webhookUrl = `${SUPABASE_URL}/functions/v1/sms-inbound`;
        const isValid = await validateTwilioSignature(TWILIO_AUTH_TOKEN, twilioSignature, webhookUrl, paramsObj);
        if (!isValid) {
          await logWebhook({
            stage: 'twilio_signature_validation',
            status: 'error',
            error: 'invalid_signature',
            payload: { has_signature: true },
          });
          return xml(403);
        }
      }
    }

    const from = params.get('From') || '';
    const to = params.get('To') || '';
    const body = params.get('Body') || '';
    const messageSid = params.get('MessageSid') || params.get('SmsSid') || '';
    const numMedia = parseInt(params.get('NumMedia') || '0', 10);

    // Ignore WhatsApp — that lives in whatsapp-webhook.
    if (from.startsWith('whatsapp:') || to.startsWith('whatsapp:')) {
      await logWebhook({
        stage: 'ignore_whatsapp',
        status: 'skip',
        messageId: messageSid,
        payload: { from, to },
      });
      return xml(200);
    }

    if (!messageSid) {
      await logWebhook({ stage: 'parse', status: 'error', error: 'missing_message_sid', payload: paramsObj });
      return xml(200);
    }

    // Resolve tenant by destination number.
    let tenantId: string | null = null;
    if (to) {
      const { data: mapping } = await supabase
        .from('tenant_phone_numbers')
        .select('tenant_id')
        .eq('phone_e164', to)
        .eq('active', true)
        .maybeSingle();
      if (mapping?.tenant_id) tenantId = mapping.tenant_id;
    }
    if (!tenantId && TWILIO_PHONE_NUMBER && to === TWILIO_PHONE_NUMBER) {
      tenantId = MASTER_TENANT_ID;
    }
    if (!tenantId) {
      await logWebhook({
        stage: 'tenant_resolution',
        status: 'skip',
        messageId: messageSid,
        payload: { to, reason: 'tenant_not_found' },
      });
      return xml(200);
    }

    const { error: insertError } = await supabase
      .from('sms_inbound_messages')
      .upsert(
        {
          tenant_id: tenantId,
          message_sid: messageSid,
          from_e164: from,
          to_e164: to,
          body,
          num_media: isNaN(numMedia) ? 0 : numMedia,
          raw: paramsObj,
        },
        { onConflict: 'message_sid', ignoreDuplicates: true },
      );

    if (insertError) {
      await logWebhook({
        tenantId,
        stage: 'insert',
        status: 'error',
        error: insertError.message,
        messageId: messageSid,
      });
      return xml(200);
    }

    await logWebhook({
      tenantId,
      stage: 'inbound_stored',
      status: 'ok',
      messageId: messageSid,
      payload: { from, to, has_body: body.length > 0, num_media: numMedia },
    });

    return xml(200);
  } catch (e) {
    console.error('[sms-inbound] unhandled error:', e);
    await logWebhook({ stage: 'unhandled', status: 'error', error: (e as Error).message });
    return xml(200);
  }
});
