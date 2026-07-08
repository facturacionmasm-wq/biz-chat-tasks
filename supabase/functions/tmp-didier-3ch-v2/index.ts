import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
serve(async () => {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const tok = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const resendKey = Deno.env.get("RESEND_API_KEY")!;
  const auth = "Basic " + btoa(`${sid}:${tok}`);

  const to = "+529997493743"; // corrected
  const email = "alejocetin9@gmail.com";
  const from = "whatsapp:+12138163815";

  // 1) WhatsApp — From directo
  const waRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      From: from,
      To: `whatsapp:${to}`,
      Body: "Recordatorio (prueba real): confirmamos tu cita. — Rybix",
    }).toString(),
  });
  const waData = await waRes.json();

  // 2) Email
  const emRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Rybix <no-reply@rybixholding.com>",
      to: [email],
      subject: "Recordatorio de tu cita",
      html: "<p>Hola Didier, este es un recordatorio real de tu cita. — Rybix</p>",
    }),
  });
  const emData = await emRes.json();

  // 3) Voice — invoke voice-outbound-call
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const vRes = await fetch(`${supabaseUrl}/functions/v1/voice-outbound-call`, {
    method: "POST",
    headers: { Authorization: `Bearer ${svcKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_id: "00000000-0000-0000-0000-000000000001",
      to_number: to,
      dynamic_variables: { purpose: "test_didier_real", contact_name: "Didier Cetina" },
    }),
  });
  const vData = await vRes.json();

  // Poll Twilio for final status after brief wait
  await new Promise((r) => setTimeout(r, 8000));

  const waFinal = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages/${waData.sid}.json`, { headers: { Authorization: auth } }).then((r) => r.json());
  const callSid = vData?.call_sid;
  const callFinal = callSid ? await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${callSid}.json`, { headers: { Authorization: auth } }).then((r) => r.json()) : null;

  return new Response(JSON.stringify({
    whatsapp: { sid: waData.sid, initial_status: waData.status, initial_error_code: waData.error_code, to: waData.to, from: waData.from,
      final_status: waFinal.status, final_error_code: waFinal.error_code, final_error_message: waFinal.error_message },
    email: { id: emData.id, error: emData.error || null },
    voice: { call_sid: callSid, conversation_id: vData?.conversation_id, invoke_ok: vRes.ok,
      final_status: callFinal?.status, final_to: callFinal?.to, final_from: callFinal?.from, final_duration: callFinal?.duration },
  }, null, 2), { headers: { "Content-Type": "application/json" } });
});
