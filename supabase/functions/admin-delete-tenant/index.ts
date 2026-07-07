// Deletes a tenant and all associated data. Super_admin only.
// Master tenant (00000000-0000-0000-0000-000000000001) is protected.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

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
    const STRIPE_RESTRICTED_API_KEY = Deno.env.get("STRIPE_RESTRICTED_API_KEY");
    if (STRIPE_RESTRICTED_API_KEY) {
      const { data: sc } = await admin
        .from("stripe_customers")
        .select("stripe_customer_id, stripe_subscription_id")
        .eq("tenant_id", tenant_id)
        .maybeSingle();
      if (sc?.stripe_subscription_id) {
        try {
          await fetch(`https://api.stripe.com/v1/subscriptions/${sc.stripe_subscription_id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${STRIPE_RESTRICTED_API_KEY}` },
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

    // Purge audit_events and user_roles first to avoid noise from the
    // audit_role_changes trigger firing during cascade cleanup.
    await admin.from("audit_events").delete().eq("tenant_id", tenant_id);
    await admin.from("user_roles").delete().eq("tenant_id", tenant_id);

    // Some tenant-owned tables were created with restrictive foreign keys instead
    // of ON DELETE CASCADE. Remove those rows first, then delete the tenant so
    // regular cascade relationships can finish the cleanup.
    const preTenantCleanupTables = [
      "appointment_notifications",
      "transfer_notifications",
      "call_events",
      "call_jobs",
      "call_sessions",
      "document_chunks",
      "document_workflow_log",
      "assistant_conversations",
      "assistant_settings",
      "contacts",
      "document_memory",
      "document_workflow_rules",
      "expenses",
      "google_calendar_tokens",
      "push_subscriptions",
      "reminders",
      "shared_credentials",
      "tenant_ltv_estimates",
      "tenant_package_balances",
      "usage_costs_reconciled",
      "whatsapp_usage_events",
    ];

    for (const table of preTenantCleanupTables) {
      const { error: cleanupErr } = await admin.from(table).delete().eq("tenant_id", tenant_id);
      if (cleanupErr) {
        console.error(`tenant cleanup failed on ${table}:`, cleanupErr.message);
        return j({ error: `No se pudo limpiar ${table}: ${cleanupErr.message}` }, 500);
      }
    }

    const { error: delErr } = await admin.from("tenants").delete().eq("id", tenant_id);
    if (delErr) return j({ error: delErr.message }, 500);

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

    const { data: auditTenant } = await admin
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", caller.id)
      .not("tenant_id", "eq", tenant_id)
      .maybeSingle();

    const auditTenantId = auditTenant?.tenant_id || MASTER_TENANT;
    try {
      const { error: auditErr } = await admin.from("audit_events").insert({
        tenant_id: auditTenantId,
        event_type: "tenant_deleted",
        actor_id: caller.id,
        resource_type: "tenants",
        resource_id: tenant_id,
        payload: {
          deleted_tenant_name: tenant.name,
          users_removed: userIds.length,
        },
      });
      if (auditErr) console.warn("audit insert skipped", auditErr.message);
    } catch (e) {
      console.warn("audit insert skipped", e);
    }

    return j({ ok: true, tenant_id, users_removed: userIds.length });
  } catch (err: any) {
    console.error("admin-delete-tenant error", err);
    return j({ error: err?.message || "Internal error" }, 500);
  }
});
