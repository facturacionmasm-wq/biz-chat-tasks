import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { encryptSecret, type ProviderId } from '../_shared/cfdi-providers.ts';

// Save or update the tenant's fiscal profile: identity + CSD + PAC credentials.
// Only owner/admin/super_admin. Never stores CSD/credentials in plaintext.

type SaveBody = {
  rfc?: string;
  razon_social?: string;
  regimen_fiscal_sat?: string;
  codigo_postal?: string;
  // CSD (base64-encoded binaries) — optional (send only when re-uploading)
  csd_cer_b64?: string;
  csd_key_b64?: string;
  csd_password?: string;
  // PAC
  pac_provider?: ProviderId;
  pac_mode?: 'sandbox' | 'production';
  pac_credentials?: Record<string, string>; // provider-specific JSON, plaintext in transit
  use_shared_sandbox?: boolean;
  // Facturama account topology: 'own' (per-tenant Facturama account) or
  // 'integrator' (platform master account registers each tenant's CSD).
  facturama_account_mode?: 'own' | 'integrator';
  // Activation switch
  is_active?: boolean;
};


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

    // RBAC: only owner / admin / super_admin
    const { data: roles } = await admin
      .from('user_roles')
      .select('role, tenant_id')
      .eq('user_id', userId);
    const allowed = (roles ?? []).some((r: any) =>
      (r.tenant_id === tenantId && (r.role === 'owner' || r.role === 'admin')) ||
      r.role === 'super_admin',
    );
    if (!allowed) return json({ error: 'forbidden' }, 403);

    const body = (await req.json().catch(() => ({}))) as SaveBody;

    // Fetch current row (if any) so partial updates preserve existing encrypted fields.
    const { data: existing } = await admin
      .from('tenant_fiscal_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const patch: Record<string, unknown> = { tenant_id: tenantId };

    if (body.rfc !== undefined) patch.rfc = body.rfc.toUpperCase().trim();
    if (body.razon_social !== undefined) patch.razon_social = body.razon_social.trim();
    if (body.regimen_fiscal_sat !== undefined) patch.regimen_fiscal_sat = body.regimen_fiscal_sat.trim();
    if (body.codigo_postal !== undefined) patch.codigo_postal = body.codigo_postal.trim();
    if (body.pac_provider !== undefined) patch.pac_provider = body.pac_provider;
    if (body.pac_mode !== undefined) patch.pac_mode = body.pac_mode;
    if (body.use_shared_sandbox !== undefined) patch.use_shared_sandbox = !!body.use_shared_sandbox;
    if (body.is_active !== undefined) patch.is_active = !!body.is_active;

    // CSD (all-or-nothing set of 3)
    if (body.csd_cer_b64 || body.csd_key_b64 || body.csd_password) {
      if (!body.csd_cer_b64 || !body.csd_key_b64 || !body.csd_password) {
        return json({ error: 'csd_incomplete', message: 'Debes enviar .cer, .key y contraseña juntos.' }, 400);
      }
      patch.csd_cer_encrypted = await encryptSecret(body.csd_cer_b64);
      patch.csd_key_encrypted = await encryptSecret(body.csd_key_b64);
      patch.csd_password_encrypted = await encryptSecret(body.csd_password);
      patch.csd_uploaded_at = new Date().toISOString();
      // Serial/vigencia parsing is done best-effort client-side (or later); we keep DB fields nullable.
    }

    // PAC credentials
    if (body.pac_credentials) {
      const asString = JSON.stringify(body.pac_credentials);
      patch.pac_credentials_encrypted = await encryptSecret(asString);
    }

    // Required fields on first insert
    if (!existing) {
      const missing: string[] = [];
      for (const k of ['rfc', 'razon_social', 'regimen_fiscal_sat', 'codigo_postal'] as const) {
        if (!patch[k]) missing.push(k);
      }
      if (missing.length) return json({ error: 'missing_fields', fields: missing }, 400);
    }

    // Activation guard: require csd + pac credentials (or shared sandbox opt-in)
    const willBeActive = body.is_active === true;
    if (willBeActive) {
      const hasCsd = !!(patch.csd_cer_encrypted || existing?.csd_cer_encrypted);
      const hasPacCreds =
        !!(patch.pac_credentials_encrypted || existing?.pac_credentials_encrypted) ||
        !!(body.use_shared_sandbox ?? existing?.use_shared_sandbox);
      if (!hasCsd || !hasPacCreds) {
        return json({ error: 'cannot_activate', message: 'Carga CSD y credenciales del PAC antes de activar.' }, 400);
      }
    }

    const { data, error } = await admin
      .from('tenant_fiscal_profiles')
      .upsert(patch, { onConflict: 'tenant_id' })
      .select('tenant_id')
      .single();

    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, tenant_id: data.tenant_id });
  } catch (e) {
    console.error('[cfdi-fiscal-profile-save]', e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
