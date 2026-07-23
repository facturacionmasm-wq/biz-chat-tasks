import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { resolveTenantFiscal } from '../_shared/cfdi-providers.ts';

// Ping the tenant's configured PAC with its saved credentials.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const anon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims } = await anon.auth.getClaims(authHeader.replace('Bearer ', ''));
    if (!claims?.claims) return json({ error: 'Unauthorized' }, 401);
    const userId = claims.claims.sub as string;

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: prof } = await admin.from('profiles').select('tenant_id').eq('user_id', userId).maybeSingle();
    const tenantId = prof?.tenant_id as string | undefined;
    if (!tenantId) return json({ error: 'no_tenant' }, 403);

    const { data: roles } = await admin
      .from('user_roles').select('role, tenant_id').eq('user_id', userId);
    const allowed = (roles ?? []).some((r: any) =>
      (r.tenant_id === tenantId && (r.role === 'owner' || r.role === 'admin')) ||
      r.role === 'super_admin',
    );
    if (!allowed) return json({ error: 'forbidden' }, 403);

    const resolved = await resolveTenantFiscal(admin, tenantId);
    if (!resolved.ok) {
      await admin.from('tenant_fiscal_profiles').update({
        last_test_at: new Date().toISOString(),
        last_test_status: 'error',
        last_test_error: resolved.message,
      }).eq('tenant_id', tenantId);
      return json({ ok: false, code: resolved.code, error: resolved.message });
    }

    const result = await resolved.adapter.ping(resolved.pac);
    await admin.from('tenant_fiscal_profiles').update({
      last_test_at: new Date().toISOString(),
      last_test_status: result.ok ? 'ok' : 'error',
      last_test_error: result.ok ? null : (result.error ?? 'unknown'),
    }).eq('tenant_id', tenantId);

    return json({ ok: result.ok, error: result.ok ? null : result.error, provider: resolved.adapter.id });
  } catch (e) {
    console.error('[cfdi-fiscal-profile-test]', e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
