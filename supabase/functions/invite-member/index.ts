import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface AvailabilityRule {
  day_of_week: number;
  start_time: string;
  end_time: string;
  active: boolean;
  buffer_before?: number;
  buffer_after?: number;
  max_appointments?: number;
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

    // Verify caller
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

    // Verify caller is super_admin or owner
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerRole } = await adminClient
      .from("user_roles")
      .select("role, tenant_id")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (!callerRole || !["super_admin", "owner"].includes(callerRole.role)) {
      return new Response(
        JSON.stringify({ error: "Solo el super admin u owner puede invitar miembros" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email, name, password, availability } = await req.json();
    if (!email || !name) {
      return new Response(
        JSON.stringify({ error: "Email y nombre son requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let newUserId: string;

    if (password && password.length >= 6) {
      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, invited_to_tenant: callerRole.tenant_id },
      });
      if (createError) {
        return new Response(JSON.stringify({ error: createError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      newUserId = newUser.user.id;
    } else {
      const { data: newUser, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
        data: { name, invited_to_tenant: callerRole.tenant_id },
      });
      if (inviteError) {
        return new Response(JSON.stringify({ error: inviteError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      newUserId = newUser.user.id;
    }

    // The handle_new_user trigger creates a new tenant + profile + role for this user.
    // We need to fix this: move the user to the inviter's tenant with pending_approval status.

    // 1. Get the auto-created tenant (to delete later)
    const { data: autoProfile } = await adminClient
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", newUserId)
      .maybeSingle();

    const autoTenantId = autoProfile?.tenant_id;

    // 2. Delete the auto-created role in the wrong tenant
    if (autoTenantId && autoTenantId !== callerRole.tenant_id) {
      await adminClient.from("user_roles").delete().eq("user_id", newUserId).eq("tenant_id", autoTenantId);
    }

    // 3. Update profile to the correct tenant with pending_approval status
    await adminClient
      .from("profiles")
      .update({
        tenant_id: callerRole.tenant_id,
        name,
        status: 'pending_approval',
        onboarding_completed: true, // Skip onboarding for invited users
      })
      .eq("user_id", newUserId);

    // 4. Create role in the correct tenant
    await adminClient.from("user_roles").upsert({
      user_id: newUserId,
      tenant_id: callerRole.tenant_id,
      role: 'staff',
    }, { onConflict: 'user_id,tenant_id,role' });

    // 5. Delete the auto-created empty tenant (if different)
    if (autoTenantId && autoTenantId !== callerRole.tenant_id) {
      await adminClient.from("tenants").delete().eq("id", autoTenantId);
    }

    // Create availability rules if provided
    if (availability && Array.isArray(availability) && availability.length > 0) {
      const rules = availability.map((rule: AvailabilityRule) => ({
        tenant_id: callerRole.tenant_id,
        user_id: newUserId,
        day_of_week: rule.day_of_week,
        start_time: rule.start_time,
        end_time: rule.end_time,
        active: rule.active ?? true,
        buffer_before: rule.buffer_before ?? 10,
        buffer_after: rule.buffer_after ?? 10,
        max_appointments: rule.max_appointments ?? 8,
      }));

      const { error: rulesError } = await adminClient
        .from("availability_rules")
        .insert(rules);

      if (rulesError) {
        console.error("Error creating availability rules:", rulesError);
      }
    }

    const method = password && password.length >= 6 ? "contraseña temporal" : "email de invitación";

    return new Response(
      JSON.stringify({
        success: true,
        user_id: newUserId,
        method,
        message: `Miembro ${name} invitado. Pendiente de aprobación.`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
