import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { to, body, conversationId, tenantId } = await req.json();

    if (!to || !body) {
      return new Response(
        JSON.stringify({ ok: false, error: "Destinatario y mensaje son obligatorios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Twilio credentials from secrets
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!accountSid || !authToken || !fromNumber) {
      return new Response(
        JSON.stringify({ ok: false, error: "Credenciales de Twilio no configuradas. Configúralas en el wizard de integración." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Format numbers for Twilio WhatsApp
    const toWhatsApp = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    const fromWhatsApp = fromNumber.startsWith("whatsapp:") ? fromNumber : `whatsapp:${fromNumber}`;

    // Send via Twilio API
    const basicAuth = btoa(`${accountSid}:${authToken}`);
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: fromWhatsApp,
          To: toWhatsApp,
          Body: body,
        }).toString(),
      }
    );

    const twilioData = await twilioRes.json();

    if (!twilioRes.ok) {
      console.error("Twilio send error:", JSON.stringify(twilioData));
      return new Response(
        JSON.stringify({ ok: false, error: twilioData.message || "Error al enviar por Twilio", code: twilioData.code }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Save message to DB
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const effectiveTenantId = tenantId || "00000000-0000-0000-0000-000000000001";

    if (conversationId) {
      await supabase.from("whatsapp_messages").insert({
        tenant_id: effectiveTenantId,
        conversation_id: conversationId,
        direction: "out",
        body: body,
        status: "sent",
        metadata: { message_sid: twilioData.sid, provider: "twilio" },
      });

      await supabase
        .from("whatsapp_conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversationId);
    }

    console.log(`Message sent via Twilio: sid=${twilioData.sid} to=${toWhatsApp}`);

    return new Response(
      JSON.stringify({ ok: true, messageSid: twilioData.sid }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("twilio-send error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: "Error interno del servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
