import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { assertVoicePlan } from "../_shared/plan-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function generateWhisperText(
  transcript: string | undefined,
  callerPhone: string,
  targetName: string,
  lovableApiKey: string | undefined,
): Promise<string> {
  const fallback = `Llamada transferida a ${targetName}. Cliente al teléfono: ${callerPhone}.`;
  if (!transcript || !lovableApiKey) return fallback;

  try {
    const aiResponse = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content:
                `Eres un asistente que genera resúmenes breves para transferencia de llamadas.
Genera un resumen en español de máximo 3 oraciones que incluya:
1. Quién es el cliente (nombre si se mencionó)
2. Qué necesita o por qué llama
3. Cualquier dato importante mencionado (citas, presupuestos, urgencias)
Solo responde con el resumen, sin formato ni explicaciones adicionales.`,
            },
            { role: "user", content: `Transcripción de la llamada:\n${transcript}` },
          ],
        }),
      },
    );
    if (aiResponse.ok) {
      const aiData = await aiResponse.json();
      const summary = aiData.choices?.[0]?.message?.content;
      if (summary) {
        return `Resumen de la llamada: ${summary}. El cliente está en la línea.`;
      }
    }
  } catch (err) {
    console.error("[call-transfer] AI whisper error:", err);
  }
  return fallback;
}

/**
 * Redirects a live Twilio call (identified by call_sid) so that Twilio dials
 * target_phone. A whisper message is played to the answering party BEFORE the
 * bridge, via the `url` attribute of the <Number> verb.
 *
 * Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER in env.
 */
