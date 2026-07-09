import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { enqueueJob } from "../_shared/jobs.ts";
import { isDryRun, simulatedOk, LOADTEST_TENANT_ID } from "../_shared/loadtest.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPPORT_EMAIL = "soporte@rybixholding.com";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id, name, email")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile?.tenant_id) return json({ error: "No tenant" }, 403);

    const { subject, message, priority = "normal", contact_email } = await req.json();
    if (!subject || !message) return json({ error: "subject and message required" }, 400);

    // Dry-run guard: LOADTEST or explicit signal → simulate send, no Resend/enqueue.
    const dryRun = isDryRun(req) || profile.tenant_id === LOADTEST_TENANT_ID;
    if (dryRun) {
      return json(simulatedOk("support_email", { subject, priority, tenant_id: profile.tenant_id }));
    }


    // Fetch tenant name for the email body
    const { data: tenant } = await admin
      .from("tenants")
      .select("name")
      .eq("id", profile.tenant_id)
      .maybeSingle();

    // 1. Create a support ticket in the DB
    const validPriorities = ["urgent", "high", "normal", "low"];
    const pr = validPriorities.includes(priority) ? priority : "normal";

    // SLA calc (mirrors support-ticket-manager)
    const slaMap: Record<string, { first: number; res: number }> = {
      urgent: { first: 15, res: 60 },
      high: { first: 60, res: 240 },
      normal: { first: 240, res: 1440 },
      low: { first: 1440, res: 4320 },
    };
    const sla = slaMap[pr];
    const now = new Date();
    const slaFirst = new Date(now.getTime() + sla.first * 60000).toISOString();
    const slaRes = new Date(now.getTime() + sla.res * 60000).toISOString();

    const { data: ticket, error: ticketErr } = await admin
      .from("support_tickets")
      .insert({
        tenant_id: profile.tenant_id,
        subject,
        description: message,
        priority: pr,
        status: "open",
        channel: "manual",
        created_by: user.id,
        sla_first_response_at: slaFirst,
        sla_resolution_at: slaRes,
        tags: ["email_support"],
      })
      .select("id")
      .single();

    if (ticketErr) {
      console.error("Ticket creation failed:", ticketErr);
      return json({ error: "Could not create ticket: " + ticketErr.message }, 500);
    }

    const ticketId = ticket.id;
    const ticketShort = String(ticketId).slice(0, 8);

    // 2. Enqueue email send (fallback to direct Resend POST if enqueue fails).
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    let emailSent = false;
    let emailQueued = false;
    let emailError: string | null = null;

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
        <h2 style="color:#0f172a">Nuevo ticket de soporte #${ticketShort}</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
          <tr><td style="padding:6px 0;color:#64748b;width:120px"><b>Tenant</b></td><td>${escapeHtml(tenant?.name || "—")} (<code>${profile.tenant_id}</code>)</td></tr>
          <tr><td style="padding:6px 0;color:#64748b"><b>Remitente</b></td><td>${escapeHtml(profile.name || user.email || "—")}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b"><b>Email contacto</b></td><td>${escapeHtml(contact_email || user.email || "—")}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b"><b>Prioridad</b></td><td><span style="text-transform:uppercase;padding:2px 8px;border-radius:6px;background:#f1f5f9">${pr}</span></td></tr>
          <tr><td style="padding:6px 0;color:#64748b"><b>Ticket ID</b></td><td><code>${ticketId}</code></td></tr>
        </table>
        <h3 style="color:#0f172a;margin-top:24px">Asunto</h3>
        <p style="background:#f8fafc;padding:12px;border-radius:8px">${escapeHtml(subject)}</p>
        <h3 style="color:#0f172a">Mensaje</h3>
        <div style="background:#f8fafc;padding:12px;border-radius:8px;white-space:pre-wrap">${escapeHtml(message)}</div>
        <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0" />
        <p style="font-size:12px;color:#94a3b8">Este correo fue generado automáticamente desde el Centro de Soporte de OfficeHub.</p>
      </div>
    `;

    const emailPayload = {
      to: SUPPORT_EMAIL,
      from: "Soporte OfficeHub <soporte@rybixholding.com>",
      replyTo: contact_email || user.email,
      subject: `[${pr.toUpperCase()}] #${ticketShort} · ${subject}`,
      html: htmlBody,
      kind: "support_ticket",
    };

    if (!RESEND_API_KEY) {
      emailError = "RESEND_API_KEY not configured — ticket created but email not sent";
      console.warn(emailError);
    } else {
      const jobId = await enqueueJob(admin, {
        jobType: "send_email",
        payload: emailPayload,
        tenantId: profile.tenant_id,
        createdBy: user.id,
      });

      if (jobId) {
        emailQueued = true;
        // Fire-and-forget worker kick — never block or throw.
        try {
          fetch(`${supabaseUrl}/functions/v1/background-job-worker`, {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
            body: "{}",
          }).catch(() => {});
        } catch { /* ignore */ }
      } else {
        // Fallback: direct POST to Resend, same as before.
        try {
          const resendRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: emailPayload.from,
              to: [emailPayload.to],
              reply_to: emailPayload.replyTo,
              subject: emailPayload.subject,
              html: emailPayload.html,
            }),
          });
          if (resendRes.ok) {
            emailSent = true;
          } else {
            emailError = `Resend ${resendRes.status}: ${await resendRes.text()}`;
            console.error(emailError);
          }
        } catch (e) {
          emailError = (e as Error).message;
          console.error("Resend fallback send failed:", emailError);
        }
      }
    }


    // Audit
    await admin.from("audit_events").insert({
      tenant_id: profile.tenant_id,
      event_type: "support.email_ticket_created",
      actor_id: user.id,
      resource_type: "support_ticket",
      resource_id: ticketId,
      payload: { subject, priority: pr, email_sent: emailSent, email_queued: emailQueued, email_error: emailError, contact_email },
    });

    return json({
      success: true,
      ticket_id: ticketId,
      ticket_number: ticketShort,
      email_sent: emailSent,
      email_queued: emailQueued,
      email_error: emailError,
    });
  } catch (e) {
    console.error("send-support-email error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
