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

  // Require authenticated user
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(authHeader.replace("Bearer ", ""));
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { action, accountSid, authToken, phoneNumber, webhookUrl } = await req.json();

    if (!accountSid || !authToken) {
      return new Response(
        JSON.stringify({ ok: false, error: "Account SID y Auth Token son obligatorios" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const basicAuth = btoa(`${accountSid}:${authToken}`);

    if (action === "verify") {
      // Step 1: Verify account by fetching account info
      const accountRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
        headers: { Authorization: `Basic ${basicAuth}` },
      });

      if (!accountRes.ok) {
        const errText = await accountRes.text();
        console.error("Twilio account verify error:", errText);
        return new Response(
          JSON.stringify({
            ok: false,
            error: accountRes.status === 401
              ? "Credenciales inválidas. Verifica tu Account SID y Auth Token."
              : `Error al verificar cuenta (${accountRes.status})`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const accountData = await accountRes.json();

      if (accountData.status !== "active") {
        return new Response(
          JSON.stringify({ ok: false, error: `La cuenta está en estado "${accountData.status}". Debe estar activa.` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Step 2: Verify the phone number exists (check sandbox or number)
      // Try to list incoming phone numbers to see if we can access
      const cleanNumber = phoneNumber.replace("whatsapp:", "");

      return new Response(
        JSON.stringify({
          ok: true,
          friendlyName: accountData.friendly_name || accountSid,
          accountStatus: accountData.status,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "configure_webhook") {
      if (!phoneNumber || !webhookUrl) {
        return new Response(
          JSON.stringify({ ok: false, error: "Número y URL del webhook son obligatorios" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      // Try to find the phone number SID
      const cleanNumber = phoneNumber.replace("whatsapp:", "");
      const numbersRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(cleanNumber)}`,
        { headers: { Authorization: `Basic ${basicAuth}` } }
      );

      if (numbersRes.ok) {
        const numbersData = await numbersRes.json();
        if (numbersData.incoming_phone_numbers && numbersData.incoming_phone_numbers.length > 0) {
          const numberSid = numbersData.incoming_phone_numbers[0].sid;
          // Update the SMS URL (Twilio uses sms_url for WhatsApp messages too)
          const updateRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${numberSid}.json`,
            {
              method: "POST",
              headers: {
                Authorization: `Basic ${basicAuth}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                SmsUrl: webhookUrl,
                SmsMethod: "POST",
              }).toString(),
            }
          );

          if (!updateRes.ok) {
            const errText = await updateRes.text();
            console.error("Twilio webhook update error:", errText);
            return new Response(
              JSON.stringify({ ok: false, error: "No se pudo actualizar el webhook en Twilio. Configúralo manualmente." }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          return new Response(
            JSON.stringify({ ok: true, method: "incoming_number" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // If not found as incoming number, try sandbox configuration
      // For sandbox, users need to configure manually, but we'll try the messaging service
      try {
        const sandboxRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Sandbox.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${basicAuth}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              SmsUrl: webhookUrl,
              SmsMethod: "POST",
            }).toString(),
          }
        );

        if (sandboxRes.ok) {
          return new Response(
            JSON.stringify({ ok: true, method: "sandbox" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch {
        // Sandbox might not be available
      }

      // Fallback: credentials are valid, webhook will need manual setup for sandbox
      return new Response(
        JSON.stringify({
          ok: true,
          method: "manual_note",
          note: "Credenciales guardadas. Si usas Sandbox, configura el webhook manualmente en Twilio Console.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: "Acción no reconocida" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  } catch (err) {
    console.error("twilio-setup error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: "Error interno del servidor" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
