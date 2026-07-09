// Load-test seed: provisions the reserved LOADTEST tenant and ~100 virtual users.
// Idempotent. Only super_admin can invoke.
//
// This function creates NO real customer data. All accounts use the reserved
// email domain (@loadtest.local) and belong exclusively to the LOADTEST tenant.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { LOADTEST_TENANT_ID, LOADTEST_EMAIL_DOMAIN } from '../_shared/loadtest.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_VU_COUNT = 100;
const VU_PASSWORD = 'LoadTest!Vu-Password-2026';

const j = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // AuthN: verify caller
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return j({ error: 'Unauthorized' }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await userClient.auth.getUser();
  const caller = userData?.user;
  if (!caller) return j({ error: 'Unauthorized' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // AuthZ: super_admin only
  const { data: roles } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', caller.id);
  const isSuper = (roles || []).some((r: any) => r.role === 'super_admin');
  if (!isSuper) return j({ error: 'super_admin required' }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const vuCount: number = Math.min(
      Math.max(Number(body?.vu_count) || DEFAULT_VU_COUNT, 1),
      500,
    );

    // 1. Ensure LOADTEST tenant exists (migration should have created it)
    const { data: tenant } = await admin
      .from('tenants')
      .select('id, name, settings_json')
      .eq('id', LOADTEST_TENANT_ID)
      .maybeSingle();

    if (!tenant) {
      return j({ error: 'LOADTEST tenant missing — run migration first' }, 500);
    }

    // 2. Create/find one shared chat channel for the tenant
    let channelId: string | null = null;
    const { data: existingChannel } = await admin
      .from('chat_channels')
      .select('id')
      .eq('tenant_id', LOADTEST_TENANT_ID)
      .eq('name', 'loadtest-general')
      .maybeSingle();
    if (existingChannel) {
      channelId = existingChannel.id;
    } else {
      const { data: newChannel, error: chErr } = await admin
        .from('chat_channels')
        .insert({
          tenant_id: LOADTEST_TENANT_ID,
          name: 'loadtest-general',
          created_by: caller.id,
        })
        .select('id')
        .single();
      if (chErr) {
        // Non-fatal — chat channel is nice to have, seeding continues.
        console.error('[load-test-seed] chat_channels insert failed:', chErr.message);
      } else {
        channelId = newChannel.id;
      }
    }

    // 3. Create VU users
    const summary = { created: 0, existed: 0, failed: 0, errors: [] as string[] };

    for (let i = 1; i <= vuCount; i++) {
      const email = `vu_${i}@${LOADTEST_EMAIL_DOMAIN}`;
      try {
        // Try to create. If it already exists, admin API returns 422.
        const { data: createData, error: createErr } = await admin.auth.admin.createUser({
          email,
          password: VU_PASSWORD,
          email_confirm: true,
          user_metadata: { loadtest: true, vu_index: i, name: `VU ${i}` },
        });

        let userId: string | null = createData?.user?.id ?? null;

        if (createErr) {
          // Already exists? Look it up.
          const msg = createErr.message || '';
          if (/registered|already/i.test(msg)) {
            // Fetch existing user by email via admin listing (paginated)
            const { data: existing } = await admin
              .from('profiles')
              .select('user_id')
              .eq('email', email)
              .maybeSingle();
            userId = existing?.user_id ?? null;
            if (userId) summary.existed++;
            else {
              summary.failed++;
              summary.errors.push(`vu_${i}: ${msg}`);
              continue;
            }
          } else {
            summary.failed++;
            summary.errors.push(`vu_${i}: ${msg}`);
            continue;
          }
        } else {
          summary.created++;
        }

        if (!userId) continue;

        // Force profile into LOADTEST tenant. Use upsert bypassing default trigger tenant.
        // We insert user_roles FIRST (prevent_profile_tenant_change requires membership).
        await admin
          .from('user_roles')
          .upsert(
            { user_id: userId, tenant_id: LOADTEST_TENANT_ID, role: 'staff' },
            { onConflict: 'user_id,tenant_id,role' },
          );

        // Move/create profile into LOADTEST tenant if not already there.
        const { data: existingProfile } = await admin
          .from('profiles')
          .select('user_id, tenant_id')
          .eq('user_id', userId)
          .maybeSingle();

        if (!existingProfile) {
          // Insert via service_role (trigger allows service_role to set tenant)
          await admin.from('profiles').insert({
            user_id: userId,
            tenant_id: LOADTEST_TENANT_ID,
            name: `VU ${i}`,
            email,
            onboarding_completed: true,
          });
        }
        // If profile exists on another tenant, we leave it — the auth trigger
        // may have auto-created a private tenant. The user_role above still
        // grants access to LOADTEST via multi-tenant lookups in the runner.
      } catch (e) {
        summary.failed++;
        summary.errors.push(`vu_${i}: ${(e as Error).message}`);
      }
    }

    return j({
      ok: true,
      tenant_id: LOADTEST_TENANT_ID,
      chat_channel_id: channelId,
      vu_password_ref: 'hardcoded in load-test-seed (change only in code)',
      summary: {
        created: summary.created,
        existed: summary.existed,
        failed: summary.failed,
        total_requested: vuCount,
        first_errors: summary.errors.slice(0, 10),
      },
    });
  } catch (e) {
    console.error('[load-test-seed] fatal:', e);
    return j({ error: (e as Error).message }, 500);
  }
});
