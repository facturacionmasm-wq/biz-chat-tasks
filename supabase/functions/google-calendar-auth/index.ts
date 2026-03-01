// Google Calendar OAuth2 flow: initiate and callback
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = 'https://www.googleapis.com/auth/calendar';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
  const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return new Response(JSON.stringify({ error: 'Google Calendar credentials not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop();
  const hasOAuthCode = url.searchParams.has('code') && url.searchParams.has('state');
  const hasOAuthError = url.searchParams.has('error') && url.searchParams.has('state');
  const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-calendar-auth/callback`;

  // ─── CALLBACK: exchange code for tokens (check FIRST before initiate) ───
  if (hasOAuthCode || hasOAuthError || path === 'callback') {
    try {
      const code = url.searchParams.get('code');
      const stateParam = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        console.error('Google OAuth error:', error);
        return new Response(htmlPage('Error', `Google rechazó la autorización: ${error}`), {
          headers: { 'Content-Type': 'text/html' },
        });
      }

      if (!code || !stateParam) {
        return new Response(htmlPage('Error', 'Parámetros faltantes'), {
          headers: { 'Content-Type': 'text/html' },
        });
      }

      let state: { user_id: string; tenant_id: string };
      try {
        state = JSON.parse(atob(stateParam));
      } catch {
        return new Response(htmlPage('Error', 'Estado inválido'), {
          headers: { 'Content-Type': 'text/html' },
        });
      }

      // Exchange code for tokens
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      });

      const tokenData = await tokenRes.json();
      console.log('Token exchange status:', tokenRes.status, 'has_access_token:', !!tokenData.access_token, 'has_refresh_token:', !!tokenData.refresh_token);
      
      if (!tokenRes.ok || !tokenData.access_token) {
        console.error('Token exchange failed:', JSON.stringify(tokenData));
        return new Response(htmlPage('Error', `Error al obtener tokens: ${tokenData.error_description || tokenData.error}`), {
          headers: { 'Content-Type': 'text/html' },
        });
      }

      // Get user email from Google
      let googleEmail = '';
      try {
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const userInfo = await userInfoRes.json();
        googleEmail = userInfo.email || '';
        console.log('Google email retrieved:', googleEmail);
      } catch (e) {
        console.error('Failed to get Google user info:', e);
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();

      // Upsert tokens
      const { error: upsertErr } = await supabase
        .from('google_calendar_tokens')
        .upsert({
          user_id: state.user_id,
          tenant_id: state.tenant_id,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || '',
          token_expires_at: expiresAt,
          email: googleEmail,
          status: 'active',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,tenant_id' });

      if (upsertErr) {
        console.error('Token save error:', JSON.stringify(upsertErr));
        return new Response(htmlPage('Error', 'No se pudieron guardar los tokens'), {
          headers: { 'Content-Type': 'text/html' },
        });
      }

      console.log('Tokens saved successfully for user:', state.user_id);

      // Update tenant google_calendar_config
      const { data: tenant } = await supabase
        .from('tenants')
        .select('google_calendar_config')
        .eq('id', state.tenant_id)
        .single();

      const currentConfig = ((tenant?.google_calendar_config || {}) as Record<string, any>);
      const users = currentConfig.users || {};
      users[state.user_id] = {
        ...users[state.user_id],
        email: googleEmail,
        connected: true,
        oauth_connected: true,
        sync_enabled: true,
        auto_create: true,
        connected_at: new Date().toISOString(),
      };

      await supabase
        .from('tenants')
        .update({ google_calendar_config: { ...currentConfig, users } })
        .eq('id', state.tenant_id);

      // Audit log
      await supabase.from('audit_events').insert({
        tenant_id: state.tenant_id,
        event_type: 'google_calendar_connected',
        actor_id: state.user_id,
        resource_type: 'google_calendar_tokens',
        payload: { email: googleEmail },
      });

      return new Response(htmlPage('¡Conectado!', `Google Calendar conectado exitosamente con ${googleEmail}. Puedes cerrar esta ventana.`), {
        headers: { 'Content-Type': 'text/html' },
      });
    } catch (err) {
      console.error('Callback error:', err);
      return new Response(htmlPage('Error', 'Error interno al procesar la autorización'), {
        headers: { 'Content-Type': 'text/html' },
      });
    }
  }

  // ─── INITIATE: redirect user to Google consent screen ───
  if (req.method === 'POST') {
    try {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let requestedEmail = '';
      if (req.method === 'POST') {
        try {
          const body = await req.json();
          requestedEmail = typeof body?.calendar_email === 'string' ? body.calendar_email.trim() : '';
        } catch {
          requestedEmail = '';
        }
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const token = authHeader.replace('Bearer ', '');
      const { data: claims, error: claimsErr } = await supabase.auth.getUser(token);
      if (claimsErr || !claims?.user) {
        return new Response(JSON.stringify({ error: 'Invalid token' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const userId = claims.user.id;

      // Get tenant_id
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('user_id', userId)
        .single();
      if (!profile) {
        return new Response(JSON.stringify({ error: 'Profile not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Encode state with user info
      const state = btoa(JSON.stringify({ user_id: userId, tenant_id: profile.tenant_id }));

      const authUrl = new URL(GOOGLE_AUTH_URL);
      authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', SCOPES);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'select_account consent');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('include_granted_scopes', 'true');
      if (requestedEmail) {
        authUrl.searchParams.set('login_hint', requestedEmail);
      }

      return new Response(JSON.stringify({ auth_url: authUrl.toString() }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('Initiate error:', err);
      return new Response(JSON.stringify({ error: 'Failed to initiate OAuth' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // ─── STATUS: check token health ───
  if (req.method === 'GET') {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace('Bearer ', '');
    const { data: claims } = await supabase.auth.getUser(token);
    if (!claims?.user) {
      return new Response(JSON.stringify({ connected: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: calToken } = await supabase
      .from('google_calendar_tokens')
      .select('email, status, token_expires_at, calendar_id')
      .eq('user_id', claims.user.id)
      .eq('status', 'active')
      .maybeSingle();

    return new Response(JSON.stringify({
      connected: !!calToken,
      email: calToken?.email || null,
      calendar_id: calToken?.calendar_id || 'primary',
      status: calToken?.status || 'disconnected',
      token_expires_at: calToken?.token_expires_at || null,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown endpoint' }), {
    status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

function htmlPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fff}
.card{text-align:center;padding:2rem;border-radius:1rem;background:#1a1a1a;max-width:400px}
h1{font-size:1.5rem;margin-bottom:0.5rem}p{color:#aaa;margin-bottom:1.5rem}
button{background:#6366f1;color:#fff;border:none;padding:0.75rem 1.5rem;border-radius:0.5rem;cursor:pointer;font-size:1rem}
</style></head><body><div class="card"><h1>${title}</h1><p>${message}</p>
<button onclick="window.close()">Cerrar ventana</button></div></body></html>`;
}
