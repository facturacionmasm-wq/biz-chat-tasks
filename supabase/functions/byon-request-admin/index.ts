// Super admin management for byon_requests.
// - List all requests (with tenant name).
// - Update status / admin_notes.
// - JWT + super_admin role required.
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

const ALLOWED_STATUS = ["pending", "in_review", "approved", "completed", "rejected"];

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
  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const isSuper = (roles || []).some((r: any) => r.role === "super_admin");
  if (!isSuper) return j({ ok: false, error: "super_admin required" }, 403);

  const url = new URL(req.url);

  if (req.method === "GET") {
    const status = url.searchParams.get("status");
    let q = admin
      .from("byon_requests")
      .select("*, tenants:tenant_id(name)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return j({ ok: false, error: error.message }, 500);

    // Sign document URLs (1h) for review
    const signed = await Promise.all(
      (data || []).map(async (r: any) => {
        const docs = Array.isArray(r.documents) ? r.documents : [];
        const withUrls = await Promise.all(
          docs.map(async (d: any) => {
            if (!d?.storage_path) return d;
            const { data: signedUrl } = await admin.storage
              .from("byon-requests")
              .createSignedUrl(d.storage_path, 3600);
            return { ...d, signed_url: signedUrl?.signedUrl || null };
          }),
        );
        return { ...r, documents: withUrls };
      }),
    );
    return j({ ok: true, requests: signed });
  }

  if (req.method === "PATCH" || req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return j({ ok: false, error: "Invalid JSON" }, 400); }
    const id = String(body?.id || "");
    if (!id) return j({ ok: false, error: "id requerido" }, 400);
    const status = body?.status ? String(body.status) : undefined;
    if (status && !ALLOWED_STATUS.includes(status)) {
      return j({ ok: false, error: "status inválido" }, 400);
    }
    const admin_notes = body?.admin_notes !== undefined ? String(body.admin_notes).slice(0, 2000) : undefined;

    const patch: Record<string, any> = { reviewed_by: userId, reviewed_at: new Date().toISOString() };
    if (status !== undefined) patch.status = status;
    if (admin_notes !== undefined) patch.admin_notes = admin_notes;

    const { data, error } = await admin
      .from("byon_requests")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) return j({ ok: false, error: error.message }, 500);

    await admin.from("audit_events").insert({
      tenant_id: data.tenant_id,
      event_type: "byon_request_updated",
      actor_id: userId,
      resource_type: "byon_requests",
      resource_id: id,
      payload: { status, admin_notes },
    });

    return j({ ok: true, request: data });
  }

  return j({ ok: false, error: "Method not allowed" }, 405);
});
