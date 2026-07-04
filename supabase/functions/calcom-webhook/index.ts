// Cal.com webhook receiver. URL: /functions/v1/calcom-webhook?tenant_id=<uuid>
// Handles BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED
// Merges with local voice appointments (source='call'/'voice') to avoid
// duplicates when the ElevenLabs agent books via Cal.com's native tool AND
// voice-scheduling.book_appointment already inserted a local row.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cal-signature-256',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MERGE_WINDOW_MS = 15 * 60 * 1000; // ±15 min
const MERGE_LOOKBACK_HOURS = 6;

async function verifySignature(secret: string, rawBody: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    const clean = signature.replace(/^sha256=/, '').toLowerCase();
    return clean === hex;
  } catch {
    return false;
  }
}

function extractAppointmentIdFromPayload(payload: any, p: any): string | null {
  const candidates = [
    payload?.metadata?.appointment_id,
    payload?.payload?.metadata?.appointment_id,
    p?.metadata?.appointment_id,
    p?.responses?.appointment_id?.value,
    p?.responses?.appointment_id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && UUID_RE.test(c.trim())) return c.trim();
  }
  return null;
}

function normalizeName(s: any): string {
  if (typeof s !== 'string') return '';
  return s.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function normalizePhoneE164(s: any): string | null {
  if (typeof s !== 'string') return null;
  const digits = s.replace(/[^\d+]/g, '');
  if (!digits) return null;
  // Keep leading '+' if present, strip other symbols
  const cleaned = digits.startsWith('+') ? '+' + digits.slice(1).replace(/\D/g, '') : digits.replace(/\D/g, '');
  return cleaned.length >= 8 ? cleaned : null;
}

function jaccard(a: string, b: string): number {
  if (!a || !b) return 0;
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = new Set([...ta, ...tb]).size;
  return inter / union;
}

function scoreCandidate(cand: any, payloadPhone: string | null, payloadName: string, startAtMs: number): number {
  let score = 0;
  const candPhone = normalizePhoneE164(cand.contact_phone);
  const candName = normalizeName(cand.contact_name);

  if (payloadPhone && candPhone) {
    // Compare last 10 digits to be robust to +country differences
    const tail = (s: string) => s.replace(/\D/g, '').slice(-10);
    if (tail(payloadPhone) && tail(payloadPhone) === tail(candPhone)) score += 3;
  }
  if (payloadName && candName) {
    if (payloadName === candName) score += 2;
    else if (!payloadPhone && jaccard(payloadName, candName) >= 0.6) score += 1;
  }
  const delta = Math.abs(new Date(cand.start_at).getTime() - startAtMs);
  if (delta <= 5 * 60 * 1000) score += 1;
  return score;
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

  const { data: integ } = await supabase
    .from('calcom_integrations')
    .select('*').eq('tenant_id', tenantId).maybeSingle();
  if (!integ) return json({ error: 'Integration not found for tenant' }, 404);

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

  const triggerEvent = payload.triggerEvent || payload.event;
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
  const contactPhone = p.responses?.phone?.value || p.smsReminderNumber || attendee.phone || null;
  const title = p.title || p.eventType?.title || 'Cita Cal.com';
  const additionalNotes = p.additionalNotes || null;

  const isCancel = triggerEvent === 'BOOKING_CANCELLED' || p.status === 'CANCELLED';

  // Step 2: idempotency by calendar_event_id
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

  // ─── Step 3: MERGE with local voice appointment ───
  const startAtMs = new Date(startAt).getTime();
  let mergeTargetId: string | null = null;
  let matchedBy: 'metadata' | 'fuzzy' | null = null;
  let matchScore = 0;

  // 3a) By metadata.appointment_id
  const metaId = extractAppointmentIdFromPayload(payload, p);
  if (metaId) {
    const { data: metaRow } = await supabase
      .from('appointments')
      .select('id, calendar_event_id')
      .eq('id', metaId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (metaRow && (metaRow.calendar_event_id === null || metaRow.calendar_event_id === eventId)) {
      mergeTargetId = metaRow.id;
      matchedBy = 'metadata';
    }
  }

  // 3b) Fuzzy fallback
  if (!mergeTargetId) {
    const windowStart = new Date(startAtMs - MERGE_WINDOW_MS).toISOString();
    const windowEnd = new Date(startAtMs + MERGE_WINDOW_MS).toISOString();
    const lookbackFrom = new Date(Date.now() - MERGE_LOOKBACK_HOURS * 3600 * 1000).toISOString();

    const { data: candidates } = await supabase
      .from('appointments')
      .select('id, contact_name, contact_phone, start_at, source, status')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .is('calendar_event_id', null)
      .in('source', ['call', 'voice'])
      .neq('status', 'cancelled')
      .gte('start_at', windowStart)
      .lte('start_at', windowEnd)
      .gte('created_at', lookbackFrom)
      .limit(5);

    if (candidates && candidates.length > 0) {
      const payloadPhone = normalizePhoneE164(contactPhone);
      const payloadName = normalizeName(contactName);
      let best: { id: string; score: number; delta: number } | null = null;
      for (const c of candidates) {
        const s = scoreCandidate(c, payloadPhone, payloadName, startAtMs);
        const delta = Math.abs(new Date(c.start_at).getTime() - startAtMs);
        if (s >= 2 && (!best || s > best.score || (s === best.score && delta < best.delta))) {
          best = { id: c.id, score: s, delta };
        }
      }
      if (best) {
        mergeTargetId = best.id;
        matchedBy = 'fuzzy';
        matchScore = best.score;
      }
    }
  }

  // Step 5: perform merge UPDATE
  if (mergeTargetId) {
    const { data: mergedRows, error: mergeErr } = await supabase
      .from('appointments')
      .update({
        calendar_event_id: eventId,
        calendar_sync_status: 'SYNCED',
        contact_email: contactEmail,
        contact_phone: contactPhone,
        service_type: title,
        start_at: startAt,
        end_at: endAt,
        status: 'scheduled',
        notes: additionalNotes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', mergeTargetId)
      .eq('tenant_id', tenantId)
      .or(`calendar_event_id.is.null,calendar_event_id.eq.${eventId}`)
      .select('id');

    if (!mergeErr && mergedRows && mergedRows.length > 0) {
      await logWebhook(supabase, tenantId, 'calcom_booking_merged', {
        uid: bookingUid, mergeTargetId, matched_by: matchedBy, score: matchScore,
      });
      await supabase.from('calcom_integrations')
        .update({ last_sync_at: new Date().toISOString(), last_error: null })
        .eq('tenant_id', tenantId);
      return json({ ok: true, action: 'merged', id: mergeTargetId, matched_by: matchedBy });
    }
    // 0 rows affected → race; fall through to insert path
  }

  // Step 4: no match → insert as before
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
    notes: additionalNotes,
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
