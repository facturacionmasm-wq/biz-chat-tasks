import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const {
      tenant_id,
      target_user_id,
      target_name,
      caller_phone,
      summary,
      call_record_id,
    } = await req.json();

    if (!tenant_id || !target_user_id) {
      return new Response(
        JSON.stringify({ error: "tenant_id y target_user_id son requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const title = `Llamada transferida de ${caller_phone || "desconocido"}`;

    // 1. In-app notification (realtime via supabase_realtime publication)
    const { error: notifError } = await adminClient
      .from("transfer_notifications")
      .insert({
        tenant_id,
        user_id: target_user_id,
        call_record_id: call_record_id || null,
        title,
        summary: summary || null,
        caller_phone: caller_phone || null,
        target_name: target_name || null,
      });

    if (notifError) {
      console.error("Error inserting notification:", notifError);
    }

    // 2. WhatsApp notification to employee
    const { data: profile } = await adminClient
      .from("profiles")
      .select("whatsapp_number, phone, name")
      .eq("user_id", target_user_id)
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    const whatsappNumber = profile?.whatsapp_number || profile?.phone;

    if (whatsappNumber) {
      const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
      const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
      const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");

      if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
        const msgBody = `📞 *Transferencia de llamada*\n\n` +
          `De: ${caller_phone || "Desconocido"}\n` +
          (summary ? `\n📋 *Resumen:*\n${summary}\n` : "") +
          `\nRevisa la app para más detalles.`;

        const toWA = whatsappNumber.startsWith("whatsapp:") ? whatsappNumber : `whatsapp:${whatsappNumber}`;
        const fromWA = TWILIO_PHONE_NUMBER.startsWith("whatsapp:") ? TWILIO_PHONE_NUMBER : `whatsapp:${TWILIO_PHONE_NUMBER}`;

        try {
          const basicAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
          const res = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
            {
              method: "POST",
              headers: {
                Authorization: `Basic ${basicAuth}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                From: fromWA,
                To: toWA,
                Body: msgBody,
              }).toString(),
            }
          );
          const data = await res.json();
          if (!res.ok) {
            console.error("WhatsApp notification error:", data);
          } else {
            console.log("WhatsApp notification sent:", data.sid);
          }
        } catch (err) {
          console.error("WhatsApp send error:", err);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: "Notificaciones enviadas" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("notify-transfer error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
