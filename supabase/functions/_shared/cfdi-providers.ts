// Shared CFDI provider adapter — multi-tenant.
// Credentials + issuer identity are resolved from public.tenant_fiscal_profiles
// (never from client input). AES-GCM decryption uses CREDENTIALS_ENCRYPTION_KEY.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';

// ── AES-GCM (same helper as finance-providers) ───────────────────────────
async function getKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('CREDENTIALS_ENCRYPTION_KEY');
  if (!secret) throw new Error('CREDENTIALS_ENCRYPTION_KEY not configured');
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('credential-vault-salt-v1'), iterations: 100000, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ct)));
  return `enc:${ivB64}:${ctB64}`;
}
export async function decryptSecret(ciphertext: string | null | undefined): Promise<string> {
  if (!ciphertext) return '';
  if (!ciphertext.startsWith('enc:')) return ciphertext;
  const key = await getKey();
  const [, ivB64, ctB64] = ciphertext.split(':');
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// ── Types ─────────────────────────────────────────────────────────────────
export type ProviderId = 'facturama' | 'sw_sapien' | 'finkok';

export type IssuerIdentity = {
  rfc: string;
  razon_social: string;
  regimen_fiscal_sat: string;
  codigo_postal: string;
};

export type PacCredentials = {
  provider: ProviderId;
  mode: 'sandbox' | 'production';
  useSharedSandbox: boolean;
  // Decrypted per-tenant credentials JSON (shape depends on provider).
  credentials: Record<string, string>;
};

export type CfdiIssueInput = {
  tenantId: string;
  issuer: IssuerIdentity;
  pac: PacCredentials;
  document: {
    id: string;
    series: string | null;
    folio: string | null;
    tipo_comprobante: string;
    uso_cfdi: string | null;
    forma_pago: string | null;
    metodo_pago: string | null;
    moneda: string;
    receptor_rfc: string;
    receptor_nombre: string;
    receptor_uso_cfdi: string | null;
    subtotal: number;
    iva: number;
    total: number;
  };
  concepts: Array<{
    clave_prod_serv: string | null;
    clave_unidad: string | null;
    descripcion: string;
    cantidad: number;
    valor_unitario: number;
    importe: number;
    iva_tasa: number;
  }>;
};

export type CfdiIssueResult =
  | { ok: true; uuid: string; xml_url: string | null; pdf_url: string | null; raw?: unknown }
  | { ok: false; error: string; raw?: unknown };

export type CfdiCancelInput = {
  tenantId: string;
  pac: PacCredentials;
  uuid: string;
  motivo: string;
  folio_sustitucion?: string | null;
};

export type CfdiCancelResult =
  | { ok: true; acuse_xml_url?: string | null; raw?: unknown }
  | { ok: false; error: string; raw?: unknown };

export interface CfdiAdapter {
  id: ProviderId;
  label: string;
  issue(input: CfdiIssueInput): Promise<CfdiIssueResult>;
  cancel(input: CfdiCancelInput): Promise<CfdiCancelResult>;
  ping(pac: PacCredentials): Promise<{ ok: boolean; error?: string; raw?: unknown }>;
}

// ── Tenant resolver ───────────────────────────────────────────────────────
export type ResolvedTenantFiscal = {
  adapter: CfdiAdapter;
  issuer: IssuerIdentity;
  pac: PacCredentials;
};

export type ResolveError =
  | { ok: false; code: 'pac_not_configured' | 'inactive' | 'no_profile' | 'no_credentials' | 'invalid_provider'; message: string };

export async function resolveTenantFiscal(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ ok: true } & ResolvedTenantFiscal | ResolveError> {
  const { data: row } = await admin
    .from('tenant_fiscal_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!row) return { ok: false, code: 'no_profile', message: 'Configura tu perfil fiscal antes de timbrar.' };
  if (!row.is_active) return { ok: false, code: 'inactive', message: 'El perfil fiscal está inactivo. Actívalo tras cargar CSD y credenciales del PAC.' };
  if (!row.pac_provider) return { ok: false, code: 'invalid_provider', message: 'Selecciona un PAC (Facturama / SW / Finkok).' };

  const useShared = row.use_shared_sandbox === true && row.pac_mode === 'sandbox';
  let creds: Record<string, string> = {};

  if (useShared) {
    // Only opt-in explicit shared sandbox fallback (Facturama demo).
    creds = {
      user: Deno.env.get('FACTURAMA_SANDBOX_USER') ?? Deno.env.get('FACTURAMA_USER') ?? '',
      password: Deno.env.get('FACTURAMA_SANDBOX_PASSWORD') ?? Deno.env.get('FACTURAMA_PASSWORD') ?? '',
    };
    if (!creds.user || !creds.password) {
      return { ok: false, code: 'no_credentials', message: 'Sandbox compartido no configurado en la plataforma.' };
    }
  } else {
    if (!row.pac_credentials_encrypted) {
      return { ok: false, code: 'no_credentials', message: 'Faltan credenciales del PAC.' };
    }
    try {
      const plaintext = await decryptSecret(row.pac_credentials_encrypted);
      creds = JSON.parse(plaintext);
    } catch (_e) {
      return { ok: false, code: 'no_credentials', message: 'No se pudieron descifrar las credenciales del PAC.' };
    }
  }

  const providerId = row.pac_provider as ProviderId;
  const adapter = registry[providerId];
  if (!adapter) return { ok: false, code: 'invalid_provider', message: `Proveedor no soportado: ${providerId}` };

  return {
    ok: true,
    adapter,
    issuer: {
      rfc: String(row.rfc).toUpperCase(),
      razon_social: row.razon_social,
      regimen_fiscal_sat: row.regimen_fiscal_sat,
      codigo_postal: row.codigo_postal,
    },
    pac: {
      provider: providerId,
      mode: row.pac_mode,
      useSharedSandbox: useShared,
      credentials: creds,
    },
  };
}

export function makeAdminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

// ── Facturama adapter ─────────────────────────────────────────────────────
function facturamaBase(mode: 'sandbox' | 'production'): string {
  return mode === 'production' ? 'https://api.facturama.mx' : 'https://apisandbox.facturama.com.mx';
}
function facturamaAuth(creds: Record<string, string>): string {
  return 'Basic ' + btoa(`${creds.user}:${creds.password}`);
}

export const FacturamaAdapter: CfdiAdapter = {
  id: 'facturama',
  label: 'Facturama',

  async issue(input) {
    const base = facturamaBase(input.pac.mode);
    const auth = facturamaAuth(input.pac.credentials);
    const payload = {
      NameId: 1,
      Folio: input.document.folio ?? undefined,
      Serie: input.document.series ?? undefined,
      CfdiType: input.document.tipo_comprobante ?? 'I',
      PaymentForm: input.document.forma_pago ?? '99',
      PaymentMethod: input.document.metodo_pago ?? 'PUE',
      Currency: input.document.moneda ?? 'MXN',
      // Enforce issuer identity from tenant_fiscal_profiles (never from client).
      Issuer: {
        Rfc: input.issuer.rfc,
        Name: input.issuer.razon_social,
        FiscalRegime: input.issuer.regimen_fiscal_sat,
      },
      ExpeditionPlace: input.issuer.codigo_postal,
      Receiver: {
        Rfc: input.document.receptor_rfc,
        Name: input.document.receptor_nombre,
        CfdiUse: input.document.receptor_uso_cfdi ?? input.document.uso_cfdi ?? 'G03',
      },
      Items: input.concepts.map((c) => ({
        ProductCode: c.clave_prod_serv ?? '01010101',
        UnitCode: c.clave_unidad ?? 'H87',
        Description: c.descripcion,
        Quantity: c.cantidad,
        UnitPrice: c.valor_unitario,
        Subtotal: c.importe,
        Total: c.importe + c.importe * (c.iva_tasa ?? 0.16),
        Taxes: [
          {
            Total: Math.round(c.importe * (c.iva_tasa ?? 0.16) * 100) / 100,
            Name: 'IVA',
            Base: c.importe,
            Rate: c.iva_tasa ?? 0.16,
            IsRetention: false,
          },
        ],
      })),
    };

    try {
      const resp = await fetch(`${base}/3/cfdis`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const raw = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return { ok: false, error: `facturama_${resp.status}:${JSON.stringify(raw).slice(0, 300)}`, raw };
      }
      const uuid = raw?.Complement?.TaxStamp?.Uuid ?? raw?.Id ?? null;
      const docId = raw?.Id ?? null;
      const xml_url = docId ? `${base}/cfdi/xml/issued/${docId}` : null;
      const pdf_url = docId ? `${base}/cfdi/pdf/issued/${docId}` : null;
      return uuid
        ? { ok: true, uuid, xml_url, pdf_url, raw }
        : { ok: false, error: 'no_uuid_returned', raw };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async cancel(input) {
    const base = facturamaBase(input.pac.mode);
    const auth = facturamaAuth(input.pac.credentials);
    try {
      const q = new URLSearchParams({ motive: input.motivo });
      if (input.folio_sustitucion) q.set('uuidReplacement', input.folio_sustitucion);
      const resp = await fetch(`${base}/cfdi/${input.uuid}?${q.toString()}`, {
        method: 'DELETE',
        headers: { Authorization: auth },
      });
      const raw = await resp.json().catch(() => ({}));
      if (!resp.ok) return { ok: false, error: `facturama_cancel_${resp.status}`, raw };
      return { ok: true, raw };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async ping(pac) {
    const base = facturamaBase(pac.mode);
    const auth = facturamaAuth(pac.credentials);
    try {
      const resp = await fetch(`${base}/api-lite/clients?limit=1`, { headers: { Authorization: auth } });
      if (!resp.ok) return { ok: false, error: `facturama_ping_${resp.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
};

// ── SW Sapien / Finkok stubs (multi-tenant shape ready) ──────────────────
export const SwSapienAdapter: CfdiAdapter = {
  id: 'sw_sapien',
  label: 'SW Sapien',
  async issue() { return { ok: false, error: 'provider_not_implemented' }; },
  async cancel() { return { ok: false, error: 'provider_not_implemented' }; },
  async ping() { return { ok: false, error: 'provider_not_implemented' }; },
};

export const FinkokAdapter: CfdiAdapter = {
  id: 'finkok',
  label: 'Finkok',
  async issue() { return { ok: false, error: 'provider_not_implemented' }; },
  async cancel() { return { ok: false, error: 'provider_not_implemented' }; },
  async ping() { return { ok: false, error: 'provider_not_implemented' }; },
};

const registry: Record<ProviderId, CfdiAdapter> = {
  facturama: FacturamaAdapter,
  sw_sapien: SwSapienAdapter,
  finkok: FinkokAdapter,
};

export function getCfdiAdapter(id: string): CfdiAdapter | null {
  return (registry as Record<string, CfdiAdapter>)[id] ?? null;
}
