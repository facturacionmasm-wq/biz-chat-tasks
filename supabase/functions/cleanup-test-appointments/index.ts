// One-shot cleanup for test appointments. Cancels Google + Cal.com events, then soft-deletes.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SRK);

  const { ids } = await req.json();
  const results: any[] = [];

  // Prepare Cal.com key per tenant (cached)
  const calcomKeyByTenant = new Map<string, string | null>();

  async function getCalcomKey(tenantId: string): Promise<string | null> {
    if (calcomKeyByTenant.has(tenantId)) return calcomKeyByTenant.get(tenantId)!;
    const { data: integ } = await supabase
      .from('calcom_integrations')
      .select('api_key_encrypted, status')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .maybeSingle();
    if (!integ?.api_key_encrypted) { calcomKeyByTenant.set(tenantId, null); return null; }
    const secret = Deno.env.get('CREDENTIALS_ENCRYPTION_KEY');
    if (!secret) { calcomKeyByTenant.set(tenantId, null); return null; }
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'PBKDF2' }, false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode('credential-vault-salt-v1'), iterations: 100000, hash: 'SHA-256' },
      km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
    let apiKey = integ.api_key_encrypted as string;
    if (apiKey.startsWith('enc:')) {
      const [, ivB64, ctB64] = apiKey.split(':');
      const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
      const ct = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      apiKey = new TextDecoder().decode(pt);
    }
    calcomKeyByTenant.set(tenantId, apiKey);
    return apiKey;
  }

  for (const id of ids) {
    const r: any = { id };
    const { data: apt } = await supabase.from('appointments').select('*').eq('id', id).single();
    if (!apt) { r.error = 'not found'; results.push(r); continue; }

    // Cal.com cancel if calendar_event_id contains calcom:
    const cev = apt.calendar_event_id || '';
    const calMatch = String(cev).split('|').find((p: string) => p.startsWith('calcom:'));
    if (calMatch || apt.source === 'calcom') {
      const uid = calMatch ? calMatch.slice('calcom:'.length) : cev;
      const apiKey = await getCalcomKey(apt.tenant_id);
      if (apiKey && uid) {
        try {
          const res = await fetch(`https://api.cal.com/v2/bookings/${encodeURIComponent(uid)}/cancel`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'cal-api-version': '2024-08-13' },
            body: JSON.stringify({ cancellationReason: 'Test cleanup' }),
          });
          r.calcom = { status: res.status, body: (await res.text()).slice(0, 150) };
        } catch (e) { r.calcom_err = String(e); }
      }
    }

    // Google mirror cancel (best-effort)
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/calendar-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SRK}`, apikey: SRK },
        body: JSON.stringify({ action: 'mirror_cancel', appointment_id: id }),
      });
      r.google = { status: res.status, body: (await res.text()).slice(0, 150) };
    } catch (e) { r.google_err = String(e); }

    // Soft-delete + mark cancelled
    const { error: upErr } = await supabase.from('appointments')
      .update({ status: 'cancelled', deleted_at: new Date().toISOString(), calendar_sync_status: 'CANCELLED' })
      .eq('id', id);
    r.db = upErr ? upErr.message : 'ok';
    results.push(r);
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
