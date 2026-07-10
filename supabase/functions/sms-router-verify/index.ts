// Temporary verification harness for SMS router (Opción A).
// Signs Twilio payloads server-side and posts to both endpoints.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

async function sign(authToken: string, url: string, params: Record<string, string>): Promise<string> {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) data += key + params[key];
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function post(url: string, params: Record<string, string>, signature: string) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': signature,
    },
    body,
  });
  return { status: res.status, body: await res.text() };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')!;

  const WA_URL = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;
  const SMS_URL = `${SUPABASE_URL}/functions/v1/sms-inbound`;

  const nonce = Date.now();
  const results: Record<string, unknown> = {};

  // (a) SMS via whatsapp-webhook router — valid signature
  {
    const params = {
      From: '+15559998888',
      To: '+12138163815',
      Body: `router-smoke-${nonce}`,
      MessageSid: `SMrouter_${nonce}`,
      NumMedia: '0',
    };
    const sig = await sign(TWILIO_AUTH_TOKEN, WA_URL, params);
    results.a_sms_via_whatsapp_webhook = { ...await post(WA_URL, params, sig), message_sid: params.MessageSid };
  }

  // (a2) Idempotency: repost same SMS
  {
    const params = {
      From: '+15559998888',
      To: '+12138163815',
      Body: `router-smoke-${nonce}`,
      MessageSid: `SMrouter_${nonce}`,
      NumMedia: '0',
    };
    const sig = await sign(TWILIO_AUTH_TOKEN, WA_URL, params);
    results.e_idempotency_repost = await post(WA_URL, params, sig);
  }

  // (b) WhatsApp via whatsapp-webhook — valid signature (existing happy path)
  {
    const params = {
      From: 'whatsapp:+15559998888',
      To: 'whatsapp:+12138163815',
      Body: `wa-happy-path-${nonce}`,
      MessageSid: `SMwa_${nonce}`,
      NumMedia: '0',
      ProfileName: 'Router Smoke',
    };
    const sig = await sign(TWILIO_AUTH_TOKEN, WA_URL, params);
    results.b_whatsapp_happy_path = { ...await post(WA_URL, params, sig), message_sid: params.MessageSid };
  }

  // (c) Invalid signature to whatsapp-webhook
  {
    const params = {
      From: '+15559998888',
      To: '+12138163815',
      Body: 'invalid',
      MessageSid: `SMinvalid_${nonce}`,
      NumMedia: '0',
    };
    results.c_invalid_sig_whatsapp_webhook = await post(WA_URL, params, 'bogus_sig_xxx');
  }

  // (d1) Direct sms-inbound smoke test — valid signature
  {
    const params = {
      From: '+15559998888',
      To: '+12138163815',
      Body: `sms-direct-${nonce}`,
      MessageSid: `SMdirect_${nonce}`,
      NumMedia: '0',
    };
    const sig = await sign(TWILIO_AUTH_TOKEN, SMS_URL, params);
    results.d1_sms_direct_valid = { ...await post(SMS_URL, params, sig), message_sid: params.MessageSid };
  }

  // (d2) Direct sms-inbound with invalid signature
  {
    const params = {
      From: '+15559998888',
      To: '+12138163815',
      Body: 'invalid',
      MessageSid: `SMdirectinv_${nonce}`,
      NumMedia: '0',
    };
    results.d2_sms_direct_invalid = await post(SMS_URL, params, 'bogus_sig_xxx');
  }

  return new Response(JSON.stringify({ nonce, results }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
