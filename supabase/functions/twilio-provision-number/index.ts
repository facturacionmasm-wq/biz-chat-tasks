// Twilio Number Provisioning — super_admin only. Real purchases cost money.
// Use dryRun=true to preview available numbers without spending.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const j = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
  const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
  const TWILIO_MESSAGING_SERVICE_SID_GLOBAL = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return j({ ok: false, error: "Twilio credentials not configured" }, 500);
  }

  // ---- Auth: super_admin via user JWT, OR service_role bearer for internal use.
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const isServiceRole = bearer === SUPABASE_SERVICE_ROLE_KEY;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (!isServiceRole) {
    if (!bearer) return j({ ok: false, error: "Unauthorized" }, 401);
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data: userData, error: uErr } = await anonClient.auth.getUser();
    if (uErr || !userData.user) return j({ ok: false, error: "Unauthorized" }, 401);
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "super_admin")
      .maybeSingle();
    if (!roleRow) return j({ ok: false, error: "Only super_admin can provision numbers" }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return j({ ok: false, error: "Invalid JSON body" }, 400); }

  const tenant_id: string | undefined = body?.tenant_id;
  const areaCode: string | undefined = body?.areaCode;
  const dryRun: boolean = body?.dryRun === true;
  let country_code: string = (body?.country_code || "").toUpperCase();
  const phoneNumberOverride: string | undefined = body?.phoneNumber; // required when purchasing a specific one
  const rawType: string = String(body?.type || "Local");
  const type: "Local" | "Mobile" | "TollFree" =
    rawType === "Mobile" ? "Mobile" : rawType === "TollFree" ? "TollFree" : "Local";
  const capabilities: string[] = Array.isArray(body?.capabilities) ? body.capabilities : [];
  const wantSms = capabilities.length === 0 || capabilities.includes("SMS");
  const wantVoice = capabilities.length === 0 || capabilities.includes("Voice");
  const wantMms = capabilities.includes("MMS");

  if (!tenant_id) return j({ ok: false, error: "tenant_id is required" }, 400);

  // Load tenant to get country default + existing whatsapp_config
  const { data: tenant, error: tErr } = await supabase
    .from("tenants")
    .select("id, name, country_code, whatsapp_config")
    .eq("id", tenant_id)
    .maybeSingle();
  if (tErr) console.error("[twilio-provision] tenant lookup error:", tErr, "tenant_id:", tenant_id);
  if (!tenant) {
    console.error("[twilio-provision] tenant not found:", tenant_id);
    return j({ ok: false, error: "tenant_not_found", message: `No se encontró el tenant (${String(tenant_id).slice(0,8)}).` }, 200);
  }

  if (!country_code) country_code = (tenant.country || "US").toUpperCase();

  const basicAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const twilioHeaders = { Authorization: `Basic ${basicAuth}` };

  // ---------- (a) List available numbers ----------
  const listUrl = new URL(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/AvailablePhoneNumbers/${country_code}/${type}.json`
  );
  if (wantSms) listUrl.searchParams.set("SmsEnabled", "true");
  if (wantVoice) listUrl.searchParams.set("VoiceEnabled", "true");
  if (wantMms) listUrl.searchParams.set("MmsEnabled", "true");
  listUrl.searchParams.set("PageSize", "20");
  if (areaCode) listUrl.searchParams.set("AreaCode", areaCode);

  const listRes = await fetch(listUrl.toString(), { headers: twilioHeaders });
  const listData = await listRes.json();
  if (!listRes.ok) {
    console.error("[provision] list error:", JSON.stringify(listData));
    return j({ ok: false, error: listData.message || "Twilio list failed", code: listData.code }, listRes.status);
  }
  const available: any[] = Array.isArray(listData.available_phone_numbers) ? listData.available_phone_numbers : [];

  if (dryRun) {
    return j({
      ok: true,
      dryRun: true,
      country_code,
      type,
      areaCode: areaCode || null,
      count: available.length,
      numbers: available.slice(0, 20).map((n) => ({
        phone_number: n.phone_number,
        friendly_name: n.friendly_name,
        locality: n.locality,
        region: n.region,
        iso_country: n.iso_country,
        capabilities: n.capabilities,
      })),
    });
  }

  // ---------- (b) Purchase ----------
  const chosen = phoneNumberOverride || available[0]?.phone_number;
  if (!chosen) return j({ ok: false, error: "No available numbers matched" }, 404);

  const webhookUrl = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;

  const purchaseParams = new URLSearchParams({
    PhoneNumber: chosen,
    SmsUrl: webhookUrl,
    SmsMethod: "POST",
    FriendlyName: `Tenant ${tenant.name} (${tenant_id.slice(0, 8)})`,
  });

  const purchaseRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json`,
    {
      method: "POST",
      headers: { ...twilioHeaders, "Content-Type": "application/x-www-form-urlencoded" },
      body: purchaseParams.toString(),
    }
  );
  const purchaseData = await purchaseRes.json();
  if (!purchaseRes.ok) {
    console.error("[provision] purchase error:", JSON.stringify(purchaseData));
    return j({ ok: false, error: purchaseData.message || "Twilio purchase failed", code: purchaseData.code }, purchaseRes.status);
  }

  const purchasedNumber: string = purchaseData.phone_number;
  const incomingSid: string = purchaseData.sid;

  // ---------- (c) Attach to Messaging Service (optional) ----------
  const existingConfig = (tenant.whatsapp_config || {}) as Record<string, any>;
  let messagingServiceSid: string | null =
    existingConfig.messaging_service_sid || TWILIO_MESSAGING_SERVICE_SID_GLOBAL || null;

  if (messagingServiceSid) {
    try {
      const msRes = await fetch(
        `https://messaging.twilio.com/v1/Services/${messagingServiceSid}/PhoneNumbers`,
        {
          method: "POST",
          headers: { ...twilioHeaders, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ PhoneNumberSid: incomingSid }).toString(),
        }
      );
      if (!msRes.ok) {
        const msErr = await msRes.json().catch(() => ({}));
        console.warn("[provision] messaging-service attach warning:", JSON.stringify(msErr));
        // do not fail — number is still usable directly
      }
    } catch (err) {
      console.warn("[provision] messaging-service attach exception:", err);
    }
  }

  // ---------- (d) Persist in tenants.whatsapp_config ----------
  const newConfig = {
    ...existingConfig,
    phone_number: purchasedNumber,
    incoming_phone_sid: incomingSid,
    provisioned_at: new Date().toISOString(),
    provisioned_via: "twilio-provision-number",
    ...(messagingServiceSid ? { messaging_service_sid: messagingServiceSid } : {}),
  };

  const { error: updErr } = await supabase
    .from("tenants")
    .update({ whatsapp_config: newConfig })
    .eq("id", tenant_id);
  if (updErr) {
    console.error("[provision] tenant update error:", updErr);
    return j({
      ok: false,
      error: "Number purchased but failed to persist to tenant. Contact support.",
      purchased_number: purchasedNumber,
      incoming_sid: incomingSid,
    }, 500);
  }

  // Lookup monthly fee from pricing catalog and register the number
  const countryForPricing = (body?.country_code || '').toString().toUpperCase() || 'US';
  const numberTypeForPricing = (body?.type || 'Local').toString().toLowerCase();
  let monthlyFee = 0;
  let currency = 'USD';
  try {
    const { data: price } = await supabase
      .from('phone_number_pricing')
      .select('monthly_fee, currency')
      .eq('country_code', countryForPricing)
      .eq('number_type', numberTypeForPricing)
      .eq('source', 'twilio_purchase')
      .eq('active', true)
      .maybeSingle();
    if (price) { monthlyFee = Number(price.monthly_fee); currency = price.currency; }
  } catch (_) { /* pricing optional */ }

  try {
    await supabase.from('tenant_phone_numbers').upsert({
      tenant_id,
      phone_e164: purchasedNumber,
      provider: 'twilio',
      label: existingConfig.friendly_name || null,
      active: true,
      monthly_fee: monthlyFee,
      currency,
      billing_status: monthlyFee > 0 ? 'pending' : 'active',
      source: 'twilio_purchase',
      activated_at: new Date().toISOString(),
      next_billing_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: 'phone_e164' });
  } catch (regErr) {
    console.warn('[provision] tenant_phone_numbers register warning:', regErr);
  }

  // audit
  await supabase.from("audit_events").insert({
    tenant_id,
    event_type: "twilio_number_provisioned",
    resource_type: "tenants",
    resource_id: tenant_id,
    payload: { phone_number: purchasedNumber, incoming_sid: incomingSid, messaging_service_sid: messagingServiceSid, monthly_fee: monthlyFee, currency },
  });

  return j({
    ok: true,
    dryRun: false,
    tenant_id,
    phone_number: purchasedNumber,
    incoming_sid: incomingSid,
    messaging_service_sid: messagingServiceSid,
    webhook_url: webhookUrl,
  });
});
