// One-shot: cancel a Twilio call by SID, then read its status back.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const { call_sid } = await req.json();
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
  const tok = Deno.env.get('TWILIO_AUTH_TOKEN')!;
  const basic = 'Basic ' + btoa(`${sid}:${tok}`);
  const base = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${call_sid}.json`;

  // Try to cancel (queued/ringing) first
  const cancelRes = await fetch(base, {
    method: 'POST',
    headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ Status: 'canceled' }),
  });
  const cancelBody = await cancelRes.text();

  let completedRes: Response | null = null;
  let completedBody = '';
  if (!cancelRes.ok) {
    // If already in-progress, cancel is invalid; try completed to hang up
    completedRes = await fetch(base, {
      method: 'POST',
      headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ Status: 'completed' }),
    });
    completedBody = await completedRes.text();
  }

  // Read final status
  const getRes = await fetch(base, { headers: { Authorization: basic } });
  const getBody = await getRes.text();

  return new Response(JSON.stringify({
    cancel: { status: cancelRes.status, body: cancelBody.slice(0, 400) },
    complete: completedRes ? { status: completedRes.status, body: completedBody.slice(0, 400) } : null,
    final: { status: getRes.status, body: getBody.slice(0, 800) },
  }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
