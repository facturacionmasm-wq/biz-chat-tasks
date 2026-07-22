// Shared adapters for the multi-provider bank connection wizard.
// Fase 3: Plaid real. Fase 4: Belvo, Finerio y Prometeo con implementación real
// contra sus APIs oficiales (gated por presencia de secrets).
// deno-lint-ignore-file no-explicit-any

export type ProviderId = 'plaid' | 'belvo' | 'finerio' | 'prometeo';

export interface InitPayload {
  configured: boolean;
  missing_secrets?: string[];
  widget?: Record<string, unknown>;
  provider: ProviderId;
  requires_custom_ui?: boolean;
  message?: string;
}

export interface CallbackInput {
  provider: ProviderId;
  tenantId: string;
  userId: string | null;
  payload: Record<string, unknown>;
}

export interface CallbackResult {
  externalItemId: string;
  institution?: string;
  accessTokenPlaintext: string; // encrypted by caller before persistence
  metadata?: Record<string, unknown>;
}

// ── AES-GCM helpers ────────────────────────────────────────────────────
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

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  requiredSecrets: string[];
  init(input: { tenantId: string; userId: string | null }): Promise<InitPayload>;
  exchange(input: CallbackInput): Promise<CallbackResult>;
  disconnect(input: { accessToken: string; externalItemId: string | null }): Promise<void>;
}

function missingSecrets(names: string[]): string[] {
  return names.filter((k) => !Deno.env.get(k));
}

// ── PLAID ───────────────────────────────────────────────────────────────
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
    const missing = missingSecrets(this.requiredSecrets);
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

// ── BELVO ───────────────────────────────────────────────────────────────
// Docs: https://developers.belvo.com/reference/  (Basic Auth con secret_id:password)
const BELVO_HOSTS: Record<string, string> = {
  sandbox: 'https://sandbox.belvo.com',
  development: 'https://development.belvo.com',
  production: 'https://api.belvo.com',
};

function belvoAuthHeader(): string {
  const id = Deno.env.get('BELVO_SECRET_ID')!;
  const pw = Deno.env.get('BELVO_SECRET_PASSWORD')!;
  return 'Basic ' + btoa(`${id}:${pw}`);
}

async function belvoCall(method: string, path: string, body?: Record<string, unknown>): Promise<any> {
  const env = (Deno.env.get('BELVO_ENV') ?? 'sandbox').toLowerCase();
  const host = BELVO_HOSTS[env] ?? BELVO_HOSTS.sandbox;
  const res = await fetch(`${host}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: belvoAuthHeader(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`Belvo ${method} ${path} failed: ${JSON.stringify(json ?? text)}`);
  return json;
}

const BelvoAdapter: ProviderAdapter = {
  id: 'belvo',
  label: 'Belvo',
  requiredSecrets: ['BELVO_SECRET_ID', 'BELVO_SECRET_PASSWORD', 'BELVO_ENV'],
  async init({ tenantId, userId }) {
    const missing = missingSecrets(['BELVO_SECRET_ID', 'BELVO_SECRET_PASSWORD']);
    if (missing.length) return { provider: 'belvo', configured: false, missing_secrets: missing };
    // https://developers.belvo.com/docs/connect-widget#request-access-token
    const resp = await belvoCall('POST', '/api/token/', {
      id: Deno.env.get('BELVO_SECRET_ID'),
      password: Deno.env.get('BELVO_SECRET_PASSWORD'),
      scopes: 'read_institutions,write_links,read_consents,write_consents,write_consents_callback',
      widget: {
        callback_urls: {
          success: 'https://app.rybixholding.com/finance/integrations?belvo=success',
          exit: 'https://app.rybixholding.com/finance/integrations?belvo=exit',
        },
        external_id: `${tenantId}:${userId ?? 'anon'}`,
      },
    });
    return {
      provider: 'belvo',
      configured: true,
      widget: {
        access_token: resp.access,
        widget_url: 'https://widget.belvo.io',
        // TODO(belvo): confirmar si `access` requiere refrescarse por conexión.
      },
    };
  },
  async exchange({ payload }) {
    const linkId = (payload.link ?? payload.link_id) as string | undefined;
    if (!linkId) throw new Error('Belvo callback missing link/link_id');
    const link = await belvoCall('GET', `/api/links/${linkId}/`).catch(() => null);
    const institution = link?.institution as string | undefined;
    return {
      externalItemId: linkId,
      institution,
      accessTokenPlaintext: linkId, // Belvo usa el link_id como referencia persistente.
      metadata: { link, callback_payload: payload },
    };
  },
  async disconnect({ externalItemId }) {
    if (!externalItemId) return;
    try { await belvoCall('DELETE', `/api/links/${externalItemId}/`); } catch { /* best-effort */ }
  },
};

// ── FINERIO CONNECT ─────────────────────────────────────────────────────
// Docs: https://finerioconnect.com/docs/
const FINERIO_HOSTS: Record<string, string> = {
  sandbox: 'https://api.finerioconnect.com/v2',
  production: 'https://api.finerioconnect.com/v2',
  // TODO(finerio): confirmar host de sandbox si difiere del de producción.
};

async function finerioCall(method: string, path: string, body?: Record<string, unknown>): Promise<any> {
  const env = (Deno.env.get('FINERIO_ENV') ?? 'sandbox').toLowerCase();
  const host = FINERIO_HOSTS[env] ?? FINERIO_HOSTS.sandbox;
  const key = Deno.env.get('FINERIO_API_KEY')!;
  const res = await fetch(`${host}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`Finerio ${method} ${path} failed: ${JSON.stringify(json ?? text)}`);
  return json;
}

