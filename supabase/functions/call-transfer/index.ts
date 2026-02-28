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
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      return new Response(
        JSON.stringify({ error: "Credenciales de Twilio no configuradas" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify caller
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await anonClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: tenantId } = await anonClient.rpc("get_user_tenant_id", { _user_id: user.id });
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "Tenant no encontrado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { target_user_id, caller_phone, transcript, call_record_id } = await req.json();

    if (!target_user_id || !caller_phone) {
      return new Response(
        JSON.stringify({ error: "target_user_id y caller_phone son requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get target employee profile
    const { data: targetProfile } = await adminClient
      .from("profiles")
      .select("name, phone, whatsapp_number")
      .eq("user_id", target_user_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!targetProfile) {
      return new Response(
        JSON.stringify({ error: "Empleado no encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const employeePhone = targetProfile.phone || targetProfile.whatsapp_number;
    if (!employeePhone) {
      return new Response(
        JSON.stringify({ error: `${targetProfile.name} no tiene número telefónico configurado` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate AI whisper summary from transcript
    let whisperText = `Llamada transferida. Cliente al teléfono: ${caller_phone}.`;
    
    if (transcript && LOVABLE_API_KEY) {
      try {
        const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content: `Eres un asistente que genera resúmenes breves para transferencia de llamadas. 
Genera un resumen en español de máximo 3 oraciones que incluya:
1. Quién es el cliente (nombre si se mencionó)
2. Qué necesita o por qué llama
3. Cualquier dato importante mencionado (citas, presupuestos, urgencias)
Solo responde con el resumen, sin formato ni explicaciones adicionales.`,
              },
              {
                role: "user",
                content: `Transcripción de la llamada:\n${transcript}`,
              },
            ],
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const summary = aiData.choices?.[0]?.message?.content;
          if (summary) {
            whisperText = `Resumen de la llamada: ${summary}. El cliente está en la línea.`;
          }
        }
      } catch (err) {
        console.error("Error generating AI whisper:", err);
        // Continue with default whisper
      }
    }

    // Create a conference name for this transfer
    const conferenceName = `transfer_${call_record_id || Date.now()}`;

    // Build TwiML URL for the employee call (whisper + conference)
    const twimlUrl = `${supabaseUrl}/functions/v1/call-transfer-twiml?` +
      `action=whisper&` +
      `whisper=${encodeURIComponent(whisperText)}&` +
      `conference=${encodeURIComponent(conferenceName)}&` +
      `caller_phone=${encodeURIComponent(caller_phone)}`;

    // Step 1: Call the employee with whisper
    const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    
    const callParams = new URLSearchParams({
      To: employeePhone,
      From: TWILIO_PHONE_NUMBER,
      Url: twimlUrl,
      StatusCallback: `${supabaseUrl}/functions/v1/call-status-webhook`,
      StatusCallbackEvent: "completed",
    });

    const twilioResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${twilioAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: callParams.toString(),
      }
    );

    const twilioData = await twilioResponse.json();

    if (!twilioResponse.ok) {
      console.error("Twilio error:", twilioData);
      return new Response(
        JSON.stringify({ error: twilioData.message || "Error al iniciar llamada a empleado" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Call the caller and put them in the conference
    const callerTwimlUrl = `${supabaseUrl}/functions/v1/call-transfer-twiml?` +
      `action=join&` +
      `conference=${encodeURIComponent(conferenceName)}`;

    const callerCallParams = new URLSearchParams({
      To: caller_phone,
      From: TWILIO_PHONE_NUMBER,
      Url: callerTwimlUrl,
      StatusCallback: `${supabaseUrl}/functions/v1/call-status-webhook`,
      StatusCallbackEvent: "completed",
    });

    const callerResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${twilioAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: callerCallParams.toString(),
      }
    );

    const callerData = await callerResponse.json();
    if (!callerResponse.ok) {
      console.error("Twilio caller error:", callerData);
    }

    // Log the transfer event
    if (call_record_id) {
      await adminClient.from("call_events").insert({
        call_record_id,
        tenant_id: tenantId,
        event_type: "transferred",
        event_data: {
          target_user_id,
          target_name: targetProfile.name,
          target_phone: employeePhone,
          caller_phone,
          conference: conferenceName,
          employee_call_sid: twilioData.sid,
          caller_call_sid: callerData?.sid,
          whisper_summary: whisperText,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Send notifications (in-app + WhatsApp) - fire and forget
    fetch(`${supabaseUrl}/functions/v1/notify-transfer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        target_user_id,
        target_name: targetProfile.name,
        caller_phone,
        summary: whisperText,
        call_record_id,
      }),
    }).catch(err => console.error("notify-transfer fire error:", err));

    return new Response(
      JSON.stringify({
        success: true,
        conference: conferenceName,
        employee_call_sid: twilioData.sid,
        caller_call_sid: callerData?.sid,
        target_name: targetProfile.name,
        message: `Transferencia iniciada a ${targetProfile.name}. Se está llamando al empleado con whisper previo.`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("call-transfer error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
