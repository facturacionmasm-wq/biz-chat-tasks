// Shared adapters for the multi-provider bank connection wizard (Fase 3).
// Each adapter declares required secrets + implements init/exchange/disconnect.
// Only providers whose secrets are present in Deno.env are considered "configured".

export type ProviderId = 'plaid' | 'belvo' | 'finerio' | 'prometeo';

export interface InitPayload {
  configured: boolean;
  missing_secrets?: string[];
  // Provider-specific widget bootstrap payload (link_token, widget_url, etc.)
  widget?: Record<string, unknown>;
  provider: ProviderId;
}

export interface CallbackInput {
  provider: ProviderId;
  tenantId: string;
  userId: string | null;
  // Everything the widget returned client-side.
  payload: Record<string, unknown>;
}

export interface CallbackResult {
  externalItemId: string;
  institution?: string;
  accessTokenPlaintext: string; // encrypted by caller before persistence
  metadata?: Record<string, unknown>;
}

// ── AES-GCM helpers (same scheme used by credential-vault) ──────────────
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

export async function decryptSecret(ciphertext: string): Promise<string> {
  if (!ciphertext.startsWith('enc:')) return ciphertext;
  const key = await getKey();
  const [, ivB64, ctB64] = ciphertext.split(':');
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// ── Registry ────────────────────────────────────────────────────────────
export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  requiredSecrets: string[];
  init(input: { tenantId: string; userId: string | null }): Promise<InitPayload>;
  exchange(input: CallbackInput): Promise<CallbackResult>;
  disconnect(input: { accessToken: string; externalItemId: string | null }): Promise<void>;
}

// ── PLAID (real reference implementation) ───────────────────────────────
const PLAID_HOST: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

async function plaidCall(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const env = (Deno.env.get('PLAID_ENV') ?? 'sandbox').toLowerCase();
  const host = PLAID_HOST[env] ?? PLAID_HOST.sandbox;
  const res = await fetch(`${host}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: Deno.env.get('PLAID_CLIENT_ID'),
      secret: Deno.env.get('PLAID_SECRET'),
      ...body,
    }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Plaid ${path} failed: ${JSON.stringify(json)}`);
  return json;
}

const PlaidAdapter: ProviderAdapter = {
  id: 'plaid',
  label: 'Plaid',
  requiredSecrets: ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'PLAID_ENV'],
  async init({ tenantId, userId }) {
    const missing = this.requiredSecrets.filter((k) => !Deno.env.get(k));
    if (missing.length) return { provider: 'plaid', configured: false, missing_secrets: missing };
    const resp = await plaidCall('/link/token/create', {
      user: { client_user_id: `${tenantId}:${userId ?? 'anon'}` },
      client_name: 'RYBIX Finanzas Inteligentes',
      products: ['transactions'],
      country_codes: ['US', 'MX'],
      language: 'es',
    });
    return {
      provider: 'plaid',
      configured: true,
      widget: { link_token: resp.link_token, expiration: resp.expiration },
    };
  },
  async exchange({ payload }) {
    const publicToken = payload.public_token as string | undefined;
    if (!publicToken) throw new Error('Plaid callback missing public_token');
    const exch = await plaidCall('/item/public_token/exchange', { public_token: publicToken });
    const accessToken = exch.access_token as string;
    const itemId = exch.item_id as string;
    const meta = (payload.metadata ?? {}) as Record<string, unknown>;
    const institution = ((meta.institution ?? {}) as Record<string, unknown>).name as string | undefined;
    return {
      externalItemId: itemId,
      institution,
      accessTokenPlaintext: accessToken,
      metadata: { institution: meta.institution ?? null, accounts: meta.accounts ?? [] },
    };
  },
  async disconnect({ accessToken }) {
    if (!accessToken) return;
    try { await plaidCall('/item/remove', { access_token: accessToken }); } catch { /* best-effort */ }
  },
};

// ── BELVO / FINERIO / PROMETEO (arquitectura lista, integración pendiente) ──
// TODO: replace stubs with real calls once each provider's credentials + docs are confirmed.
function makeStubAdapter(id: ProviderId, label: string, requiredSecrets: string[]): ProviderAdapter {
  return {
    id, label, requiredSecrets,
    async init() {
      const missing = requiredSecrets.filter((k) => !Deno.env.get(k));
      if (missing.length) return { provider: id, configured: false, missing_secrets: missing };
      // TODO: return real widget bootstrap (Belvo widget_token, Finerio embed URL, Prometeo session)
      return { provider: id, configured: false, missing_secrets: ['__NOT_IMPLEMENTED__'] };
    },
    async exchange() { throw new Error(`${label}: exchange not implemented yet`); },
    async disconnect() { /* TODO */ },
  };
}

const BelvoAdapter = makeStubAdapter('belvo', 'Belvo', ['BELVO_SECRET_ID', 'BELVO_SECRET_PASSWORD']);
const FinerioAdapter = makeStubAdapter('finerio', 'Finerio', ['FINERIO_API_KEY']);
const PrometeoAdapter = makeStubAdapter('prometeo', 'Prometeo', ['PROMETEO_API_KEY']);

const REGISTRY: Record<ProviderId, ProviderAdapter> = {
  plaid: PlaidAdapter,
  belvo: BelvoAdapter,
  finerio: FinerioAdapter,
  prometeo: PrometeoAdapter,
};

export function getAdapter(id: string): ProviderAdapter {
  const a = REGISTRY[id as ProviderId];
  if (!a) throw new Error(`Unknown provider: ${id}`);
  return a;
}
