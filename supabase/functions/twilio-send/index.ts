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
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user: authUser }, error: userError } = await anonClient.auth.getUser();
  if (userError || !authUser) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { to, body, conversationId, tenantId } = await req.json();

    if (!to || !body) {
      return new Response(
        JSON.stringify({ ok: false, error: "Destinatario y mensaje son obligatorios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = authUser.id;

    // Service client for backend lookups/inserts
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, SUPABASE_SERVICE_ROLE_KEY);

    // Resolve tenant (request value first, then by authenticated user)
    let effectiveTenantId = tenantId as string | undefined;
    if (!effectiveTenantId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", userId)
        .maybeSingle();
      effectiveTenantId = profile?.tenant_id || undefined;
    }

    // Prefer tenant WhatsApp sender config (same sender as bot conversation)
    let tenantFromNumber: string | null = null;
    let tenantMessagingServiceSid: string | null = null;
    if (effectiveTenantId) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("whatsapp_config")
        .eq("id", effectiveTenantId)
        .maybeSingle();

      const waConfig = (tenant?.whatsapp_config || {}) as Record<string, unknown>;
      if (typeof waConfig.phone_number === "string" && waConfig.phone_number.trim()) {
        tenantFromNumber = waConfig.phone_number.trim();
      }
      if (typeof waConfig.messaging_service_sid === "string" && waConfig.messaging_service_sid.trim()) {
        tenantMessagingServiceSid = waConfig.messaging_service_sid.trim();
      }
    }

    // Get Twilio credentials from secrets
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const messagingServiceSid = tenantMessagingServiceSid || Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
    const fromNumber = tenantFromNumber || Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Credenciales de Twilio no configuradas. Configúralas en el wizard de integración." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Format destination for Twilio WhatsApp (normalize MX format to +521 for mobile)
    const normalizedTo = (() => {
      const raw = String(to || '').trim().replace(/\s+/g, '');
      if (/^\+52\d{10}$/.test(raw) && !/^\+521\d{10}$/.test(raw)) return `+521${raw.slice(3)}`;
      return raw;
    })();
    const toWhatsApp = normalizedTo.startsWith("whatsapp:") ? normalizedTo : `whatsapp:${normalizedTo}`;

    const statusCallbackUrl = `${supabaseUrl}/functions/v1/whatsapp-webhook`;

    // Build request params — prefer explicit tenant sender number to keep same WhatsApp session
    const twilioParams: Record<string, string> = {
      To: toWhatsApp,
      Body: body,
      StatusCallback: statusCallbackUrl,
    };

    if (fromNumber) {
      const fromWhatsApp = fromNumber.startsWith("whatsapp:") ? fromNumber : `whatsapp:${fromNumber}`;
      twilioParams.From = fromWhatsApp;
    } else if (messagingServiceSid) {
      twilioParams.MessagingServiceSid = messagingServiceSid;
    }

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
        body: new URLSearchParams(twilioParams).toString(),
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

    const finalTenantId = effectiveTenantId || "00000000-0000-0000-0000-000000000001";

    if (conversationId) {
      await supabase.from("whatsapp_messages").insert({
        tenant_id: finalTenantId,
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
