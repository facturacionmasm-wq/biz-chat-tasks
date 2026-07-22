import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { getCfdiAdapter } from '../_shared/cfdi-providers.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims } = await supabase.auth.getClaims(authHeader.replace('Bearer ', ''));
    if (!claims?.claims) return json({ error: 'Unauthorized' }, 401);
    const userId = claims.claims.sub as string;

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: prof } = await admin.from('profiles').select('tenant_id').eq('user_id', userId).maybeSingle();
    const tenantId = prof?.tenant_id as string | undefined;
    if (!tenantId) return json({ error: 'no_tenant' }, 403);

    const body = (await req.json().catch(() => ({}))) as {
      cfdi_document_id?: string;
      motivo?: string;
      folio_sustitucion?: string | null;
      provider?: string;
    };
    if (!body.cfdi_document_id) return json({ error: 'cfdi_document_id required' }, 400);
    if (!body.motivo) return json({ error: 'motivo required (01,02,03,04)' }, 400);

    const { data: doc } = await admin
      .from('cfdi_documents')
      .select('*')
      .eq('id', body.cfdi_document_id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!doc) return json({ error: 'cfdi_not_found' }, 404);
    if (doc.estado !== 'timbrado' || !doc.uuid_fiscal) {
      return json({ error: 'cfdi_not_stamped' }, 409);
    }

    const providerId = body.provider ?? doc.provider ?? 'facturama';
    const adapter = getCfdiAdapter(providerId);
    const cfg = adapter.isConfigured();
    if (!cfg.configured) {
      return json({ ok: false, configured: false, missing_secrets: cfg.missing });
    }

    const result = await adapter.cancel({
      uuid: doc.uuid_fiscal,
      motivo: body.motivo,
      folio_sustitucion: body.folio_sustitucion ?? null,
    });
    if (!result.ok) return json({ ok: false, error: result.error });

    await admin.from('cfdi_documents').update({ estado: 'cancelado' }).eq('id', doc.id);
    await admin.from('audit_events').insert({
      tenant_id: tenantId,
      event_type: 'cfdi_cancelled',
      actor_id: userId,
      resource_type: 'cfdi_documents',
      resource_id: doc.id,
      payload: { uuid: doc.uuid_fiscal, motivo: body.motivo },
    });

    return json({ ok: true });
  } catch (e) {
    console.error('[cfdi-cancel]', e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
