// Deletes a tenant and all associated data. Super_admin only.
// Master tenant (00000000-0000-0000-0000-000000000001) is protected.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MASTER_TENANT = "00000000-0000-0000-0000-000000000001";

const j = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return j({ error: "Unauthorized" }, 401);

    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await anon.auth.getUser();
    const caller = userData?.user;
    if (!caller) return j({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "super_admin")
      .maybeSingle();
    if (!roleRow) return j({ error: "Only super_admin can delete tenants" }, 403);

    const { tenant_id, confirm_name } = await req.json();
    if (!tenant_id || typeof tenant_id !== "string") {
      return j({ error: "tenant_id required" }, 400);
    }
    if (tenant_id === MASTER_TENANT) {
      return j({ error: "Master tenant cannot be deleted" }, 400);
    }

    const { data: tenant } = await admin
      .from("tenants")
      .select("id, name")
      .eq("id", tenant_id)
      .maybeSingle();
    if (!tenant) return j({ error: "Tenant not found" }, 404);

    if (confirm_name && confirm_name !== tenant.name) {
      return j({ error: "El nombre de confirmación no coincide" }, 400);
    }

    // Cancel Stripe subscriptions if present
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (STRIPE_SECRET_KEY) {
      const { data: sc } = await admin
        .from("stripe_customers")
        .select("stripe_customer_id, stripe_subscription_id")
        .eq("tenant_id", tenant_id)
        .maybeSingle();
      if (sc?.stripe_subscription_id) {
        try {
          await fetch(`https://api.stripe.com/v1/subscriptions/${sc.stripe_subscription_id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
          });
        } catch (e) {
          console.warn("stripe cancel error:", e);
        }
      }
    }

    // Collect user_ids for later auth cleanup
    const { data: profileUsers } = await admin
      .from("profiles")
      .select("user_id")
      .eq("tenant_id", tenant_id);
    const userIds = (profileUsers || []).map((p: any) => p.user_id as string);

    // Delete tenant (cascades via FK where configured)
    const { error: delErr } = await admin.from("tenants").delete().eq("id", tenant_id);
    if (delErr) return j({ error: delErr.message }, 500);

    // Best-effort cleanup for tables without FK cascade
    const cleanupTables = [
      "profiles",
      "user_roles",
      "tenant_subscriptions",
      "tenant_phone_numbers",
      "phone_number_invoices",
      "stripe_customers",
      "tenant_usage_monthly",
      "tenant_package_balances",
      "tenant_pricing_adjustments",
      "tenant_rate_limits",
      "tenant_churn_scores",
      "tenant_ltv_estimates",
      "tenant_offer_history",
      "tenant_drive_settings",
      "byon_requests",
    ];
    for (const t of cleanupTables) {
      try {
        await admin.from(t).delete().eq("tenant_id", tenant_id);
      } catch (_) { /* table may not have tenant_id or already cascaded */ }
    }

    // Delete auth users that belonged only to this tenant
    for (const uid of userIds) {
      const { data: otherRoles } = await admin
        .from("user_roles")
        .select("id")
        .eq("user_id", uid)
        .limit(1);
      if (!otherRoles || otherRoles.length === 0) {
        try {
          await admin.auth.admin.deleteUser(uid);
        } catch (e) {
          console.warn("auth delete error", uid, e);
        }
      }
    }

    await admin.from("audit_events").insert({
      tenant_id: MASTER_TENANT,
      event_type: "tenant_deleted",
      actor_id: caller.id,
      resource_type: "tenants",
      resource_id: tenant_id,
      payload: {
        deleted_tenant_name: tenant.name,
        users_removed: userIds.length,
      },
    });

    return j({ ok: true, tenant_id, users_removed: userIds.length });
  } catch (err: any) {
    console.error("admin-delete-tenant error", err);
    return j({ error: err?.message || "Internal error" }, 500);
  }
});
