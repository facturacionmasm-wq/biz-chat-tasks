// Cal.com webhook receiver. URL: /functions/v1/calcom-webhook?tenant_id=<uuid>
// Handles BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cal-signature-256',
};

async function verifySignature(secret: string, rawBody: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    // Cal.com sends hex sig (no prefix)
    const clean = signature.replace(/^sha256=/, '').toLowerCase();
    return clean === hex;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenant_id');
  if (!tenantId) return json({ error: 'tenant_id query param required' }, 400);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const rawBody = await req.text();

  // Fetch integration
  const { data: integ } = await supabase
    .from('calcom_integrations')
    .select('*').eq('tenant_id', tenantId).maybeSingle();
  if (!integ) return json({ error: 'Integration not found for tenant' }, 404);

  // Verify signature (Cal.com header: X-Cal-Signature-256)
  const signature = req.headers.get('x-cal-signature-256') || req.headers.get('X-Cal-Signature-256');
  if (signature) {
    const ok = await verifySignature(integ.webhook_secret, rawBody, signature);
    if (!ok) {
      await logWebhook(supabase, tenantId, 'calcom_webhook_invalid_signature', { headers: Object.fromEntries(req.headers) });
      return json({ error: 'Invalid signature' }, 401);
    }
  }

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const triggerEvent = payload.triggerEvent || payload.event; // BOOKING_CREATED etc
  const p = payload.payload || payload;

  const bookingUid = p.uid || p.bookingUid || p.id;
  if (!bookingUid) return json({ error: 'Missing booking uid' }, 400);

  await logWebhook(supabase, tenantId, `calcom_${triggerEvent || 'unknown'}`, { uid: bookingUid });

  const eventId = `calcom:${bookingUid}`;
  const startAt = p.startTime || p.start;
  const endAt = p.endTime || p.end;
  const attendee = (p.attendees && p.attendees[0]) || {};
  const contactName = attendee.name || p.name || 'Cliente Cal.com';
  const contactEmail = attendee.email || p.email || null;
  const contactPhone = p.responses?.phone?.value || p.smsReminderNumber || null;
  const title = p.title || p.eventType?.title || 'Cita Cal.com';

  const isCancel = triggerEvent === 'BOOKING_CANCELLED' || p.status === 'CANCELLED';

  const { data: existing } = await supabase
    .from('appointments').select('id')
    .eq('tenant_id', tenantId).eq('calendar_event_id', eventId).maybeSingle();

  if (isCancel) {
    if (existing) {
      await supabase.from('appointments')
        .update({ status: 'cancelled', calendar_sync_status: 'CANCELLED', updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
    return json({ ok: true, action: 'cancelled' });
  }

  if (!startAt || !endAt) return json({ error: 'Missing start/end times' }, 400);

  if (existing) {
    await supabase.from('appointments').update({
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: contactPhone,
      service_type: title,
      start_at: startAt,
      end_at: endAt,
      status: 'scheduled',
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id);
    return json({ ok: true, action: 'updated', id: existing.id });
  }

  const { data: inserted, error: insErr } = await supabase.from('appointments').insert({
    tenant_id: tenantId,
    user_id: integ.user_id,
    contact_name: contactName,
    contact_email: contactEmail,
    contact_phone: contactPhone,
    service_type: title,
    start_at: startAt,
    end_at: endAt,
    status: 'scheduled',
    source: 'calcom',
    calendar_event_id: eventId,
    calendar_sync_status: 'SYNCED',
    sync_attempts: 0,
    notes: p.additionalNotes || null,
  }).select('id').single();

  if (insErr) return json({ error: insErr.message }, 500);

  await supabase.from('calcom_integrations')
    .update({ last_sync_at: new Date().toISOString(), last_error: null })
    .eq('tenant_id', tenantId);

  return json({ ok: true, action: 'created', id: inserted?.id });
});

async function logWebhook(supabase: any, tenantId: string, event: string, payload: any) {
  try {
    await supabase.from('webhook_logs').insert({
      tenant_id: tenantId, event_type: event, payload,
    });
  } catch {}
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
