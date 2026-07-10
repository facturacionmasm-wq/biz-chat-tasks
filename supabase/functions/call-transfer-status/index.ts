/**
 * call-transfer-status
 *
 * Twilio invokes this URL as the `action` callback of the <Dial> verb used by
 * `call-transfer` when it redirects a live call to a staff member. If the
 * dial did NOT connect (no-answer / busy / failed / canceled), we return
 * TwiML that <Redirect>s the ORIGINAL caller back to `call-inbound-webhook`
 * with `mode=absence_message` so the ElevenLabs agent can offer to take a
 * message. On `completed` we return an empty <Response/> so Twilio simply
 * ends the call as normal (the two parties already spoke).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function xmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/xml" },
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseBody(contentType: string, raw: string): Record<string, string> {
  const body = (raw || "").trim();
  if (!body) return {};
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    (!contentType.includes("application/json") && body.includes("="))
  ) {
    const out: Record<string, string> = {};
    new URLSearchParams(body).forEach((v, k) => (out[k] = v));
    return out;
  }
  try {
    const p = JSON.parse(body);
    if (p && typeof p === "object") {
      return Object.fromEntries(
        Object.entries(p).map(([k, v]) => [k, String(v ?? "")]),
      );
    }
  } catch { /* ignore */ }
  return {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

    const url = new URL(req.url);
    const contentType = req.headers.get("content-type") || "";
    const raw = req.method === "POST" ? await req.text() : "";
    const form = parseBody(contentType, raw);

    // Read Twilio DialCallStatus from form body (POST) OR query string (GET).
    const dialStatus = (
      form.DialCallStatus ||
      form.dialcallstatus ||
      url.searchParams.get("DialCallStatus") ||
      ""
    ).toLowerCase();

    // Context propagated by call-transfer as query params on the action URL.
    const tenantId = url.searchParams.get("tenant_id") || "";
    const callRecordId = url.searchParams.get("call_record_id") || "";
    const callerPhone = url.searchParams.get("caller_phone") || "";
    const targetUserId = url.searchParams.get("target_user_id") || "";
    const targetName = url.searchParams.get("target_name") || "";
    const targetPhone = url.searchParams.get("target_phone") || "";

    console.log(
      `[call-transfer-status] DialCallStatus=${dialStatus} tenant=${tenantId} caller=${callerPhone} target=${targetName}`,
    );

    // Successful bridge → nothing to do, let Twilio end the call.
    if (dialStatus === "completed" || dialStatus === "answered") {
      return xmlResponse(
        `<?xml version="1.0" encoding="UTF-8"?>\n<Response/>`,
      );
    }

    // Non-connect outcomes → reopen the ElevenLabs agent in absence-message mode.
    const failure = new Set([
      "no-answer",
      "busy",
      "failed",
      "canceled",
      "cancelled",
    ]).has(dialStatus);

    if (!failure) {
      // Unknown / missing status → be safe and just hang up cleanly.
      return xmlResponse(
        `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>`,
      );
    }

    const redirectQs = new URLSearchParams({
      mode: "absence_message",
      tenant_id: tenantId,
      call_record_id: callRecordId,
      caller_phone: callerPhone,
      target_user_id: targetUserId,
      target_name: targetName,
      target_phone: targetPhone,
    }).toString();

    const redirectUrl =
      `${SUPABASE_URL}/functions/v1/call-inbound-webhook?${redirectQs}`;

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Mia-Neural" language="es-MX">
    ${escapeXml(targetName || "La persona")} no está disponible en este momento.
  </Say>
  <Redirect method="POST">${escapeXml(redirectUrl)}</Redirect>
</Response>`;

    return xmlResponse(twiml);
  } catch (err) {
    console.error("[call-transfer-status] error:", err);
    return xmlResponse(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>`,
      200,
    );
  }
});
