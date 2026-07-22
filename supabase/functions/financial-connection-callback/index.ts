import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { getAdapter, encryptSecret } from '../_shared/finance-providers.ts';

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

    const body = (await req.json().catch(() => ({}))) as { provider?: string; payload?: Record<string, unknown> };
    const provider = body.provider;
    const payload = body.payload ?? {};
    if (!provider) {
      return new Response(JSON.stringify({ error: 'provider required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: prof } = await admin.from('profiles').select('tenant_id').eq('user_id', userId).maybeSingle();
    const tenantId = prof?.tenant_id as string | undefined;
    if (!tenantId) {
      return new Response(JSON.stringify({ error: 'no_tenant' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const adapter = getAdapter(provider);
    const result = await adapter.exchange({ provider: adapter.id, tenantId, userId, payload });
    const encryptedToken = await encryptSecret(result.accessTokenPlaintext);

    // Upsert on (provider, external_item_id) to avoid duplicate links.
    const { data: existing } = await admin
      .from('financial_connections')
      .select('id')
      .eq('provider', provider)
      .eq('external_item_id', result.externalItemId)
      .maybeSingle();

    let connectionId: string;
    if (existing?.id) {
      const { error } = await admin
        .from('financial_connections')
        .update({
          tenant_id: tenantId,
          institution: result.institution ?? null,
          status: 'connected',
          credentials_encrypted: encryptedToken,
          metadata: result.metadata ?? {},
          last_sync_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', existing.id);
      if (error) throw error;
      connectionId = existing.id;
    } else {
      const { data: ins, error } = await admin
        .from('financial_connections')
        .insert({
          tenant_id: tenantId,
          provider,
          external_item_id: result.externalItemId,
          institution: result.institution ?? null,
          status: 'connected',
          credentials_encrypted: encryptedToken,
          metadata: result.metadata ?? {},
          created_by: userId,
          last_sync_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (error) throw error;
      connectionId = ins.id;
    }

    await admin.from('audit_events').insert({
      tenant_id: tenantId,
      event_type: 'finance_connection_connect',
      actor_id: userId,
      resource_type: 'financial_connections',
      resource_id: connectionId,
      payload: { provider, external_item_id: result.externalItemId, institution: result.institution ?? null },
    });

    // Never expose the token or the encrypted blob to the client.
    return new Response(JSON.stringify({
      ok: true,
      connection_id: connectionId,
      provider,
      institution: result.institution ?? null,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[financial-connection-callback]', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
