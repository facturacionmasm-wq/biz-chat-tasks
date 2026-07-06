import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SLA_MINUTES: Record<string, { first: number; resolve: number }> = {
  urgent: { first: 15, resolve: 60 },
  high: { first: 60, resolve: 240 },
  normal: { first: 240, resolve: 1440 },
  low: { first: 1440, resolve: 4320 },
};

function computeSla(priority: string) {
  const cfg = SLA_MINUTES[priority] ?? SLA_MINUTES.normal;
  const now = Date.now();
  return {
    sla_first_response_at: new Date(now + cfg.first * 60_000).toISOString(),
    sla_resolution_at: new Date(now + cfg.resolve * 60_000).toISOString(),
  };
}

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
      .select("tenant_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!profile?.tenant_id) return json({ error: "No tenant" }, 403);
    const tenantId = profile.tenant_id;

    const { data: superRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "super_admin")
      .maybeSingle();
    const isSuperAdmin = !!superRow;

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    // ============ SUPER ADMIN ACTIONS (cross-tenant) ============
    if (action === "admin_list") {
      if (!isSuperAdmin) return json({ error: "Forbidden" }, 403);
      const { data, error } = await admin
        .from("support_tickets")
        .select("*, contacts:contact_id(id, name, phone, is_vip, vip_tier), tenants:tenant_id(id, name)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const tickets = data ?? [];
      // Enrich with author (created_by -> profiles). Join isn't a real FK, so resolve manually.
      const creatorIds = Array.from(
        new Set(tickets.map((t: any) => t.created_by).filter(Boolean))
      );
      let creatorMap: Record<string, { name: string | null; email: string | null }> = {};
      if (creatorIds.length > 0) {
        const { data: profs } = await admin
          .from("profiles")
          .select("user_id, name, email")
          .in("user_id", creatorIds);
        creatorMap = Object.fromEntries(
          (profs ?? []).map((p: any) => [p.user_id, { name: p.name, email: p.email }])
        );
      }
      const enriched = tickets.map((t: any) => ({
        ...t,
        creator: t.created_by ? (creatorMap[t.created_by] ?? null) : null,
      }));
      return json({ tickets: enriched });
    }

    if (action === "admin_get") {
      if (!isSuperAdmin) return json({ error: "Forbidden" }, 403);
      const ticketId = body.ticket_id;
      const [ticket, messages, events] = await Promise.all([
        admin.from("support_tickets").select("*, contacts:contact_id(id, name, phone, is_vip, vip_tier, vip_notes), tenants:tenant_id(id, name)").eq("id", ticketId).maybeSingle(),
        admin.from("ticket_messages").select("*").eq("ticket_id", ticketId).order("created_at", { ascending: true }),
        admin.from("ticket_events").select("*").eq("ticket_id", ticketId).order("created_at", { ascending: true }),
      ]);
      if (ticket.error) throw ticket.error;
      let creator: { name: string | null; email: string | null } | null = null;
      if (ticket.data?.created_by) {
        const { data: prof } = await admin
          .from("profiles")
          .select("name, email")
          .eq("user_id", ticket.data.created_by)
          .maybeSingle();
        if (prof) creator = { name: prof.name, email: prof.email };
      }
      return json({
        ticket: ticket.data ? { ...ticket.data, creator } : null,
        messages: messages.data ?? [],
        events: events.data ?? [],
      });
    }

    if (action === "admin_add_message") {
      if (!isSuperAdmin) return json({ error: "Forbidden" }, 403);
      const { data: t } = await admin.from("support_tickets").select("tenant_id").eq("id", body.ticket_id).maybeSingle();
      if (!t) return json({ error: "Ticket not found" }, 404);
      const { data, error } = await admin
        .from("ticket_messages")
        .insert({
          ticket_id: body.ticket_id,
          tenant_id: t.tenant_id,
          author_type: "super_admin",
          author_id: user.id,
          body: body.body,
          is_internal_note: !!body.is_internal_note,
          attachments: body.attachments ?? [],
        })
        .select()
        .single();
      if (error) throw error;
      if (!body.is_internal_note) {
        await admin
          .from("support_tickets")
          .update({ first_response_at: new Date().toISOString(), status: "in_progress" })
          .eq("id", body.ticket_id)
          .is("first_response_at", null);
      }
      await admin.from("ticket_events").insert({
        ticket_id: body.ticket_id, tenant_id: t.tenant_id, actor_id: user.id,
        event_type: "super_admin_reply", payload: { internal: !!body.is_internal_note },
      });
      return json({ message: data });
    }

    if (action === "admin_update") {
      if (!isSuperAdmin) return json({ error: "Forbidden" }, 403);
      const patch: Record<string, unknown> = {};
      const allowed = ["priority", "status", "assigned_to", "subject", "description", "tags"];
      for (const k of allowed) if (k in body) patch[k] = body[k];
      if (body.priority) Object.assign(patch, computeSla(body.priority));
      if (body.status === "resolved") patch.resolved_at = new Date().toISOString();
      if (body.status === "closed") patch.closed_at = new Date().toISOString();
      const { data: t } = await admin.from("support_tickets").select("tenant_id").eq("id", body.ticket_id).maybeSingle();
      if (!t) return json({ error: "Ticket not found" }, 404);
      const { data, error } = await admin
        .from("support_tickets")
        .update(patch)
        .eq("id", body.ticket_id)
        .select()
        .single();
      if (error) throw error;
      await admin.from("ticket_events").insert({
        ticket_id: body.ticket_id, tenant_id: t.tenant_id, actor_id: user.id,
        event_type: "super_admin_update", payload: patch,
      });
      return json({ ticket: data });
    }



    if (action === "list") {
      const { data, error } = await admin
        .from("support_tickets")
        .select("*, contacts:contact_id(id, name, phone, is_vip, vip_tier)")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return json({ tickets: data ?? [] });
    }

    if (action === "get") {
      const ticketId = body.ticket_id;
      const [ticket, messages, events] = await Promise.all([
        admin.from("support_tickets").select("*, contacts:contact_id(id, name, phone, is_vip, vip_tier, vip_notes)").eq("id", ticketId).eq("tenant_id", tenantId).maybeSingle(),
        admin.from("ticket_messages").select("*").eq("ticket_id", ticketId).eq("tenant_id", tenantId).order("created_at", { ascending: true }),
        admin.from("ticket_events").select("*").eq("ticket_id", ticketId).eq("tenant_id", tenantId).order("created_at", { ascending: true }),
      ]);
      if (ticket.error) throw ticket.error;
      return json({ ticket: ticket.data, messages: messages.data ?? [], events: events.data ?? [] });
    }

    if (action === "create") {
      const priority = body.priority || "normal";
      const sla = computeSla(priority);
      const { data, error } = await admin
        .from("support_tickets")
        .insert({
          tenant_id: tenantId,
          contact_id: body.contact_id ?? null,
          channel: body.channel || "manual",
          subject: body.subject || "Sin asunto",
          description: body.description ?? null,
          priority,
          status: "open",
          created_by: user.id,
          tags: body.tags ?? [],
          ai_summary: body.ai_summary ?? null,
          ...sla,
        })
        .select()
        .single();
      if (error) throw error;
      await admin.from("ticket_events").insert({
        ticket_id: data.id, tenant_id: tenantId, actor_id: user.id,
        event_type: "created", payload: { priority, channel: data.channel },
      });
      return json({ ticket: data });
    }

    if (action === "add_message") {
      const { data, error } = await admin
        .from("ticket_messages")
        .insert({
          ticket_id: body.ticket_id,
          tenant_id: tenantId,
          author_type: "agent",
          author_id: user.id,
          body: body.body,
          is_internal_note: !!body.is_internal_note,
          attachments: body.attachments ?? [],
        })
        .select()
        .single();
      if (error) throw error;

      // Mark first response if not internal
      if (!body.is_internal_note) {
        await admin
          .from("support_tickets")
          .update({ first_response_at: new Date().toISOString(), status: "in_progress" })
          .eq("id", body.ticket_id)
          .eq("tenant_id", tenantId)
          .is("first_response_at", null);
      }
      return json({ message: data });
    }

    if (action === "update") {
      const patch: Record<string, unknown> = {};
      const allowed = ["priority", "status", "assigned_to", "subject", "description", "tags"];
      for (const k of allowed) if (k in body) patch[k] = body[k];

      if (body.priority) {
        const sla = computeSla(body.priority);
        Object.assign(patch, sla);
      }
      if (body.status === "resolved") patch.resolved_at = new Date().toISOString();
      if (body.status === "closed") patch.closed_at = new Date().toISOString();

      const { data, error } = await admin
        .from("support_tickets")
        .update(patch)
        .eq("id", body.ticket_id)
        .eq("tenant_id", tenantId)
        .select()
        .single();
      if (error) throw error;
      await admin.from("ticket_events").insert({
        ticket_id: body.ticket_id, tenant_id: tenantId, actor_id: user.id,
        event_type: "updated", payload: patch,
      });
      return json({ ticket: data });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("support-ticket-manager error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