async function redirectLiveCallToTarget(params: {
  callSid: string;
  targetPhone: string;
  whisperText: string;
  supabaseUrl: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioCallerId: string;
  // Context propagated to call-transfer-status so, if the target does not
  // answer, the caller can be reopened with the ElevenLabs agent in
  // "absence message" mode.
  tenantId?: string;
  callRecordId?: string;
  callerPhone?: string;
  targetUserId?: string;
  targetName?: string;
}): Promise<{ ok: boolean; status: number; data: unknown }> {
  const whisperOnlyUrl = `${params.supabaseUrl}/functions/v1/call-transfer-twiml?` +
    `action=whisper_only&whisper=${encodeURIComponent(params.whisperText)}`;

  // Build the Dial action callback URL that Twilio hits when the outbound
  // <Number> leg finishes (answered, no-answer, busy, failed, canceled).
  const actionQs = new URLSearchParams({
    tenant_id: params.tenantId || "",
    call_record_id: params.callRecordId || "",
    caller_phone: params.callerPhone || "",
    target_user_id: params.targetUserId || "",
    target_name: params.targetName || "",
    target_phone: params.targetPhone || "",
  }).toString();
  const actionUrl =
    `${params.supabaseUrl}/functions/v1/call-transfer-status?${actionQs}`;

  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const escapedWhisperUrl = escape(whisperOnlyUrl);
  const escapedActionUrl = escape(actionUrl);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Mia-Neural" language="es-MX">
    Lo estamos conectando con un agente. Por favor espere un momento.
  </Say>
  <Dial callerId="${params.twilioCallerId}" answerOnBridge="true" timeout="30" action="${escapedActionUrl}" method="POST">
    <Number url="${escapedWhisperUrl}">${params.targetPhone}</Number>
  </Dial>
</Response>`;

  const twilioAuth = btoa(`${params.twilioAccountSid}:${params.twilioAuthToken}`);
  const updateParams = new URLSearchParams({ Twiml: twiml });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${params.twilioAccountSid}/Calls/${params.callSid}.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${twilioAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: updateParams.toString(),
    },
  );
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      return jsonResp({ error: "Credenciales de Twilio no configuradas" }, 500);
    }

    const authHeader = req.headers.get("authorization") || "";
    const body = await req.json().catch(() => ({}));

    // ═══════════════════════════════════════════════════════════
    // MODE A: Internal server-to-server (trusted webhook path)
    // Trigger: Authorization exactly equals `Bearer <SERVICE_ROLE_KEY>`.
    // Requires body: tenant_id, target_phone, target_name, call_sid.
    // Does NOT call auth.getUser().
    // ═══════════════════════════════════════════════════════════
    const isInternal = authHeader === `Bearer ${serviceRoleKey}`;

    if (isInternal) {
      const {
        tenant_id,
        target_phone,
        target_name,
        call_sid,
        caller_phone,
        transcript,
        call_record_id,
      } = body ?? {};

      if (!tenant_id || !target_phone || !target_name || !call_sid) {
        return jsonResp({
          error:
            "Modo interno: tenant_id, target_phone, target_name y call_sid son requeridos",
        }, 400);
      }

      const adminClient = createClient(supabaseUrl, serviceRoleKey);

      // Plan guard
      {
        const blocked = await assertVoicePlan(adminClient, tenant_id, corsHeaders);
        if (blocked) return blocked;
      }

      const whisperText = await generateWhisperText(
        transcript,
        caller_phone || "desconocido",
        target_name,
        LOVABLE_API_KEY,
      );

      const twilioRes = await redirectLiveCallToTarget({
        callSid: call_sid,
        targetPhone: target_phone,
        whisperText,
        supabaseUrl,
        twilioAccountSid: TWILIO_ACCOUNT_SID,
        twilioAuthToken: TWILIO_AUTH_TOKEN,
        twilioCallerId: TWILIO_PHONE_NUMBER,
        tenantId: tenant_id,
        callRecordId: call_record_id,
        callerPhone: caller_phone,
        targetName: target_name,
      });

      if (!twilioRes.ok) {
        console.error("[call-transfer] Twilio update error:", twilioRes.data);
        return jsonResp({
          success: false,
          error: (twilioRes.data as { message?: string })?.message ||
            `Twilio ${twilioRes.status}`,
        }, 500);
      }

      if (call_record_id) {
        await adminClient.from("call_events").insert({
          call_record_id,
          tenant_id,
          event_type: "transferred",
          event_data: {
            mode: "internal_live_redirect",
            target_name,
            target_phone,
            caller_phone,
            call_sid,
            whisper_summary: whisperText,
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Fire-and-forget notification
      fetch(`${supabaseUrl}/functions/v1/notify-transfer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          tenant_id,
          target_name,
          target_phone,
          caller_phone,
          summary: whisperText,
          call_record_id,
        }),
      }).catch((err) => console.error("notify-transfer fire error:", err));

      return jsonResp({
        success: true,
        mode: "internal_live_redirect",
        target_name,
        target_phone,
        message: `Transferencia iniciada a ${target_name}.`,
      });
    }

    // ═══════════════════════════════════════════════════════════
    // MODE B: User-authenticated (frontend flow, unchanged behavior)
    // Uses conference + two outbound legs, employee looked up via target_user_id.
    // ═══════════════════════════════════════════════════════════
    if (!authHeader) {
      return jsonResp({ error: "No autorizado" }, 401);
    }

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await anonClient.auth.getUser();
    if (!user) {
      return jsonResp({ error: "No autorizado" }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: tenantId } = await anonClient.rpc("get_user_tenant_id", {
      _user_id: user.id,
    });
    if (!tenantId) {
      return jsonResp({ error: "Tenant no encontrado" }, 400);
    }

    const { target_user_id, caller_phone, transcript, call_record_id } = body;

    if (!target_user_id || !caller_phone) {
      return jsonResp(
        { error: "target_user_id y caller_phone son requeridos" },
        400,
      );
    }

    const { data: targetProfile } = await adminClient
      .from("profiles")
      .select("name, phone, whatsapp_number")
      .eq("user_id", target_user_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!targetProfile) {
      return jsonResp({ error: "Empleado no encontrado" }, 404);
    }

    const employeePhone = targetProfile.phone || targetProfile.whatsapp_number;
    if (!employeePhone) {
      return jsonResp(
        {
          error:
            `${targetProfile.name} no tiene número telefónico configurado`,
        },
        400,
      );
    }

    const whisperText = await generateWhisperText(
      transcript,
      caller_phone,
      targetProfile.name,
      LOVABLE_API_KEY,
    );

    const conferenceName = `transfer_${call_record_id || Date.now()}`;
    const twimlUrl = `${supabaseUrl}/functions/v1/call-transfer-twiml?` +
      `action=whisper&` +
      `whisper=${encodeURIComponent(whisperText)}&` +
      `conference=${encodeURIComponent(conferenceName)}&` +
      `caller_phone=${encodeURIComponent(caller_phone)}`;

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
      },
    );

    const twilioData = await twilioResponse.json();
    if (!twilioResponse.ok) {
      console.error("Twilio error:", twilioData);
      return jsonResp(
        { error: twilioData.message || "Error al iniciar llamada a empleado" },
        500,
      );
    }

    const callerTwimlUrl = `${supabaseUrl}/functions/v1/call-transfer-twiml?` +
      `action=join&conference=${encodeURIComponent(conferenceName)}`;

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
      },
    );

    const callerData = await callerResponse.json();
    if (!callerResponse.ok) {
      console.error("Twilio caller error:", callerData);
    }

    if (call_record_id) {
      await adminClient.from("call_events").insert({
        call_record_id,
        tenant_id: tenantId,
        event_type: "transferred",
        event_data: {
          mode: "user_conference",
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
    }).catch((err) => console.error("notify-transfer fire error:", err));

    return jsonResp({
      success: true,
      conference: conferenceName,
      employee_call_sid: twilioData.sid,
      caller_call_sid: callerData?.sid,
      target_name: targetProfile.name,
      message:
        `Transferencia iniciada a ${targetProfile.name}. Se está llamando al empleado con whisper previo.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("call-transfer error:", msg);
    return jsonResp({ error: msg }, 500);
  }
});
