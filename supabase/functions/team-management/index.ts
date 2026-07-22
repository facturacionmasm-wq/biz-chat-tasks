import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { enqueueJob } from "../_shared/jobs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const APP_NAME = "RYBIX";
const FROM_EMAIL = "RYBIX <soporte@rybixholding.com>";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildInviteEmailPayload({
  to,
  name,
  actionLink,
}: {
  to: string;
  name?: string | null;
  actionLink: string;
}): { to: string; from: string; subject: string; html: string; kind: string } {
  const safeName = escapeHtml(name || "");
  const safeLink = escapeHtml(actionLink);
  const greeting = safeName ? `Hola ${safeName},` : "Hola,";

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;color:#0f172a">
      <h1 style="font-size:22px;line-height:1.25;margin:0 0 16px;color:#0f172a">Tu acceso a ${APP_NAME}</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 14px">${greeting}</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 22px">Te reenviamos tu enlace para entrar a ${APP_NAME}. Este enlace es personal y expira por seguridad.</p>
      <p style="margin:0 0 24px">
        <a href="${safeLink}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700;font-size:14px">Entrar a ${APP_NAME}</a>
      </p>
      <p style="font-size:13px;line-height:1.6;color:#64748b;margin:0 0 8px">Si el botón no abre, copia y pega este enlace en tu navegador:</p>
      <p style="font-size:12px;line-height:1.5;word-break:break-all;color:#334155;margin:0">${safeLink}</p>
    </div>
  `;

  return {
    to,
    from: FROM_EMAIL,
    subject: `Tu acceso a ${APP_NAME}`,
    html,
    kind: "team_invite",
  };
}

async function sendInviteEmailDirect(payload: {
  to: string;
  from: string;
  subject: string;
  html: string;
}): Promise<{ status: number; body: string }> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY no configurado");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: payload.from,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Resend ${response.status}: ${body}`);
  }
  return { status: response.status, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await anonClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify caller is super_admin or owner (a user may have multiple rows in user_roles)
    const { data: callerRoles } = await adminClient
      .from("user_roles")
      .select("role, tenant_id")
      .eq("user_id", caller.id);

    const allowed = (callerRoles || []).filter((r: any) =>
      ["super_admin", "owner"].includes(r.role)
    );
    if (allowed.length === 0) {
      return new Response(
        JSON.stringify({ error: "No autorizado" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // Prefer the owner row (tenant-scoped) over super_admin for tenant filtering
    const callerRole =
      allowed.find((r: any) => r.role === "owner" && r.tenant_id) ||
      allowed.find((r: any) => r.tenant_id) ||
      allowed[0];

    const payload = await req.json();
    const { action, user_id, email, name, password } = payload;

    // Helper to fire elevenlabs sync (non-blocking)
    const triggerElevenLabsSync = () => {
      try {
        fetch(`${supabaseUrl}/functions/v1/elevenlabs-staff-sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ tenant_id: callerRole.tenant_id }),
        }).catch((e) => console.error("[team-management] elevenlabs-staff-sync fire error:", e?.message));
      } catch (e) {
        console.error("[team-management] elevenlabs-staff-sync trigger failed:", (e as Error).message);
      }
    };

    if (action === "list_status") {
      // Get all users in tenant
      const { data: profiles } = await adminClient
        .from("profiles")
        .select("user_id, status")
        .eq("tenant_id", callerRole.tenant_id);

      const statuses: Record<string, { confirmed: boolean; last_sign_in: string | null }> = {};

      for (const p of profiles || []) {
        const { data: { user: u } } = await adminClient.auth.admin.getUserById(p.user_id);
        if (u) {
          const emailConfirmed = !!((u as any).email_confirmed_at || (u as any).confirmed_at);
          statuses[p.user_id] = {
            confirmed: emailConfirmed || !!u.last_sign_in_at || p.status === "active",
            last_sign_in: u.last_sign_in_at || null,
          };
        }
      }

      return new Response(JSON.stringify({ statuses }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "resend_invite") {
      if (!email || !user_id) {
        return new Response(JSON.stringify({ error: "Email y user_id requeridos" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existing } = await adminClient.auth.admin.getUserById(user_id);
      const existingUser = existing?.user;
      if (!existingUser) {
        return new Response(JSON.stringify({ error: "Usuario no encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: memberProfile, error: profileError } = await adminClient
        .from("profiles")
        .select("tenant_id, name, email")
        .eq("user_id", user_id)
        .eq("email", email)
        .maybeSingle();

      if (profileError) {
        console.error(`[team-management] resend_invite profile lookup failed user=${user_id} email=${email}: ${profileError.message}`);
        return json({ error: profileError.message }, 400);
      }
      if (!memberProfile) {
        return json({ error: "Perfil del miembro no encontrado" }, 404);
      }

      const isSuperAdmin = allowed.some((r: any) => r.role === "super_admin");
      if (!isSuperAdmin && memberProfile.tenant_id !== callerRole.tenant_id) {
        console.error(`[team-management] resend_invite forbidden caller=${caller.id} target=${user_id} target_tenant=${memberProfile.tenant_id}`);
        return json({ error: "No autorizado" }, 403);
      }

      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email,
      });

      if (linkError) {
        const status = (linkError as any).status || 400;
        const msg = linkError.message || "No se pudo generar el enlace de acceso";
        console.error(`[team-management] resend_invite generate_link failed user=${user_id} email=${email} status=${status}: ${msg}`);
        return json({ error: msg }, status);
      }

      const actionLink =
        (linkData?.properties as any)?.action_link ||
        (linkData?.properties as any)?.email_otp ||
        (linkData as any)?.action_link ||
        (linkData as any)?.url;

      if (!actionLink || typeof actionLink !== "string" || !actionLink.startsWith("http")) {
        console.error(`[team-management] resend_invite missing action_link user=${user_id} email=${email}`);
        return json({ error: "No se pudo generar el enlace de acceso" }, 500);
      }

      const emailPayload = buildInviteEmailPayload({
        to: email,
        name: memberProfile.name || existingUser.user_metadata?.name || null,
        actionLink,
      });

      const jobId = await enqueueJob(adminClient, {
        jobType: "send_email",
        payload: emailPayload,
        tenantId: memberProfile.tenant_id,
        createdBy: caller.id,
      });

      let queued = false;
      if (jobId) {
        queued = true;
        // Fire-and-forget worker kick.
        try {
          fetch(`${supabaseUrl}/functions/v1/background-job-worker`, {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
            body: "{}",
          }).catch(() => {});
        } catch { /* ignore */ }
        console.log(`[team-management] resend_invite queued user=${user_id} email=${email} tenant=${memberProfile.tenant_id} job=${jobId}`);
      } else {
        // Fallback: direct send preserving previous behavior.
        try {
          const sendResult = await sendInviteEmailDirect(emailPayload);
          console.log(`[team-management] resend_invite direct_send_fallback ok user=${user_id} email=${email} tenant=${memberProfile.tenant_id} resend_status=${sendResult.status}`);
        } catch (sendError) {
          const msg = sendError instanceof Error ? sendError.message : "No se pudo enviar el correo";
          console.error(`[team-management] resend_invite email_send failed user=${user_id} email=${email}: ${msg}`);
          return json({ error: msg }, 502);
        }
      }

      return new Response(
        JSON.stringify({ success: true, queued, message: "Invitación reenviada al correo del miembro" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "reset_password") {
      if (!user_id || !password) {
        return new Response(JSON.stringify({ error: "user_id y password requeridos" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Cross-tenant guard: verify the target user belongs to the caller's tenant,
      // unless the caller is a super_admin (which can reset across tenants).
      const isSuperAdmin = allowed.some((r: any) => r.role === "super_admin");
      if (!isSuperAdmin) {
        const { data: targetProfile, error: targetErr } = await adminClient
          .from("profiles")
          .select("tenant_id")
          .eq("user_id", user_id)
          .maybeSingle();
        if (targetErr) {
          return json({ error: targetErr.message }, 400);
        }
        if (!targetProfile || targetProfile.tenant_id !== callerRole.tenant_id) {
          console.error(`[team-management] reset_password forbidden caller=${caller.id} target=${user_id} target_tenant=${targetProfile?.tenant_id}`);
          return json({ error: "No autorizado" }, 403);
        }
      }

      const { error: updateError } = await adminClient.auth.admin.updateUserById(user_id, { password });

      if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ success: true, message: "Contraseña actualizada" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "update_member") {
      if (!user_id) {
        return new Response(JSON.stringify({ error: "user_id requerido" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const patch: Record<string, unknown> = {};
      if (typeof payload.name === "string") patch.name = payload.name;
      if (typeof payload.department === "string" || payload.department === null) patch.department = payload.department;
      if (typeof payload.phone === "string" || payload.phone === null) patch.phone = payload.phone;
      if (typeof payload.whatsapp_number === "string" || payload.whatsapp_number === null) patch.whatsapp_number = payload.whatsapp_number;
      if (typeof payload.status === "string") patch.status = payload.status;

      if (Object.keys(patch).length === 0) {
        return new Response(JSON.stringify({ error: "Nada que actualizar" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: upErr } = await adminClient
        .from("profiles")
        .update(patch)
        .eq("user_id", user_id)
        .eq("tenant_id", callerRole.tenant_id);
      if (upErr) {
        return new Response(JSON.stringify({ error: upErr.message }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Trigger ElevenLabs sync if anything relevant to the agent changed
      if ("department" in patch || "phone" in patch || "whatsapp_number" in patch || "name" in patch || "status" in patch) {
        triggerElevenLabsSync();
      }

      return new Response(
        JSON.stringify({ success: true, message: "Miembro actualizado" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "remove_member") {
      if (!user_id) {
        return new Response(JSON.stringify({ error: "user_id requerido" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await adminClient.from("user_roles").delete().eq("user_id", user_id).eq("tenant_id", callerRole.tenant_id);
      await adminClient.from("profiles").delete().eq("user_id", user_id).eq("tenant_id", callerRole.tenant_id);
      triggerElevenLabsSync();
      return new Response(
        JSON.stringify({ success: true, message: "Miembro eliminado" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "trigger_agent_sync") {
      triggerElevenLabsSync();
      return new Response(
        JSON.stringify({ success: true, message: "Sync disparado" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Acción no válida" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
