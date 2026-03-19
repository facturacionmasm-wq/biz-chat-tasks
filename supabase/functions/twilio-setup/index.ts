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

  const { data: { user }, error: userError } = await anonClient.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Role check: only admin/owner/super_admin can configure Twilio
  const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: userRoles } = await serviceClient
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  const allowedRoles = ["admin", "owner", "super_admin"];
  const hasPermission = (userRoles || []).some((r: { role: string }) => allowedRoles.includes(r.role));
  if (!hasPermission) {
    return new Response(JSON.stringify({ ok: false, error: "No tienes permisos para configurar Twilio" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { action, accountSid, authToken, phoneNumber, webhookUrl, messagingServiceSid } = await req.json();

    const resolvedAccountSid = (accountSid || Deno.env.get("TWILIO_ACCOUNT_SID") || "").trim();
    const resolvedAuthToken = (authToken || Deno.env.get("TWILIO_AUTH_TOKEN") || "").trim();

    if (!resolvedAccountSid || !resolvedAuthToken) {
      return new Response(
        JSON.stringify({ ok: false, error: "Faltan credenciales de Twilio (Account SID/Auth Token)" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const basicAuth = btoa(`${resolvedAccountSid}:${resolvedAuthToken}`);

    if (action === "verify") {
      // Step 1: Verify account by fetching account info
      const accountRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${resolvedAccountSid}.json`, {
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
          friendlyName: accountData.friendly_name || resolvedAccountSid,
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

      const cleanNumber = phoneNumber.replace("whatsapp:", "");
      let numberSid: string | null = null;
      let configuredIncoming = false;
      let configuredMessagingService = false;
      let resolvedMessagingServiceSid: string | null = null;

      // 1) Try to configure Incoming Phone Number webhook
      const numbersRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${resolvedAccountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(cleanNumber)}`,
        { headers: { Authorization: `Basic ${basicAuth}` } }
      );

      if (numbersRes.ok) {
        const numbersData = await numbersRes.json();
        if (numbersData.incoming_phone_numbers && numbersData.incoming_phone_numbers.length > 0) {
          numberSid = numbersData.incoming_phone_numbers[0].sid;

          const updateRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${resolvedAccountSid}/IncomingPhoneNumbers/${numberSid}.json`,
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

          if (updateRes.ok) {
            configuredIncoming = true;
          } else {
            console.error("Twilio incoming number webhook update failed:", await updateRes.text());
          }
        }
      }

      // 2) Resolve Messaging Service SID (explicit param → auto-detect by number → env fallback)
      const bodyMessagingSid = typeof messagingServiceSid === "string"
        ? messagingServiceSid.trim()
        : "";

      if (bodyMessagingSid) {
        resolvedMessagingServiceSid = bodyMessagingSid;
      }

      if (!resolvedMessagingServiceSid && numberSid) {
        const servicesRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${resolvedAccountSid}/Messages/Services.json?PageSize=50`,
          { headers: { Authorization: `Basic ${basicAuth}` } }
        );

        if (servicesRes.ok) {
          const servicesData = await servicesRes.json();
          const services = servicesData.services || [];

          for (const service of services) {
            const phoneListRes = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${resolvedAccountSid}/Messages/Services/${service.sid}/PhoneNumbers.json?PageSize=50`,
              { headers: { Authorization: `Basic ${basicAuth}` } }
            );

            if (!phoneListRes.ok) continue;
            const phoneListData = await phoneListRes.json();
            const hasNumber = (phoneListData.phone_numbers || []).some((p: any) => p.phone_number_sid === numberSid);
            if (hasNumber) {
              resolvedMessagingServiceSid = service.sid;
              break;
            }
          }
        }
      }

      if (!resolvedMessagingServiceSid) {
        resolvedMessagingServiceSid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") || null;
      }

      // 3) Configure inbound webhook in Messaging Service (critical for WhatsApp sender routing)
      if (resolvedMessagingServiceSid) {
        const serviceUpdateRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${resolvedAccountSid}/Messages/Services/${resolvedMessagingServiceSid}.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${basicAuth}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              InboundRequestUrl: webhookUrl,
              InboundMethod: "POST",
            }).toString(),
          }
        );

        if (serviceUpdateRes.ok) {
          configuredMessagingService = true;
        } else {
          console.error("Twilio messaging service webhook update failed:", await serviceUpdateRes.text());
        }
      }

      if (configuredIncoming || configuredMessagingService) {
        return new Response(
          JSON.stringify({
            ok: true,
            method: configuredIncoming && configuredMessagingService
              ? "incoming_number_and_messaging_service"
              : configuredIncoming
                ? "incoming_number"
                : "messaging_service",
            messagingServiceSid: resolvedMessagingServiceSid,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          method: "manual_note",
          messagingServiceSid: resolvedMessagingServiceSid,
          note: "No se encontró el número o servicio automáticamente. Verifica en Twilio Sender/Service que el webhook apunte a esta URL.",
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
