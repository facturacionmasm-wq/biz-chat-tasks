// Cal.com integration management: connect (save api key + register webhook), disconnect, pull_bookings
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CALCOM_API = 'https://api.cal.com/v2';

async function getKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('CREDENTIALS_ENCRYPTION_KEY');
  if (!secret) throw new Error('CREDENTIALS_ENCRYPTION_KEY not configured');
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('credential-vault-salt-v1'), iterations: 100000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}
async function encrypt(t: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(t));
  return `enc:${btoa(String.fromCharCode(...iv))}:${btoa(String.fromCharCode(...new Uint8Array(ct)))}`;
}
async function decrypt(t: string): Promise<string> {
  if (!t.startsWith('enc:')) return t;
  const key = await getKey();
  const [, ivB64, ctB64] = t.split(':');
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

function randomSecret(len = 48): string {
  const b = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabase = createClient(SUPABASE_URL, SERVICE);

  // Auth: read caller user
  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace('Bearer ', '');
  if (!jwt) return json({ error: 'Not authenticated' }, 401);
  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: 'Invalid session' }, 401);
  const user = userRes.user;

  const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('user_id', user.id).single();
  if (!profile?.tenant_id) return json({ error: 'No tenant' }, 400);
  const tenantId = profile.tenant_id;

  const body = await req.json().catch(() => ({}));
  const { action } = body;

  try {
    if (action === 'connect') {
      const apiKey = String(body.api_key || '').trim();
      const defaultEventTypeId = body.default_event_type_id ? String(body.default_event_type_id) : null;
      if (!apiKey) return json({ error: 'api_key required' }, 400);

      // Verify API key by listing event types
      const check = await fetch(`${CALCOM_API}/event-types`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!check.ok) {
        const t = await check.text();
        return json({ error: `Cal.com API key invalid: ${check.status} ${t.slice(0, 200)}` }, 400);
      }

      const webhookSecret = randomSecret(32);
      const webhookUrl = `${SUPABASE_URL}/functions/v1/calcom-webhook?tenant_id=${tenantId}`;

      // Register webhook on Cal.com
      let webhookId: string | null = null;
      try {
        const whRes = await fetch(`${CALCOM_API}/webhooks`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriberUrl: webhookUrl,
            triggers: ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'],
            active: true,
            secret: webhookSecret,
            payloadTemplate: null,
          }),
        });
        if (whRes.ok) {
          const whData = await whRes.json();
          webhookId = whData?.data?.id || whData?.id || null;
        } else {
          // Non-fatal: user can create webhook manually
          console.warn('Cal.com webhook auto-register failed:', await whRes.text());
        }
      } catch (e) {
        console.warn('Cal.com webhook error:', e);
      }

      const apiKeyEnc = await encrypt(apiKey);

      await supabase.from('calcom_integrations').upsert({
        tenant_id: tenantId,
        user_id: user.id,
        api_key_encrypted: apiKeyEnc,
        webhook_secret: webhookSecret,
        webhook_id: webhookId,
        default_event_type_id: defaultEventTypeId,
        status: 'active',
        last_sync_at: new Date().toISOString(),
        last_error: null,
      }, { onConflict: 'tenant_id' });

      return json({ ok: true, webhook_url: webhookUrl, webhook_registered: !!webhookId });
    }

    if (action === 'disconnect') {
      const { data: integ } = await supabase.from('calcom_integrations').select('*').eq('tenant_id', tenantId).maybeSingle();
      if (integ?.webhook_id && integ?.api_key_encrypted) {
        try {
          const key = await decrypt(integ.api_key_encrypted);
          await fetch(`${CALCOM_API}/webhooks/${integ.webhook_id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${key}` },
          });
        } catch {}
      }
      await supabase.from('calcom_integrations').delete().eq('tenant_id', tenantId);
      return json({ ok: true });
    }

    if (action === 'status') {
      const { data: integ } = await supabase.from('calcom_integrations')
        .select('status, last_sync_at, last_error, webhook_id, default_event_type_id, created_at')
        .eq('tenant_id', tenantId).maybeSingle();
      const webhookUrl = `${SUPABASE_URL}/functions/v1/calcom-webhook?tenant_id=${tenantId}`;
      return json({ connected: !!integ, integration: integ, webhook_url: webhookUrl });
    }

    if (action === 'pull_bookings') {
      const { data: integ } = await supabase.from('calcom_integrations').select('*').eq('tenant_id', tenantId).maybeSingle();
      if (!integ) return json({ error: 'Not connected' }, 404);
      const key = await decrypt(integ.api_key_encrypted);
      const res = await fetch(`${CALCOM_API}/bookings?status=upcoming`, { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) return json({ error: `Cal.com ${res.status}` }, 502);
      const data = await res.json();
      const bookings = data.data || data.bookings || [];
      let created = 0, updated = 0;
      for (const b of bookings) {
        const uid = b.uid || b.id;
        if (!uid || !b.startTime || !b.endTime) continue;
        const eventId = `calcom:${uid}`;
        const attendee = (b.attendees && b.attendees[0]) || {};
        const record = {
          tenant_id: tenantId,
          user_id: integ.user_id,
          contact_name: attendee.name || 'Cliente Cal.com',
          contact_email: attendee.email || null,
          service_type: b.title || b.eventType?.title || 'Cal.com',
          start_at: b.startTime,
          end_at: b.endTime,
          status: b.status === 'CANCELLED' ? 'cancelled' : 'scheduled',
          source: 'calcom',
          calendar_event_id: eventId,
          calendar_sync_status: 'SYNCED',
          sync_attempts: 0,
        };
        const { data: exists } = await supabase.from('appointments').select('id')
          .eq('tenant_id', tenantId).eq('calendar_event_id', eventId).maybeSingle();
        if (exists) { await supabase.from('appointments').update(record).eq('id', exists.id); updated++; }
        else { const { error } = await supabase.from('appointments').insert(record); if (!error) created++; }
      }
      await supabase.from('calcom_integrations').update({ last_sync_at: new Date().toISOString() }).eq('tenant_id', tenantId);
      return json({ ok: true, created, updated, total: bookings.length });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('calcom-sync error:', err);
    return json({ error: err instanceof Error ? err.message : 'unknown' }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
