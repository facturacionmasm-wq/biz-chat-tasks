import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
serve(async () => {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const tok = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const auth = "Basic " + btoa(`${sid}:${tok}`);
  const msg = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages/SM91240d4254897c1a98dc9b85f7138fae.json`, { headers: { Authorization: auth } });
  const call = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/CA40e2584b901411b9456134e9a229afaa.json`, { headers: { Authorization: auth } });
  const mj = await msg.json();
  const cj = await call.json();
  return new Response(JSON.stringify({
    message: { status: mj.status, error_code: mj.error_code, error_message: mj.error_message, to: mj.to, from: mj.from, date_sent: mj.date_sent, date_updated: mj.date_updated },
    call: { status: cj.status, to: cj.to, from: cj.from, duration: cj.duration, start_time: cj.start_time, end_time: cj.end_time, direction: cj.direction, answered_by: cj.answered_by },
  }, null, 2), { headers: { "Content-Type": "application/json" } });
});
