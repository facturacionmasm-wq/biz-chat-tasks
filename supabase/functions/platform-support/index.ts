import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { data: roles } = await admin.from("user_roles").select("role,tenant_id").eq("user_id", user.id);
    const isSuperAdmin = (roles ?? []).some((r) => r.role === "super_admin");
    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id, name, email")
      .eq("user_id", user.id)
      .maybeSingle();

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    // Ensure tenant has a channel
    async function getOrCreateChannel(tenantId: string) {
      const { data: existing } = await admin
        .from("platform_support_channels")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (existing) return existing;
      const { data, error } = await admin
        .from("platform_support_channels")
        .insert({ tenant_id: tenantId, status: "open", priority: "normal" })
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    if (action === "get_my_channel") {
      // tenant user side
      if (!profile?.tenant_id) return json({ error: "No tenant" }, 403);
      const channel = await getOrCreateChannel(profile.tenant_id);
      const { data: messages } = await admin
        .from("platform_support_messages")
        .select("*")
        .eq("channel_id", channel.id)
        .order("created_at", { ascending: true })
        .limit(500);
      // mark all admin-authored as read by tenant
      await admin
        .from("platform_support_messages")
        .update({ read_by_tenant_at: new Date().toISOString() })
        .eq("channel_id", channel.id)
        .eq("author_role", "super_admin")
        .is("read_by_tenant_at", null);
      await admin
        .from("platform_support_channels")
        .update({ unread_for_tenant: 0 })
        .eq("id", channel.id);
      return json({ channel, messages: messages ?? [] });
    }

    if (action === "list_channels") {
      if (!isSuperAdmin) return json({ error: "Forbidden" }, 403);
      const { data, error } = await admin
        .from("platform_support_channels")
        .select("*, tenants:tenant_id(id, name)")
        .order("last_tenant_message_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return json({ channels: data ?? [] });
    }

    if (action === "get_channel_messages") {
      if (!isSuperAdmin) return json({ error: "Forbidden" }, 403);
      const channelId = body.channel_id;
      const { data: channel } = await admin
        .from("platform_support_channels")
        .select("*, tenants:tenant_id(id, name)")
        .eq("id", channelId)
        .maybeSingle();
      const { data: messages } = await admin
        .from("platform_support_messages")
        .select("*")
        .eq("channel_id", channelId)
        .order("created_at", { ascending: true })
        .limit(500);
      // mark tenant messages as read by admin
      await admin
        .from("platform_support_messages")
        .update({ read_by_admin_at: new Date().toISOString() })
        .eq("channel_id", channelId)
        .eq("author_role", "tenant")
        .is("read_by_admin_at", null);
      await admin
        .from("platform_support_channels")
        .update({ unread_for_admin: 0 })
        .eq("id", channelId);
      return json({ channel, messages: messages ?? [] });
    }

    if (action === "send_message") {
      const authorRole = isSuperAdmin ? "super_admin" : "tenant";
      let tenantId: string | null = null;
      let channelId: string | null = body.channel_id ?? null;
      let consumingConsultId: string | null = null;

      if (authorRole === "tenant") {
        if (!profile?.tenant_id) return json({ error: "No tenant" }, 403);
        tenantId = profile.tenant_id;

        // Check plan: if direct_support not included AND no active paid consult, block.
        const MASTER = '00000000-0000-0000-0000-000000000001';
        if (tenantId !== MASTER) {
          const { data: sub } = await admin
            .from('tenant_subscriptions')
            .select('plan_id')
            .eq('tenant_id', tenantId)
            .maybeSingle();
          let directSupport = false;
          if (sub?.plan_id) {
            const { data: plan } = await admin
              .from('subscription_plans')
              .select('features')
              .eq('id', sub.plan_id)
              .maybeSingle();
            directSupport = Boolean((plan?.features as any)?.direct_support);
          }
          if (!directSupport) {
            // Look for an active paid, unused consult
            const { data: consult } = await admin
              .from('support_consult_purchases')
              .select('id')
              .eq('tenant_id', tenantId)
              .eq('status', 'paid')
              .is('consumed_at', null)
              .order('paid_at', { ascending: true })
              .limit(1)
              .maybeSingle();
            if (!consult) {
              return json({
                error: 'direct_support_not_available',
                message: 'Tu plan no incluye canal directo. Compra una consulta prioritaria ($20 USD).',
              }, 402);
            }
            consumingConsultId = consult.id;
          }
        }

        const channel = await getOrCreateChannel(tenantId);
        channelId = channel.id;
      } else {
        if (!channelId) return json({ error: "channel_id required" }, 400);
        const { data: ch } = await admin
          .from("platform_support_channels")
          .select("tenant_id")
          .eq("id", channelId)
          .maybeSingle();
        if (!ch) return json({ error: "Channel not found" }, 404);
        tenantId = ch.tenant_id;
      }

      const { data: msg, error } = await admin
        .from("platform_support_messages")
        .insert({
          channel_id: channelId,
          tenant_id: tenantId,
          author_id: user.id,
          author_role: authorRole,
          body: body.body,
          attachments: body.attachments ?? [],
        })
        .select()
        .single();
      if (error) throw error;

      const patch: Record<string, unknown> = { status: "open" };
      if (authorRole === "tenant") {
        patch.last_tenant_message_at = new Date().toISOString();
        // increment unread for admin
        const { data: cur } = await admin.from("platform_support_channels").select("unread_for_admin").eq("id", channelId).maybeSingle();
        patch.unread_for_admin = (cur?.unread_for_admin ?? 0) + 1;
      } else {
        patch.last_admin_message_at = new Date().toISOString();
        const { data: cur } = await admin.from("platform_support_channels").select("unread_for_tenant").eq("id", channelId).maybeSingle();
        patch.unread_for_tenant = (cur?.unread_for_tenant ?? 0) + 1;
      }
      await admin.from("platform_support_channels").update(patch).eq("id", channelId);

      // Mark the paid consult as consumed (linked to this channel) if applicable
      if (consumingConsultId) {
        await admin
          .from('support_consult_purchases')
          .update({ status: 'consumed', consumed_at: new Date().toISOString(), channel_id: channelId })
          .eq('id', consumingConsultId);
      }

      return json({ message: msg });
    }

    if (action === "update_channel") {
      if (!isSuperAdmin) return json({ error: "Forbidden" }, 403);
      const patch: Record<string, unknown> = {};
      if (body.status) patch.status = body.status;
      if (body.priority) patch.priority = body.priority;
      const { data, error } = await admin
        .from("platform_support_channels")
        .update(patch)
        .eq("id", body.channel_id)
        .select()
        .single();
      if (error) throw error;
      return json({ channel: data });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("platform-support error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
