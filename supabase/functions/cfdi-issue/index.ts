import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { makeAdminClient, resolveTenantFiscal, ensureFacturamaIntegratorCsd } from '../_shared/cfdi-providers.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims } = await anonClient.auth.getClaims(authHeader.replace('Bearer ', ''));
    if (!claims?.claims) return json({ error: 'Unauthorized' }, 401);
    const userId = claims.claims.sub as string;

    const admin = makeAdminClient();
    const { data: prof } = await admin.from('profiles').select('tenant_id').eq('user_id', userId).maybeSingle();
    const tenantId = prof?.tenant_id as string | undefined;
    if (!tenantId) return json({ error: 'no_tenant' }, 403);

    const body = (await req.json().catch(() => ({}))) as { cfdi_document_id?: string };
    if (!body.cfdi_document_id) return json({ error: 'cfdi_document_id required' }, 400);

    // Resolve tenant's fiscal profile (enforces identity + credentials + is_active).
    const resolved = await resolveTenantFiscal(admin, tenantId);
    if (!resolved.ok) {
      return json({ ok: false, code: resolved.code, error: resolved.message, requires_setup: true });
    }
    const { adapter, issuer, pac } = resolved;

    const { data: doc, error: docErr } = await admin
      .from('cfdi_documents')
      .select('*')
      .eq('id', body.cfdi_document_id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (docErr || !doc) return json({ error: 'cfdi_not_found' }, 404);
    if (doc.estado === 'timbrado') return json({ error: 'already_stamped' }, 409);

    // Guardrail: overwrite issuer fields on document to match verified tenant identity.
    if (
      (doc.emisor_rfc && doc.emisor_rfc !== issuer.rfc) ||
      (doc.emisor_razon_social && doc.emisor_razon_social !== issuer.razon_social)
    ) {
      await admin.from('audit_events').insert({
        tenant_id: tenantId,
        event_type: 'cfdi_issuer_overridden',
        actor_id: userId,
        resource_type: 'cfdi_documents',
        resource_id: doc.id,
        payload: { attempted: { rfc: doc.emisor_rfc, name: doc.emisor_razon_social }, enforced: issuer },
      });
    }

    const { data: concepts, error: cErr } = await admin
      .from('cfdi_concepts')
      .select('*')
      .eq('cfdi_document_id', doc.id);
    if (cErr) return json({ error: cErr.message }, 500);
    if (!concepts?.length) return json({ error: 'no_concepts' }, 400);

    // Facturama integrator mode: ensure the tenant CSD is registered under the
    // master account before stamping. No-op for 'own' mode / other PACs.
    const csdSync = await ensureFacturamaIntegratorCsd(admin, tenantId, pac, issuer);
    if (!csdSync.ok) {
      await admin
        .from('cfdi_documents')
        .update({ estado: 'error', error_message: csdSync.error, provider: adapter.id })
        .eq('id', doc.id);
      return json({ ok: false, error: csdSync.error, code: 'csd_sync_failed' });
    }

    const result = await adapter.issue({

      tenantId,
      issuer,
      pac,
      document: doc as any,
      concepts: concepts.map((c: Record<string, unknown>) => ({
        clave_prod_serv: (c.clave_prod_serv as string | null) ?? null,
        clave_unidad: (c.clave_unidad as string | null) ?? null,
        descripcion: c.descripcion as string,
        cantidad: Number(c.cantidad),
        valor_unitario: Number(c.valor_unitario),
        importe: Number(c.importe),
        iva_tasa: Number(c.iva_tasa ?? 0.16),
      })),
    });

    if (!result.ok) {
      await admin
        .from('cfdi_documents')
        .update({ estado: 'error', error_message: result.error, provider: adapter.id })
        .eq('id', doc.id);
      return json({ ok: false, error: result.error });
    }

    await admin
      .from('cfdi_documents')
      .update({
        estado: 'timbrado',
        uuid_fiscal: result.uuid,
        xml_url: result.xml_url,
        pdf_url: result.pdf_url,
        provider: adapter.id,
        emisor_rfc: issuer.rfc,
        emisor_razon_social: issuer.razon_social,
        error_message: null,
      })
      .eq('id', doc.id);

    await admin.from('audit_events').insert({
      tenant_id: tenantId,
      event_type: 'cfdi_issued',
      actor_id: userId,
      resource_type: 'cfdi_documents',
      resource_id: doc.id,
      payload: { uuid: result.uuid, provider: adapter.id, mode: pac.mode, shared_sandbox: pac.useSharedSandbox, facturama_mode: pac.facturamaMode ?? null },
    });

    return json({ ok: true, uuid: result.uuid, xml_url: result.xml_url, pdf_url: result.pdf_url });
  } catch (e) {
    console.error('[cfdi-issue]', e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
