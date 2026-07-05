// Tenant self-service wrapper around twilio-provision-number.
// - Validates JWT and resolves tenant_id from profiles (never trusts body).
// - Requires owner/admin role in that tenant.
// - Enforces billing gate: subscription must be trialing/active (master bypasses).
// - Forwards to twilio-provision-number with service_role.
// - Records audit_events with actor_id = auth.uid().
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MASTER_TENANT = "00000000-0000-0000-0000-000000000001";

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

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return j({ ok: false, error: "Unauthorized" }, 401);
  }

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: uErr } = await anon.auth.getUser();
  if (uErr || !userData.user) return j({ ok: false, error: "Unauthorized" }, 401);
  const userId = userData.user.id;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Resolve tenant_id from profile
  const { data: profile } = await admin
    .from("profiles")
    .select("tenant_id")
    .eq("user_id", userId)
    .maybeSingle();
  const tenantId: string | undefined = profile?.tenant_id;
  if (!tenantId) return j({ ok: false, error: "No tenant associated with user" }, 403);

  // Role check: owner or admin (super_admin also passes)
  const { data: roles } = await admin
    .from("user_roles")
    .select("role, tenant_id")
    .eq("user_id", userId);
  const roleList = (roles || []) as Array<{ role: string; tenant_id: string | null }>;
  const isSuperAdmin = roleList.some((r) => r.role === "super_admin");
  const isTenantManager = roleList.some(
    (r) => r.tenant_id === tenantId && (r.role === "owner" || r.role === "admin"),
  );
  if (!isSuperAdmin && !isTenantManager) {
    return j({ ok: false, error: "Only owner or admin can purchase numbers" }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return j({ ok: false, error: "Invalid JSON body" }, 400); }

  const dryRun: boolean = body?.dryRun === true;
  const country_code: string | undefined = body?.country_code;
  const areaCode: string | undefined = body?.areaCode;
  const phoneNumber: string | undefined = body?.phoneNumber;
  const type: string | undefined = body?.type;
  const capabilities: string[] | undefined = Array.isArray(body?.capabilities) ? body.capabilities : undefined;

  // Load tenant + subscription
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, whatsapp_config")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant) return j({ ok: false, error: "Tenant not found" }, 404);

  const isMaster = tenantId === MASTER_TENANT;

  // Billing gate (master bypasses)
  if (!isMaster) {
    const { data: sub } = await admin
      .from("tenant_subscriptions")
      .select("status, trial_ends_at")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const status = sub?.status || "no_subscription";
    const trialExpired =
      status === "trialing" && sub?.trial_ends_at && new Date(sub.trial_ends_at) < new Date();
    const allowed = (status === "active" || status === "trialing") && !trialExpired;
    if (!allowed) {
      return j({
        ok: false,
        error: "billing_gate",
        message: "Tu suscripción no permite comprar números. Actualiza tu plan o método de pago.",
        subscription_status: status,
      }, 402);
    }
  }

  // Prevent duplicate active number when purchasing
  if (!dryRun) {
    const cfg = (tenant.whatsapp_config || {}) as Record<string, any>;
    if (cfg.phone_number) {
      return j({
        ok: false,
        error: "already_provisioned",
        message: "Este tenant ya tiene un número asignado.",
        phone_number: cfg.phone_number,
      }, 409);
    }
  }

  // Pricing lookup for Stripe pre-charge (skip for master + dryRun)
  let priceRow: { monthly_fee: number; currency: string } | null = null;
  if (!dryRun && !isMaster) {
    const countryForPricing = (country_code || '').toString().toUpperCase() || 'US';
    const numberTypeForPricing = (type || 'Local').toString().toLowerCase();
    const { data: price } = await admin
      .from('phone_number_pricing')
      .select('monthly_fee, currency')
      .eq('country_code', countryForPricing)
      .eq('number_type', numberTypeForPricing)
      .eq('source', 'twilio_purchase')
      .eq('active', true)
      .maybeSingle();
    if (price && Number(price.monthly_fee) > 0) {
      priceRow = { monthly_fee: Number(price.monthly_fee), currency: (price.currency || 'USD') };
    }

    // Verify payment method BEFORE Twilio purchase
    const verifyRes = await fetch(`${SUPABASE_URL}/functions/v1/stripe-billing`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ action: 'verify_payment_method', tenant_id: tenantId }),
    });
    const verifyData = await verifyRes.json().catch(() => ({}));
    if (!verifyData?.verified) {
      return j({
        ok: false,
        error: 'payment_method_required',
        message: 'Registra un método de pago antes de comprar un número.',
        setup_action: 'create_setup_session',
      }, 402);
    }
  }

  // Forward to twilio-provision-number using service role
  const forwardRes = await fetch(`${SUPABASE_URL}/functions/v1/twilio-provision-number`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      country_code,
      areaCode,
      phoneNumber,
      type,
      capabilities,
      dryRun,
    }),
  });

  const forwardData = await forwardRes.json().catch(() => ({}));

  // Audit only real purchases
  if (!dryRun && forwardRes.ok && forwardData?.ok) {
    await admin.from("audit_events").insert({
      tenant_id: tenantId,
      event_type: "tenant_number_provisioned",
      actor_id: userId,
      resource_type: "tenants",
      resource_id: tenantId,
      payload: {
        phone_number: forwardData.phone_number,
        incoming_sid: forwardData.incoming_sid,
        country_code,
        type,
        via: "tenant-provision-number",
      },
    });
  }

  // Auto-charge via Stripe after successful purchase (best effort — failure is logged, not rolled back)
  let chargeResult: any = null;
  if (!dryRun && !isMaster && forwardRes.ok && forwardData?.ok && priceRow && forwardData?.phone_number) {
    try {
      const chargeRes = await fetch(`${SUPABASE_URL}/functions/v1/stripe-billing`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({
          action: 'charge_phone_number',
          tenant_id: tenantId,
          phone_number: forwardData.phone_number,
          amount: priceRow.monthly_fee,
          currency: priceRow.currency.toLowerCase(),
          description: `Número Twilio ${forwardData.phone_number} (${country_code || ''} ${type || ''}) - primer mes`,
        }),
      });
      chargeResult = await chargeRes.json().catch(() => ({}));
      if (!chargeResult?.ok) {
        await admin.from('audit_events').insert({
          tenant_id: tenantId,
          event_type: 'tenant_number_charge_failed',
          actor_id: userId,
          resource_type: 'tenants',
          resource_id: tenantId,
          payload: { phone_number: forwardData.phone_number, error: chargeResult },
        });
      }
    } catch (chargeErr) {
      console.error('[tenant-provision] stripe charge error', chargeErr);
    }
  }

  return j({ ...forwardData, charge: chargeResult }, forwardRes.status);
});
