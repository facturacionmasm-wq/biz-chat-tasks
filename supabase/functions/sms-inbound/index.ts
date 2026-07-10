import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { handleInboundSms } from "../_shared/sms-inbound-core.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const xml = (status: number, body = TWIML_OK) =>
    new Response(body, { status, headers: { ...corsHeaders, 'Content-Type': 'text/xml' } });

  const logSig = async (input: {
    stage: string;
    status: 'ok' | 'error' | 'skip';
    error?: string | null;
    payload?: Record<string, unknown>;
  }) => {
    try {
      await supabase.from('webhook_logs').insert({
        tenant_id: null,
        provider: 'sms',
        message_id: null,
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

    // Signature validation with candidate URLs (proxy-aware).
    if (TWILIO_AUTH_TOKEN) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') || '';
      if (twilioSignature) {
        const reqUrl = new URL(req.url);
        const xfProto = (req.headers.get('x-forwarded-proto') || '').split(',')[0].trim();
        const xfHost = (req.headers.get('x-forwarded-host') || '').split(',')[0].trim();
        const hostHeader = req.headers.get('host') || '';
        const path = '/functions/v1/sms-inbound';

        const candidateSet = new Set<string>();
        candidateSet.add(`${SUPABASE_URL}${path}`);
        candidateSet.add(reqUrl.origin + reqUrl.pathname);
        candidateSet.add(reqUrl.toString());
        if (xfHost) {
          const proto = xfProto || 'https';
          candidateSet.add(`${proto}://${xfHost}${path}`);
        }
        if (hostHeader) {
          const proto = xfProto || 'https';
          candidateSet.add(`${proto}://${hostHeader}${path}`);
        }

        const candidates = Array.from(candidateSet);
        let matchedUrl: string | null = null;
        for (const cand of candidates) {
          const ok = await validateTwilioSignature(TWILIO_AUTH_TOKEN, twilioSignature, cand, paramsObj);
          if (ok) { matchedUrl = cand; break; }
        }

        if (!matchedUrl) {
          await logSig({
            stage: 'twilio_signature_validation',
            status: 'error',
            error: 'invalid_signature',
            payload: { has_signature: true, tried_candidates: candidates },
          });
          return xml(403);
        }

        await logSig({
          stage: 'twilio_signature_validation',
          status: 'ok',
          payload: { matched_url: matchedUrl, candidate_count: candidates.length },
        });
      }
    }

    await handleInboundSms({ supabase, paramsObj, sourceFunction: 'sms-inbound' });
    return xml(200);
  } catch (e) {
    console.error('[sms-inbound] unhandled error:', e);
    await logSig({ stage: 'unhandled', status: 'error', error: (e as Error).message });
    return xml(200);
  }
});
