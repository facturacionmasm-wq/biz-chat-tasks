import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { getAdapter, decryptSecret } from '../_shared/finance-providers.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(authHeader.replace('Bearer ', ''));
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userId = claimsData.claims.sub as string;

    const { connection_id } = (await req.json().catch(() => ({}))) as { connection_id?: string };
    if (!connection_id) {
      return new Response(JSON.stringify({ error: 'connection_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: prof } = await admin.from('profiles').select('tenant_id').eq('user_id', userId).maybeSingle();
    const tenantId = prof?.tenant_id as string | undefined;
    if (!tenantId) {
      return new Response(JSON.stringify({ error: 'no_tenant' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: conn } = await admin
      .from('financial_connections')
      .select('id, tenant_id, provider, external_item_id, credentials_encrypted')
      .eq('id', connection_id)
      .maybeSingle();
    if (!conn || conn.tenant_id !== tenantId) {
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    try {
      const adapter = getAdapter(conn.provider);
      const accessToken = conn.credentials_encrypted ? await decryptSecret(conn.credentials_encrypted) : '';
      await adapter.disconnect({ accessToken, externalItemId: conn.external_item_id });
    } catch (e) {
      console.error('[disconnect] provider revoke failed (continuing):', (e as Error).message);
    }

    await admin.from('financial_connections')
      .update({ status: 'disconnected', credentials_encrypted: null, last_error: null })
      .eq('id', connection_id);
    await admin.from('financial_accounts')
      .update({ status: 'disconnected' })
      .eq('connection_id', connection_id);

    await admin.from('audit_events').insert({
      tenant_id: tenantId,
      event_type: 'finance_connection_disconnect',
      actor_id: userId,
      resource_type: 'financial_connections',
      resource_id: connection_id,
      payload: { provider: conn.provider },
    });

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[financial-connection-disconnect]', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