const FinerioAdapter: ProviderAdapter = {
  id: 'finerio',
  label: 'Finerio Connect',
  requiredSecrets: ['FINERIO_API_KEY', 'FINERIO_ENV'],
  async init({ tenantId }) {
    const missing = missingSecrets(['FINERIO_API_KEY']);
    if (missing.length) return { provider: 'finerio', configured: false, missing_secrets: missing };
    // 1. Crear/reutilizar customer idempotente
    let customer: any = null;
    try {
      customer = await finerioCall('POST', '/users', { customerId: tenantId, name: tenantId });
    } catch (e) {
      // Si ya existe, seguimos.
      if (!(e as Error).message.includes('exists')) {
        // TODO(finerio): confirmar código de error exacto para "customer ya existe".
      }
    }
    // 2. Obtener token del widget
    const widget = await finerioCall('POST', '/widget-tokens', { customerId: tenantId });
    return {
      provider: 'finerio',
      configured: true,
      widget: {
        widget_token: widget.token ?? widget.widgetToken ?? widget,
        widget_url: 'https://widget.finerioconnect.com',
        customer_id: tenantId,
        customer,
      },
    };
  },
  async exchange({ payload }) {
    const credentialId = (payload.credentialId ?? payload.credential_id) as string | undefined;
    if (!credentialId) throw new Error('Finerio callback missing credentialId');
    const cred = await finerioCall('GET', `/credentials/${credentialId}`).catch(() => null);
    const institution = cred?.bank?.name as string | undefined;
    return {
      externalItemId: credentialId,
      institution,
      accessTokenPlaintext: credentialId,
      metadata: { credential: cred, callback_payload: payload },
    };
  },
  async disconnect({ externalItemId }) {
    if (!externalItemId) return;
    try { await finerioCall('DELETE', `/credentials/${externalItemId}`); } catch { /* best-effort */ }
  },
};

// ── PROMETEO ────────────────────────────────────────────────────────────
// Docs: https://docs.prometeoapi.com/
// Prometeo NO usa widget: requiere formulario propio de credenciales bancarias.
// En Fase 4 dejamos el flujo escrito y GATED por env flag PROMETEO_ENABLE_LOGIN_FLOW.
// TODO(prometeo): revisar requerimientos legales antes de activar login flow en producción.
const PROMETEO_HOSTS: Record<string, string> = {
  sandbox: 'https://banking.sandbox.prometeoapi.com',
  production: 'https://banking.prometeoapi.net',
};

async function prometeoCall(method: string, path: string, body?: Record<string, unknown>): Promise<any> {
  const env = (Deno.env.get('PROMETEO_ENV') ?? 'sandbox').toLowerCase();
  const host = PROMETEO_HOSTS[env] ?? PROMETEO_HOSTS.sandbox;
  const key = Deno.env.get('PROMETEO_API_KEY')!;
  const url = `${host}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'X-API-Key': key,
      'Content-Type': body ? 'application/x-www-form-urlencoded' : 'application/json',
    },
    body: body
      ? new URLSearchParams(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)])))
      : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`Prometeo ${method} ${path} failed: ${JSON.stringify(json ?? text)}`);
  return json;
}

const PrometeoAdapter: ProviderAdapter = {
  id: 'prometeo',
  label: 'Prometeo',
  requiredSecrets: ['PROMETEO_API_KEY', 'PROMETEO_ENV'],
  async init() {
    const missing = missingSecrets(['PROMETEO_API_KEY']);
    if (missing.length) return { provider: 'prometeo', configured: false, missing_secrets: missing };

    // Prometeo requiere UI dedicada (usuario + contraseña de banco). En esta fase
    // devolvemos la lista de proveedores soportados para que la fase posterior
    // pinte el formulario adecuado.
    let providers: unknown = null;
    try {
      providers = await prometeoCall('GET', '/provider/');
    } catch (e) {
      // TODO(prometeo): confirmar path exacto en producción.
      providers = { error: (e as Error).message };
    }
    return {
      provider: 'prometeo',
      configured: false,
      requires_custom_ui: true,
      message: 'Prometeo requiere formulario dedicado de credenciales bancarias (fase posterior).',
      widget: { providers },
    };
  },
  async exchange({ payload }) {
    if (Deno.env.get('PROMETEO_ENABLE_LOGIN_FLOW') !== 'true') {
      throw new Error('Prometeo login flow gated: set PROMETEO_ENABLE_LOGIN_FLOW=true after legal review');
    }
    const { provider, username, password } = payload as { provider?: string; username?: string; password?: string };
    if (!provider || !username || !password) throw new Error('Prometeo callback missing provider/username/password');
    const resp = await prometeoCall('POST', '/login/', { provider, username, password });
    const key = (resp.key ?? resp.session?.key) as string | undefined;
    if (!key) throw new Error(`Prometeo login did not return a session key: ${JSON.stringify(resp)}`);
    return {
      externalItemId: `${provider}:${username}`,
      institution: provider,
      accessTokenPlaintext: key,
      metadata: { provider, username_masked: username.replace(/.(?=.{2})/g, '*') },
    };
  },
  async disconnect({ accessToken }) {
    if (!accessToken) return;
    try { await prometeoCall('GET', `/logout/?key=${encodeURIComponent(accessToken)}`); } catch { /* best-effort */ }
  },
};

// ── Registry ────────────────────────────────────────────────────────────
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
