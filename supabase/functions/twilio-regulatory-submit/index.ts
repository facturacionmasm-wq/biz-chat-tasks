// Envía un Regulatory Bundle a Twilio.
// Solo super_admin puede invocar. Recibe byon_request_id.
// - Verifica que el cobro de verificación con Stripe esté pagado.
// - Crea EndUser en Twilio con datos del titular.
// - Sube cada documento del bucket byon-requests a Twilio (SupportingDocument
//   con attributes que incluyen signed_url de acceso).
// - Crea Bundle, asigna End User y Supporting Documents.
// - Cambia status a 'pending-review' (envía a Twilio para revisión).
// - Persiste bundle_sid, end_user_sid, supporting_document_sids en byon_requests.
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

const TWILIO_API = "https://numbers.twilio.com/v2/RegulatoryCompliance";

async function twilioForm(path: string, params: Record<string, string>, key: string) {
  const res = await fetch(`https://connector-gateway.lovable.dev/twilio${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      "X-Connection-Api-Key": key,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Twilio ${path} ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

// Direct call to numbers.twilio.com (gateway only maps /2010-04-01, so we need direct)
async function twilioDirect(
  path: string,
  method: "GET" | "POST",
  params: Record<string, string> | undefined,
  accountSid: string,
  authToken: string,
) {
  const url = `https://numbers.twilio.com${path}`;
  const auth = btoa(`${accountSid}:${authToken}`);
  const opts: RequestInit = {
    method,
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };
  if (params && method === "POST") opts.body = new URLSearchParams(params).toString();
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(`Twilio ${path} ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
  const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return j({ ok: false, error: "Twilio credentials not configured" }, 500);
  }

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return j({ ok: false, error: "Unauthorized" }, 401);

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData } = await anon.auth.getUser();
  if (!userData?.user) return j({ ok: false, error: "Unauthorized" }, 401);
  const userId = userData.user.id;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
  const isSuper = (roles || []).some((r: any) => r.role === "super_admin");
  if (!isSuper) return j({ ok: false, error: "super_admin required" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return j({ ok: false, error: "Invalid JSON" }, 400); }
  const byonId = String(body?.byon_request_id || "");
  if (!byonId) return j({ ok: false, error: "byon_request_id required" }, 400);

  const { data: reqRow, error: reqErr } = await admin
    .from("byon_requests")
    .select("*")
    .eq("id", byonId)
    .maybeSingle();
  if (reqErr || !reqRow) return j({ ok: false, error: "Solicitud no encontrada" }, 404);
  if (reqRow.request_type !== "regulatory_bundle") {
    return j({ ok: false, error: "Solo aplica a regulatory_bundle" }, 400);
  }
  if (!reqRow.verification_fee_paid) {
    return j({ ok: false, error: "El tenant aún no pagó la verificación con Stripe" }, 402);
  }
  if (reqRow.twilio_bundle_sid) {
    return j({ ok: false, error: "Ya se envió a Twilio (bundle_sid existe)", bundle_sid: reqRow.twilio_bundle_sid }, 409);
  }

  const caps = reqRow.desired_capabilities || {};
  const entityType: string = caps.entity_type || "business";
  const businessName: string = caps.business_name || caps.contact_name || "Business";
  const contactName: string = caps.contact_name || "Contact";
  const address: string = caps.address || "";
  const taxId: string = caps.tax_id || "";
  const countryCode: string = reqRow.country_code;

  try {
    // 1) End User
    const endUserAttrs: Record<string, unknown> = {
      business_name: businessName,
      first_name: contactName.split(" ")[0] || contactName,
      last_name: contactName.split(" ").slice(1).join(" ") || contactName,
      address: address,
      tax_id: taxId,
      country: countryCode,
    };
    const endUser = await twilioDirect(
      "/v2/RegulatoryCompliance/EndUsers",
      "POST",
      {
        FriendlyName: `${businessName} - ${countryCode}`,
        Type: entityType === "individual" ? "individual" : "business",
        Attributes: JSON.stringify(endUserAttrs),
      },
      TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN,
    );

    // 2) Supporting Documents — para cada doc, generamos signed URL y creamos SupportingDocument con la URL en attributes
    const docs: any[] = Array.isArray(reqRow.documents) ? reqRow.documents : [];
    const docSids: Array<{ type: string; sid: string; name: string }> = [];
    for (const d of docs) {
      if (!d?.storage_path) continue;
      // Signed URL 7 días para que Twilio pueda descargar durante revisión
      const { data: signed } = await admin.storage
        .from("byon-requests")
        .createSignedUrl(d.storage_path, 60 * 60 * 24 * 7);
      const docAttrs = {
        document_url: signed?.signedUrl || null,
        document_type: d.type,
        file_name: d.name,
        submitted_by: "OfficeHub",
      };
      const sd = await twilioDirect(
        "/v2/RegulatoryCompliance/SupportingDocuments",
        "POST",
        {
          FriendlyName: `${d.type} - ${businessName}`,
          Type: d.type,
          Attributes: JSON.stringify(docAttrs),
        },
        TWILIO_ACCOUNT_SID,
        TWILIO_AUTH_TOKEN,
      );
      docSids.push({ type: d.type, sid: sd.sid, name: d.name });
    }

    // 3) Bundle
    const bundle = await twilioDirect(
      "/v2/RegulatoryCompliance/Bundles",
      "POST",
      {
        FriendlyName: `Bundle ${businessName} ${countryCode}`,
        Email: userData.user.email || "admin@officehub.app",
        StatusCallback: `${SUPABASE_URL.replace("/rest/v1", "").replace(".supabase.co", ".functions.supabase.co")}/twilio-bundle-webhook`,
      },
      TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN,
    );
    const bundleSid = bundle.sid;

    // 4) Attach End User to bundle
    await twilioDirect(
      `/v2/RegulatoryCompliance/Bundles/${bundleSid}/ItemAssignments`,
      "POST",
      { ObjectSid: endUser.sid },
      TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN,
    );
    // Attach each supporting document
    for (const ds of docSids) {
      await twilioDirect(
        `/v2/RegulatoryCompliance/Bundles/${bundleSid}/ItemAssignments`,
        "POST",
        { ObjectSid: ds.sid },
        TWILIO_ACCOUNT_SID,
        TWILIO_AUTH_TOKEN,
      );
    }

    // 5) Submit for review
    const submitted = await twilioDirect(
      `/v2/RegulatoryCompliance/Bundles/${bundleSid}`,
      "POST",
      { Status: "pending-review" },
      TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN,
    );

    await admin.from("byon_requests").update({
      twilio_bundle_sid: bundleSid,
      twilio_end_user_sid: endUser.sid,
      twilio_supporting_document_sids: docSids,
      twilio_status: submitted.status || "pending-review",
      twilio_submitted_at: new Date().toISOString(),
      twilio_last_synced_at: new Date().toISOString(),
      status: "in_review",
    }).eq("id", byonId);

    await admin.from("audit_events").insert({
      tenant_id: reqRow.tenant_id,
      event_type: "twilio_bundle_submitted",
      actor_id: userId,
      resource_type: "byon_requests",
      resource_id: byonId,
      payload: { bundle_sid: bundleSid, end_user_sid: endUser.sid, docs: docSids.length, country: countryCode },
    });

    return j({ ok: true, bundle_sid: bundleSid, end_user_sid: endUser.sid, status: submitted.status, docs: docSids });
  } catch (e: any) {
    console.error("twilio-regulatory-submit error:", e);
    await admin.from("audit_events").insert({
      tenant_id: reqRow.tenant_id,
      event_type: "twilio_bundle_submit_failed",
      actor_id: userId,
      resource_type: "byon_requests",
      resource_id: byonId,
      payload: { error: e?.message || String(e) },
    });
    return j({ ok: false, error: e?.message || "Error enviando a Twilio" }, 500);
  }
});
