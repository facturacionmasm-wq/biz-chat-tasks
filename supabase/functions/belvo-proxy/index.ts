// Belvo proxy — invoca la API real de Belvo usando credenciales seguras del servidor.
// Acciones soportadas: list_institutions, register_link, get_accounts, get_balances,
// get_transactions, get_link_status, delete_link, create_widget_token.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BELVO_ENV = (Deno.env.get('BELVO_ENV') || 'sandbox').toLowerCase();
const BELVO_BASE =
  BELVO_ENV === 'production'
    ? 'https://api.belvo.com'
    : BELVO_ENV === 'development'
    ? 'https://development.belvo.com'
    : 'https://sandbox.belvo.com';

function authHeader() {
  const id = Deno.env.get('BELVO_SECRET_ID');
  const pw = Deno.env.get('BELVO_SECRET_PASSWORD');
  if (!id || !pw) throw new Error('missing_belvo_credentials');
  return 'Basic ' + btoa(`${id}:${pw}`);
}

async function belvo(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BELVO_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, ok: res.ok, body };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Verify auth (JWT is verified by platform; also read user for audit)
    const authz = req.headers.get('Authorization') || '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authz } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { action, params } = await req.json().catch(() => ({ action: '', params: {} }));
    const p = params || {};

    let result: { status: number; ok: boolean; body: unknown };

    switch (action) {
      case 'list_institutions': {
        const qs = new URLSearchParams();
        if (p.country_code) qs.set('country_code', p.country_code);
        if (p.type) qs.set('type', p.type);
        qs.set('page_size', String(p.page_size ?? 100));
        result = await belvo(`/api/institutions/?${qs.toString()}`);
        break;
      }
      case 'create_widget_token': {
        // Solicita un access_token de corta duración para el Widget Connect.
        // Docs: https://developers.belvo.com/docs/connect-widget
        result = await belvo('/api/token/', {
          method: 'POST',
          body: JSON.stringify({
            id: Deno.env.get('BELVO_SECRET_ID'),
            password: Deno.env.get('BELVO_SECRET_PASSWORD'),
            scopes: 'read_institutions,write_links,read_consents,write_consents,write_consent_callback',
            widget: p.widget || undefined,
          }),
        });
        break;
      }
      case 'register_link': {
        // Registro directo (server-side) usando credenciales del usuario final.
        result = await belvo('/api/links/', {
          method: 'POST',
          body: JSON.stringify({
            institution: p.institution,
            username: p.username,
            password: p.password,
            username2: p.username2,
            password2: p.password2,
            token: p.token,
            access_mode: p.access_mode || 'single',
            external_id: p.external_id,
          }),
        });
        break;
      }
      case 'get_link_status': {
        result = await belvo(`/api/links/${encodeURIComponent(p.link)}/`);
        break;
      }
      case 'delete_link': {
        result = await belvo(`/api/links/${encodeURIComponent(p.link)}/`, { method: 'DELETE' });
        break;
      }
      case 'get_accounts': {
        result = await belvo('/api/accounts/', {
          method: 'POST',
          body: JSON.stringify({ link: p.link, save_data: p.save_data ?? true }),
        });
        break;
      }
      case 'get_balances': {
        result = await belvo('/api/balances/', {
          method: 'POST',
          body: JSON.stringify({
            link: p.link,
            account: p.account,
            date_from: p.date_from,
            date_to: p.date_to,
            save_data: p.save_data ?? true,
          }),
        });
        break;
      }
      case 'get_transactions': {
        result = await belvo('/api/transactions/', {
          method: 'POST',
          body: JSON.stringify({
            link: p.link,
            account: p.account,
            date_from: p.date_from,
            date_to: p.date_to,
            save_data: p.save_data ?? true,
          }),
        });
        break;
      }
      case 'ping': {
        // Verifica credenciales listando 1 institución.
        result = await belvo('/api/institutions/?page_size=1');
        break;
      }
      default:
        return new Response(JSON.stringify({ error: 'unknown_action', action }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    return new Response(
      JSON.stringify({ ok: result.ok, status: result.status, data: result.body, env: BELVO_ENV }),
      {
        status: result.ok ? 200 : result.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
