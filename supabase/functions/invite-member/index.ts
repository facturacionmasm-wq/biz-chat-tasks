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

    // Verify caller is super_admin or owner (fetch ALL rows to handle multi-role users)
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerRoles } = await adminClient
      .from("user_roles")
      .select("role, tenant_id")
      .eq("user_id", caller.id);

    const allowed = (callerRoles || []).filter((r: any) =>
      ["super_admin", "owner"].includes(r.role)
    );

    if (allowed.length === 0) {
      return new Response(
        JSON.stringify({ error: "Solo el super admin u owner puede invitar miembros" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload = await req.json();
    const { email, name, password, availability, department, target_tenant_id } = payload;
    if (!email || !name) {
      return new Response(
        JSON.stringify({ error: "Email y nombre son requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve target tenant with same priority logic as team-management
    const isSuper = allowed.some((r: any) => r.role === "super_admin");
    const ownerRow = allowed.find((r: any) => r.role === "owner" && r.tenant_id);
    const targetTenantId: string | undefined =
      (isSuper && target_tenant_id) ||
      ownerRow?.tenant_id ||
      allowed.find((r: any) => r.tenant_id)?.tenant_id;

    if (!targetTenantId) {
      return new Response(
        JSON.stringify({ error: "No se pudo resolver el tenant destino" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let newUserId: string;

    if (password && password.length >= 6) {
      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, invited_to_tenant: targetTenantId },
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
        data: { name, invited_to_tenant: targetTenantId },
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
    if (autoTenantId && autoTenantId !== targetTenantId) {
      await adminClient.from("user_roles").delete().eq("user_id", newUserId).eq("tenant_id", autoTenantId);
    }

    // 3. Update profile to the correct tenant with pending_approval status
    await adminClient
      .from("profiles")
      .update({
        tenant_id: targetTenantId,
        name,
        department: department ?? null,
        status: 'pending_approval',
        onboarding_completed: true, // Skip onboarding for invited users
      })
      .eq("user_id", newUserId);

    // 4. Create role in the correct tenant
    await adminClient.from("user_roles").upsert({
      user_id: newUserId,
      tenant_id: targetTenantId,
      role: 'staff',
    }, { onConflict: 'user_id,tenant_id,role' });

    // 5. Delete the auto-created empty tenant (if different)
    if (autoTenantId && autoTenantId !== targetTenantId) {
      await adminClient.from("tenants").delete().eq("id", autoTenantId);
    }

    // Create availability rules if provided
    if (availability && Array.isArray(availability) && availability.length > 0) {
      const rules = availability.map((rule: AvailabilityRule) => ({
        tenant_id: targetTenantId,
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

    // Fire-and-forget: sync staff directory into ElevenLabs agent (non-blocking)
    try {
      fetch(`${supabaseUrl}/functions/v1/elevenlabs-staff-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ tenant_id: targetTenantId }),
      }).catch((e) => console.error("[invite-member] elevenlabs-staff-sync fire error:", e?.message));
    } catch (e) {
      console.error("[invite-member] elevenlabs-staff-sync trigger failed:", (e as Error).message);
    }

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
