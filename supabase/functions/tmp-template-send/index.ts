import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
serve(async () => {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const tok = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const contentSid = Deno.env.get("WHATSAPP_REMINDER_CONTENT_SID")!;
  const auth = "Basic " + btoa(`${sid}:${tok}`);
  const to = "whatsapp:+529997493743";
  const from = "whatsapp:+12138163815";
  const vars = { "1": "Didier", "2": "tu cita programada", "3": "https://rybixholding.com" };

  const send = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: from, To: to, ContentSid: contentSid, ContentVariables: JSON.stringify(vars) }).toString(),
  });
  const sendData = await send.json();

  await new Promise((r) => setTimeout(r, 10000));
  const finalRes = sendData.sid ? await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages/${sendData.sid}.json`, { headers: { Authorization: auth } }).then(r => r.json()) : null;

  return new Response(JSON.stringify({
    initial: { http: send.status, sid: sendData.sid, status: sendData.status, error_code: sendData.error_code, error_message: sendData.error_message, to: sendData.to, from: sendData.from },
    final: finalRes ? { status: finalRes.status, error_code: finalRes.error_code, error_message: finalRes.error_message } : null,
  }, null, 2), { headers: { "Content-Type": "application/json" } });
});
