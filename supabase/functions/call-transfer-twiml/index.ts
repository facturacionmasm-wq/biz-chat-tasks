const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "whisper";
    const conference = url.searchParams.get("conference") || "default";

    if (action === "whisper") {
      // Employee hears whisper summary, then joins conference
      const whisper = url.searchParams.get("whisper") || "Llamada transferida.";
      const callerPhone = url.searchParams.get("caller_phone") || "";

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say voice="Polly.Mia-Neural" language="es-MX">
    Atención. Transferencia de llamada entrante.
  </Say>
  <Pause length="1"/>
  <Say voice="Polly.Mia-Neural" language="es-MX">
    ${escapeXml(whisper)}
  </Say>
  <Pause length="1"/>
  <Say voice="Polly.Mia-Neural" language="es-MX">
    Conectando con el cliente ahora.
  </Say>
  <Dial>
    <Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false" waitUrl="http://twimlets.com/holdmusic?Bucket=com.twilio.music.soft-rock">
      ${escapeXml(conference)}
    </Conference>
  </Dial>
</Response>`;

      return new Response(twiml, {
        headers: { ...corsHeaders, "Content-Type": "application/xml" },
      });
    }

    if (action === "join") {
      // Caller joins the conference (hears hold music until employee finishes whisper)
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Mia-Neural" language="es-MX">
    Lo estamos conectando con un agente. Por favor espere un momento.
  </Say>
  <Dial>
    <Conference startConferenceOnEnter="false" endConferenceOnExit="true" beep="false" waitUrl="http://twimlets.com/holdmusic?Bucket=com.twilio.music.soft-rock">
      ${escapeXml(conference)}
    </Conference>
  </Dial>
</Response>`;

      return new Response(twiml, {
        headers: { ...corsHeaders, "Content-Type": "application/xml" },
      });
    }

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Acción no reconocida</Say></Response>`,
      { headers: { ...corsHeaders, "Content-Type": "application/xml" } }
    );
  } catch (err: any) {
    console.error("call-transfer-twiml error:", err);
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Error interno</Say></Response>`,
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/xml" } }
    );
  }
});

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
