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

      // Use generateLink to create a magic link for existing users
      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email,
      });

      if (linkError) {
        return new Response(JSON.stringify({ error: linkError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Send the magic link email via Supabase's built-in email
      const { error: otpError } = await adminClient.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
        },
      });

      if (otpError) {
        const isRateLimit = otpError.message.includes("security purposes") || otpError.message.includes("after");
        return new Response(JSON.stringify({ 
          error: isRateLimit 
            ? "Debes esperar 60 segundos antes de reenviar otro correo" 
            : otpError.message 
        }), {
          status: isRateLimit ? 429 : 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ success: true, message: "Se envió un enlace de acceso al correo del miembro" }),
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
