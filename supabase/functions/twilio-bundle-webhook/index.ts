// Webhook público de Twilio para actualizaciones de Regulatory Bundle.
// Twilio hace POST cuando cambia el estado del Bundle (twilio-approved,
// twilio-rejected, provisionally-approved, etc.). Sincronizamos byon_requests.
// verify_jwt = false (Twilio no envía JWT nuestro).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-twilio-signature",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    let payload: Record<string, string> = {};
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      payload = await req.json();
    } else {
      const form = await req.formData();
      form.forEach((v, k) => { payload[k] = String(v); });
    }

    console.log("twilio-bundle-webhook payload:", payload);

    const bundleSid = payload.BundleSid || payload.Sid || payload.sid;
    const status = payload.Status || payload.status;
    const rejectionReason = payload.RejectionReason || payload.rejection_reason || null;

    if (!bundleSid) {
      return new Response(JSON.stringify({ ok: false, error: "BundleSid missing" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: row } = await admin
      .from("byon_requests")
      .select("id, tenant_id, status")
      .eq("twilio_bundle_sid", bundleSid)
      .maybeSingle();

    if (!row) {
      // No hallado — igual respondemos 200 para que Twilio no reintente indefinidamente
      return new Response(JSON.stringify({ ok: true, note: "bundle not tracked" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mapear status Twilio → status interno
    let internalStatus = row.status;
    if (status === "twilio-approved" || status === "provisionally-approved") internalStatus = "approved";
    else if (status === "twilio-rejected") internalStatus = "rejected";
    else if (status === "pending-review" || status === "in-review") internalStatus = "in_review";

    await admin.from("byon_requests").update({
      twilio_status: status,
      twilio_rejection_reason: rejectionReason,
      twilio_last_synced_at: new Date().toISOString(),
      status: internalStatus,
      reviewed_at: (internalStatus === "approved" || internalStatus === "rejected") ? new Date().toISOString() : null,
    }).eq("id", row.id);

    await admin.from("audit_events").insert({
      tenant_id: row.tenant_id,
      event_type: "twilio_bundle_status_updated",
      resource_type: "byon_requests",
      resource_id: row.id,
      payload: { bundle_sid: bundleSid, status, rejection_reason: rejectionReason },
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("twilio-bundle-webhook error:", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
