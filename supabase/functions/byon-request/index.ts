// Create a Bring-Your-Own-Number request (hosted_sms or port_in).
// - Validates JWT and resolves tenant from profile.
// - Requires owner/admin role in that tenant.
// - Persists into byon_requests with status='pending'.
// - Notifies super_admins via audit_events (existing notification pipeline picks up).
// Documents are uploaded from the client directly to storage bucket byon-requests
// under path {tenant_id}/{request_id}/{filename}; this function only stores the
// list of paths in the documents jsonb column.
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

  const request_type = String(body?.request_type || "");
  if (!["hosted_sms", "port_in"].includes(request_type)) {
    return j({ ok: false, error: "request_type debe ser hosted_sms o port_in" }, 400);
  }
  const phone_number = String(body?.phone_number || "").trim();
  if (!/^\+[1-9]\d{6,15}$/.test(phone_number)) {
    return j({ ok: false, error: "phone_number en formato E.164 (+123456789)" }, 400);
  }
  const country_code = String(body?.country_code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country_code)) return j({ ok: false, error: "country_code inválido" }, 400);

  const current_carrier = body?.current_carrier ? String(body.current_carrier).slice(0, 200) : null;
  const desired_capabilities = {
    sms: Boolean(body?.desired_capabilities?.sms ?? true),
    voice: Boolean(body?.desired_capabilities?.voice ?? false),
    mms: Boolean(body?.desired_capabilities?.mms ?? false),
  };
  const documents = Array.isArray(body?.documents)
    ? body.documents.filter((d: any) => d && typeof d.storage_path === "string").slice(0, 10)
    : [];

  const { data: inserted, error: insErr } = await admin
    .from("byon_requests")
    .insert({
      tenant_id: tenantId,
      requested_by: userId,
      request_type,
      phone_number,
      country_code,
      current_carrier,
      desired_capabilities,
      documents,
      status: "pending",
    })
    .select("*")
    .single();
  if (insErr) return j({ ok: false, error: insErr.message }, 500);

  await admin.from("audit_events").insert({
    tenant_id: tenantId,
    event_type: "byon_request_created",
    actor_id: userId,
    resource_type: "byon_requests",
    resource_id: inserted.id,
    payload: { request_type, phone_number, country_code, documents_count: documents.length },
  });

  return j({ ok: true, request: inserted });
});
