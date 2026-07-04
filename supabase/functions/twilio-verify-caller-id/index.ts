// Verified Caller ID with Twilio.
// Two actions:
//   start   -> creates a validation request; Twilio calls/sms the number with a 6-digit code.
//   confirm -> checks OutgoingCallerIds list; if the number appears verified, persist it.
// The number is stored in tenants.settings_json.verified_caller_ids (array of {phone_number, verified_at}).
// Never touches whatsapp_config, twilio-provision-number or any other flow.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
  const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return j({ ok: false, error: "Twilio no está configurado en el servidor." }, 500);
  }

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return j({ ok: false, error: "Unauthorized" }, 401);

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error: uErr } = await anon.auth.getUser();
  if (uErr || !userData.user) return j({ ok: false, error: "Unauthorized" }, 401);
  const userId = userData.user.id;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: profile } = await admin
    .from("profiles")
    .select("tenant_id")
    .eq("user_id", userId)
    .maybeSingle();
  const tenantId = profile?.tenant_id;
  if (!tenantId) return j({ ok: false, error: "No tenant" }, 403);

  const { data: roles } = await admin
    .from("user_roles")
    .select("role, tenant_id")
    .eq("user_id", userId);
  const roleList = (roles || []) as Array<{ role: string; tenant_id: string | null }>;
  const canManage =
    roleList.some((r) => r.role === "super_admin") ||
    roleList.some((r) => r.tenant_id === tenantId && (r.role === "owner" || r.role === "admin"));
  if (!canManage) return j({ ok: false, error: "Only owner/admin" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return j({ ok: false, error: "Invalid JSON" }, 400); }
  const action = body?.action as string | undefined;
  const phoneRaw = String(body?.phone_number || "").trim();
  if (!phoneRaw) return j({ ok: false, error: "phone_number requerido" }, 400);
  if (!/^\+[1-9]\d{6,15}$/.test(phoneRaw)) {
    return j({ ok: false, error: "phone_number debe estar en formato E.164 (+123456789)" }, 400);
  }

  const basic = "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const twilioBase = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}`;

  if (action === "start") {
    const via = (body?.via === "call" ? "call" : "sms") as "sms" | "call";
    const params = new URLSearchParams({
      PhoneNumber: phoneRaw,
      FriendlyName: `Verified caller ${phoneRaw}`,
      CallDelay: "0",
    });
    // Twilio uses ValidationRequests; delivery method is inferred by CallDelay/type.
    // For SMS-based verification, request with SMS by adding Verify param via header is not supported;
    // Twilio always calls the number, but SMS verification is available on newer accounts by omitting CallDelay.
    // We rely on default behavior; via just informs the UI.
    const res = await fetch(`${twilioBase}/OutgoingCallerIds.json`, {
      method: "POST",
      headers: { Authorization: basic, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return j({
        ok: false,
        error: data?.message || "Twilio rechazó la solicitud",
        code: data?.code,
        via,
      }, res.status);
    }
    await admin.from("audit_events").insert({
      tenant_id: tenantId,
      event_type: "byon_verified_caller_id_start",
      actor_id: userId,
      resource_type: "tenants",
      resource_id: tenantId,
      payload: { phone_number: phoneRaw, via, validation_code: data?.validation_code || null },
    });
    return j({
      ok: true,
      validation_code: data?.validation_code || null,
      call_sid: data?.call_sid || null,
      via,
      message: "Twilio te llamará (o enviará un SMS) con un código de 6 dígitos. Contesta e ingresa el código en tu teléfono.",
    });
  }

  if (action === "confirm") {
    // Verified numbers appear in OutgoingCallerIds list once user completes challenge.
    const res = await fetch(`${twilioBase}/OutgoingCallerIds.json?PhoneNumber=${encodeURIComponent(phoneRaw)}`, {
      headers: { Authorization: basic },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return j({ ok: false, error: data?.message || "Twilio error" }, res.status);

    const list = (data?.outgoing_caller_ids || []) as any[];
    const found = list.find((x) => x?.phone_number === phoneRaw);
    if (!found) {
      return j({ ok: false, verified: false, message: "Aún no se recibe la validación. Intenta de nuevo en unos segundos." });
    }

    // Persist in tenants.settings_json.verified_caller_ids
    const { data: tenant } = await admin
      .from("tenants")
      .select("settings_json")
      .eq("id", tenantId)
      .maybeSingle();
    const settings = (tenant?.settings_json as Record<string, any>) || {};
    const arr = Array.isArray(settings.verified_caller_ids) ? settings.verified_caller_ids : [];
    if (!arr.some((x: any) => x.phone_number === phoneRaw)) {
      arr.push({
        phone_number: phoneRaw,
        verified_at: new Date().toISOString(),
        twilio_sid: found.sid || null,
      });
    }
    settings.verified_caller_ids = arr;
    await admin.from("tenants").update({ settings_json: settings }).eq("id", tenantId);

    await admin.from("audit_events").insert({
      tenant_id: tenantId,
      event_type: "byon_verified_caller_id_confirmed",
      actor_id: userId,
      resource_type: "tenants",
      resource_id: tenantId,
      payload: { phone_number: phoneRaw, twilio_sid: found.sid || null },
    });

    return j({ ok: true, verified: true, phone_number: phoneRaw });
  }

  if (action === "list") {
    const { data: tenant } = await admin
      .from("tenants")
      .select("settings_json")
      .eq("id", tenantId)
      .maybeSingle();
    const settings = (tenant?.settings_json as Record<string, any>) || {};
    return j({ ok: true, verified_caller_ids: settings.verified_caller_ids || [] });
  }

  return j({ ok: false, error: "action must be start|confirm|list" }, 400);
});
