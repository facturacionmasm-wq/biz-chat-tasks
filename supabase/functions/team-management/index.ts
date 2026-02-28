import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

    // Verify caller is super_admin or owner
    const { data: callerRole } = await adminClient
      .from("user_roles")
      .select("role, tenant_id")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (!callerRole || !["super_admin", "owner"].includes(callerRole.role)) {
      return new Response(
        JSON.stringify({ error: "No autorizado" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { action, user_id, email, name } = await req.json();

    if (action === "list_status") {
      // Get all users in tenant
      const { data: profiles } = await adminClient
        .from("profiles")
        .select("user_id")
        .eq("tenant_id", callerRole.tenant_id);

      const statuses: Record<string, { confirmed: boolean; last_sign_in: string | null }> = {};

      for (const p of profiles || []) {
        const { data: { user: u } } = await adminClient.auth.admin.getUserById(p.user_id);
        if (u) {
          statuses[p.user_id] = {
            confirmed: !!u.last_sign_in_at,
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

      // Delete and recreate to resend invite
      const { data: { user: existingUser } } = await adminClient.auth.admin.getUserById(user_id);
      if (!existingUser) {
        return new Response(JSON.stringify({ error: "Usuario no encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Re-invite: use inviteUserByEmail which handles existing unconfirmed users
      const { error } = await adminClient.auth.admin.inviteUserByEmail(email);

      if (error) {
        // If user already registered and confirmed, just inform
        if (error.message.includes("already been registered")) {
          return new Response(
            JSON.stringify({ success: true, message: "El usuario ya se registró y confirmó su cuenta" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ success: true, message: "Invitación reenviada exitosamente" }),
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
