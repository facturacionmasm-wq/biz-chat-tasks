// Load-test cleanup: hard-deletes all rows attached to the reserved LOADTEST
// tenant. NEVER touches any other tenant. Requires super_admin + explicit
// confirmation header (x-confirm-cleanup: LOADTEST).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { LOADTEST_TENANT_ID } from '../_shared/loadtest.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-confirm-cleanup',
};

const j = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Order matters: delete children before parents when foreign keys are strict.
const TABLES_IN_ORDER = [
  'appointment_notifications',
  'appointments',
  'whatsapp_messages',
  'whatsapp_conversations',
  'chat_messages',
  'background_jobs',
  'reminders',
  'call_records',
  'audit_events',
];

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // AuthN
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return j({ error: 'Unauthorized' }, 401);

  // Explicit confirmation
  if (req.headers.get('x-confirm-cleanup') !== 'LOADTEST') {
    return j({ error: 'Missing header x-confirm-cleanup: LOADTEST' }, 400);
  }

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

  // Safety: refuse if the target id isn't the reserved constant.
  if (LOADTEST_TENANT_ID === '00000000-0000-0000-0000-000000000001') {
    return j({ error: 'Refusing: tenant id is master' }, 500);
  }

  const report: Record<string, { deleted?: number; error?: string }> = {};
  for (const table of TABLES_IN_ORDER) {
    try {
      const { error, count } = await admin
        .from(table)
        .delete({ count: 'exact' })
        .eq('tenant_id', LOADTEST_TENANT_ID);
      if (error) {
        report[table] = { error: error.message };
      } else {
        report[table] = { deleted: count ?? 0 };
      }
    } catch (e) {
      report[table] = { error: (e as Error).message };
    }
  }

  // Audit the cleanup itself (this row belongs to LOADTEST tenant and would be
  // removed by the next cleanup — that's fine).
  try {
    await admin.from('audit_events').insert({
      tenant_id: LOADTEST_TENANT_ID,
      event_type: 'loadtest.cleanup',
      actor_id: caller.id,
      resource_type: 'load_test',
      resource_id: LOADTEST_TENANT_ID,
      payload: { report },
    });
  } catch { /* ignore */ }

  return j({ ok: true, tenant_id: LOADTEST_TENANT_ID, report });
});
