import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { assertVoicePlan } from "../_shared/plan-guard.ts";
import { resolveTenantTimezone, zonedTimeToUtc, formatInTimezone } from "../_shared/timezone.ts";

// Fire-and-forget helper — schedules `p` on the edge runtime without blocking
// the tool response. Uses EdgeRuntime.waitUntil when available (Supabase edge),
// falls back to a floating promise so the caller returns immediately either way.
function detach(p: Promise<unknown>) {
  try {
    // deno-lint-ignore no-explicit-any
    const rt: any = (globalThis as any).EdgeRuntime;
    if (rt && typeof rt.waitUntil === 'function') {
      rt.waitUntil(p);
      return;
    }
  } catch { /* ignore */ }
  p.catch((e) => console.error('[voice-scheduling] detached task error:', e));
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { action, data } = await req.json();

    // Plan guard: block voice_agent-gated actions when the tenant's plan does not include it.
    const gTenantId = data?.tenant_id;
    if (gTenantId) {
      const blocked = await assertVoicePlan(supabase, gTenantId, corsHeaders);
      if (blocked) return blocked;
    }


    // ─── CHECK AVAILABILITY ───
    if (action === 'check_availability') {
      const { tenant_id, date, employee_id } = data;
      if (!tenant_id || !date) {
        return jsonResp({ error: 'Missing tenant_id or date' }, 400);
      }

      const targetDate = new Date(date);
      const dayOfWeek = targetDate.getDay(); // 0=Sun ... 6=Sat

      // Get availability rules for that day
      let rulesQuery = supabase
        .from('availability_rules')
        .select('*')
        .eq('tenant_id', tenant_id)
        .eq('day_of_week', dayOfWeek)
        .eq('active', true);

      if (employee_id) {
        rulesQuery = rulesQuery.eq('user_id', employee_id);
      }

      const { data: rules, error: rulesErr } = await rulesQuery;
      if (rulesErr) throw rulesErr;

      if (!rules || rules.length === 0) {
        return jsonResp({ available: false, message: 'No hay horarios configurados para este día', slots: [] });
      }

      // Get existing appointments for that date
      const dayStart = new Date(targetDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(targetDate);
      dayEnd.setHours(23, 59, 59, 999);

      let aptsQuery = supabase
        .from('appointments')
        .select('*')
        .eq('tenant_id', tenant_id)
        .gte('start_at', dayStart.toISOString())
        .lte('start_at', dayEnd.toISOString())
        .is('deleted_at', null)
        .not('status', 'eq', 'cancelled');

      if (employee_id) {
        aptsQuery = aptsQuery.eq('user_id', employee_id);
      }

      const { data: existingApts } = await aptsQuery;

      // ── Fetch Cal.com busy times for conflict checking (single source of truth) ──
      const calcomBusy: Array<{ start: Date; end: Date }> = [];
      try {
        const { data: calcomInteg } = await supabase
          .from('calcom_integrations')
          .select('api_key_encrypted, default_event_type_id, status')
          .eq('tenant_id', tenant_id)
          .eq('status', 'active')
          .maybeSingle();

        if (calcomInteg?.api_key_encrypted && calcomInteg?.default_event_type_id) {
          const secret = Deno.env.get('CREDENTIALS_ENCRYPTION_KEY');
          if (secret) {
            const enc = new TextEncoder();
            const km = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'PBKDF2' }, false, ['deriveKey']);
            const key = await crypto.subtle.deriveKey(
              { name: 'PBKDF2', salt: enc.encode('credential-vault-salt-v1'), iterations: 100000, hash: 'SHA-256' },
              km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
            );
            let apiKey = calcomInteg.api_key_encrypted as string;
            if (apiKey.startsWith('enc:')) {
              const [, ivB64, ctB64] = apiKey.split(':');
              const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
              const ct = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));
              const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
              apiKey = new TextDecoder().decode(pt);
            }

            // Query Cal.com slots API — anything NOT in the returned slot list is treated as busy.
            const slotsUrl = `https://api.cal.com/v2/slots?eventTypeId=${Number(calcomInteg.default_event_type_id)}&startTime=${encodeURIComponent(dayStart.toISOString())}&endTime=${encodeURIComponent(dayEnd.toISOString())}`;
            const slotsRes = await fetch(slotsUrl, {
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'cal-api-version': '2024-09-04',
              },
            });
            if (slotsRes.ok) {
              const slotsJson = await slotsRes.json();
              const freeStartsSet = new Set<string>();
              const slotsData = slotsJson?.data || slotsJson?.slots || {};
              for (const key of Object.keys(slotsData)) {
                const arr = slotsData[key];
                if (Array.isArray(arr)) {
                  for (const it of arr) {
                    const t = typeof it === 'string' ? it : (it?.time || it?.start);
                    if (t) freeStartsSet.add(new Date(t).toISOString());
                  }
                }
              }
              // Mark every 30-min slot in the day that is NOT in freeStartsSet as busy.
              const cursor = new Date(dayStart);
              while (cursor < dayEnd) {
                const iso = cursor.toISOString();
                if (!freeStartsSet.has(iso)) {
                  calcomBusy.push({
                    start: new Date(cursor),
                    end: new Date(cursor.getTime() + 30 * 60 * 1000),
                  });
                }
                cursor.setMinutes(cursor.getMinutes() + 30);
              }
              console.log(`[voice-scheduling] Cal.com free slots=${freeStartsSet.size}, marked busy=${calcomBusy.length}`);
            } else {
              console.warn('[voice-scheduling] Cal.com slots fetch failed:', slotsRes.status, (await slotsRes.text()).slice(0, 200));
            }
          }
        }
      } catch (calErr) {
        console.warn('[voice-scheduling] Cal.com availability check error (non-blocking):', calErr);
      }

      // Generate available slots (30-min intervals)
      const slots: Array<{ start: string; end: string; employee_id: string | null; employee_name: string }> = [];

      for (const rule of rules) {
        const [startH, startM] = rule.start_time.split(':').map(Number);
        const [endH, endM] = rule.end_time.split(':').map(Number);
        const bufferBefore = rule.buffer_before || 0;
        const bufferAfter = rule.buffer_after || 0;
        const slotDuration = 30; // minutes

        let cursor = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        // Get employee name
        let employeeName = 'Sin asignar';
        if (rule.user_id) {
          try {
            const { data: profile } = await supabase
              .from('profiles')
              .select('name')
              .eq('user_id', rule.user_id)
              .maybeSingle();
            if (profile?.name) employeeName = profile.name;
          } catch (pErr) {
            console.warn('[voice-scheduling] profile lookup failed:', pErr);
          }
        }

        while (cursor + slotDuration <= endMinutes) {
          const slotStart = new Date(targetDate);
          slotStart.setHours(Math.floor(cursor / 60), cursor % 60, 0, 0);
          const slotEnd = new Date(slotStart);
          slotEnd.setMinutes(slotEnd.getMinutes() + slotDuration);

          // Check conflicts with buffer
          const slotStartWithBuffer = new Date(slotStart);
          slotStartWithBuffer.setMinutes(slotStartWithBuffer.getMinutes() - bufferBefore);
          const slotEndWithBuffer = new Date(slotEnd);
          slotEndWithBuffer.setMinutes(slotEndWithBuffer.getMinutes() + bufferAfter);

          // Check local appointment conflicts
          const hasLocalConflict = (existingApts || []).some(apt => {
            const aptStart = new Date(apt.start_at);
            const aptEnd = new Date(apt.end_at);
            return slotStartWithBuffer < aptEnd && slotEndWithBuffer > aptStart;
          });

          // Check Cal.com conflicts (source of truth)
          const hasCalcomConflict = calcomBusy.some(evt => {
            return slotStartWithBuffer < evt.end && slotEndWithBuffer > evt.start;
          });

          if (!hasLocalConflict && !hasCalcomConflict) {
            // Check max_appointments
            const aptsInSlot = (existingApts || []).filter(apt => {
              const aptStart = new Date(apt.start_at);
              return aptStart.getHours() === slotStart.getHours() && aptStart.getMinutes() === slotStart.getMinutes();
            }).length;

            if (aptsInSlot < (rule.max_appointments || 10)) {
              slots.push({
                start: slotStart.toISOString(),
                end: slotEnd.toISOString(),
                employee_id: rule.user_id,
                employee_name: employeeName,
              });
            }
          }

          cursor += slotDuration;
        }
      }

      return jsonResp({
        available: slots.length > 0,
        slots,
        date: targetDate.toISOString().split('T')[0],
        calcom_busy_slots: calcomBusy.length,
        message: slots.length > 0
          ? `Hay ${slots.length} horarios disponibles para ${targetDate.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}`
          : 'No hay horarios disponibles para esta fecha',
      });
    }

    // ─── BOOK APPOINTMENT ───
    if (action === 'book_appointment') {
      const { tenant_id, contact_name, contact_phone, contact_email, start_at, service_type, employee_id, notes, source, call_record_id } = data;

      if (!tenant_id || !contact_name || !start_at) {
        return jsonResp({ error: 'Missing required fields' }, 400);
      }

      // Resolve tenant timezone using the SAME source as reminders
      // (settings_json.branches[default].timezone → tenants.timezone → default).
      const tz = await resolveTenantTimezone(supabase, tenant_id);

      // Parse start_at preserving local wall-clock intent, then convert to
      // real UTC using DST-aware Intl-based offset math (matches date-fns-tz).
      const naiveDateTime = String(start_at).replace(/Z$/i, '').replace(/([+-]\d{2}:?\d{2})$/, '');
      let startDate: Date;
      try {
        startDate = zonedTimeToUtc(naiveDateTime, tz);
        if (Number.isNaN(startDate.getTime())) throw new Error('bad date');
      } catch {
        return jsonResp({
          success: false,
          message: 'La fecha y hora recibidas no son válidas. ¿Podrías repetirlas?',
        });
      }
      const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);

      // Auto-assign employee if not specified: find who has availability for this slot
      let resolvedEmployeeId = employee_id || null;
      if (!resolvedEmployeeId) {
        // Local wall-clock is what the tenant's schedule is expressed in.
        const [, timePart] = naiveDateTime.split('T');
        const [localH, localM] = (timePart || '00:00').split(':').map(Number);
        const localMinutes = (localH || 0) * 60 + (localM || 0);
        // Day-of-week in tenant timezone, computed via Intl.
        const dow = Number(
          new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
            .formatToParts(startDate)
            .find((p) => p.type === 'weekday')?.value
            ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(
                new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
                  .formatToParts(startDate).find((p) => p.type === 'weekday')!.value,
              )
            : startDate.getUTCDay(),
        );
        const dayOfWeek = Number.isFinite(dow) && dow >= 0 ? dow : startDate.getUTCDay();

        try {
          const { data: matchingRules } = await supabase
            .from('availability_rules')
            .select('user_id, start_time, end_time')
            .eq('tenant_id', tenant_id)
            .eq('day_of_week', dayOfWeek)
            .eq('active', true)
            .not('user_id', 'is', null);

          if (matchingRules && matchingRules.length > 0) {
            for (const rule of matchingRules) {
              const [rStartH, rStartM] = rule.start_time.split(':').map(Number);
              const [rEndH, rEndM] = rule.end_time.split(':').map(Number);
              const ruleStart = rStartH * 60 + rStartM;
              const ruleEnd = rEndH * 60 + rEndM;
              if (localMinutes >= ruleStart && localMinutes < ruleEnd) {
                resolvedEmployeeId = rule.user_id;
                break;
              }
            }
            if (!resolvedEmployeeId) resolvedEmployeeId = matchingRules[0].user_id;
          }
        } catch (arErr) {
          console.warn('[voice-scheduling] availability lookup failed:', arErr);
        }
      }

      const idempotencyKey = `${tenant_id}:${contact_name}:${startDate.toISOString()}:${service_type || 'general'}:${resolvedEmployeeId || 'unassigned'}`;

      let appointment: any = null;
      try {
        const { data: aptRow, error: insertErr } = await supabase
          .from('appointments')
          .insert({
            tenant_id,
            contact_name,
            contact_phone: contact_phone || null,
            contact_email: contact_email || null,
            start_at: startDate.toISOString(),
            end_at: endDate.toISOString(),
            service_type: service_type || 'general',
            user_id: resolvedEmployeeId,
            notes: notes || null,
            source: source || 'call',
            call_record_id: call_record_id || null,
            status: 'scheduled',
            calendar_sync_status: 'PENDING_SYNC',
            idempotency_key: idempotencyKey,
          })
          .select('id, start_at, end_at, contact_name, service_type, status')
          .maybeSingle();
        if (insertErr) throw insertErr;
        appointment = aptRow;
      } catch (e) {
        console.error('[voice-scheduling] appointment insert error:', e);
        return jsonResp({
          success: false,
          message: 'No pude registrar la cita en este momento. ¿Podemos intentar con otro horario?',
        });
      }
      if (!appointment?.id) {
        return jsonResp({
          success: false,
          message: 'No pude registrar la cita en este momento. ¿Podemos intentar con otro horario?',
        });
      }

      // ── Fire-and-forget sync to Cal.com + Google Calendar ─────────────
      // Responding immediately keeps the ElevenLabs tool call under its ~20s
      // timeout so the agent never gets disconnected mid-booking.
      if (appointment.id && contact_email && !/@wa\.local$/i.test(contact_email)) {
        detach((async () => {
          try {
            const pushed = await pushToCalcom(supabase, tenant_id, {
              appointment_id: appointment.id,
              start_iso: startDate.toISOString(),
              contact_name,
              contact_email,
              timezone: tz,
              source: 'voice',
            });
            if (pushed?.calcom_uid) {
              await supabase.from('appointments')
                .update({ calendar_event_id: `calcom:${pushed.calcom_uid}`, calendar_sync_status: 'SYNCED' })
                .eq('id', appointment.id);
              try {
                await fetch(`${SUPABASE_URL}/functions/v1/calendar-sync`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: SUPABASE_SERVICE_ROLE_KEY },
                  body: JSON.stringify({ action: 'mirror_appointment', appointment_id: appointment.id, preferred_user_id: resolvedEmployeeId || employee_id || null }),
                });
              } catch (mirrorErr) {
                console.warn('[voice-scheduling] Google mirror error (ignored):', mirrorErr);
              }
            } else if (pushed?.conflict) {
              // We already told the caller the slot was booked; if Cal.com reports
              // a conflict AFTER the fact, mark the appointment as needing review
              // instead of silently deleting it.
              await supabase.from('appointments')
                .update({ calendar_sync_status: 'CONFLICT' })
                .eq('id', appointment.id);
            }
          } catch (calErr) {
            console.error('[voice-scheduling] async Cal.com push error:', calErr);
          }
        })());
      }

      const dateStr = formatInTimezone(startDate, tz, { weekday: 'long', day: 'numeric', month: 'long' });
      const timeStr = formatInTimezone(startDate, tz, { hour: '2-digit', minute: '2-digit', hour12: true });
      return jsonResp({
        success: true,
        appointment,
        message: `Cita agendada para ${contact_name} el ${dateStr} a las ${timeStr}`,
      });
    }

    // ─── RESCHEDULE ───
    if (action === 'reschedule_appointment') {
      const { appointment_id, new_start_at } = data;
      if (!appointment_id || !new_start_at) {
        return jsonResp({ error: 'Missing appointment_id or new_start_at' }, 400);
      }

      const newStart = new Date(new_start_at);
      const newEnd = new Date(newStart);
      newEnd.setMinutes(newEnd.getMinutes() + 30);

      // Read previous state to notify staff
      const { data: prev } = await supabase
        .from('appointments')
        .select('start_at, user_id, tenant_id, contact_name, service_type')
        .eq('id', appointment_id)
        .maybeSingle();

      let updated: any = null;
      try {
        const { data: updRow, error: updateErr } = await supabase
          .from('appointments')
          .update({
            start_at: newStart.toISOString(),
            end_at: newEnd.toISOString(),
            status: 'scheduled',
          })
          .eq('id', appointment_id)
          .select('id, start_at, end_at, contact_name, tenant_id, user_id')
          .maybeSingle();
        if (updateErr) throw updateErr;
        updated = updRow;
      } catch (e) {
        console.error('[voice-scheduling] reschedule update error:', e);
        return jsonResp({
          success: false,
          message: 'No pude reprogramar la cita en este momento. ¿Podemos intentar de nuevo?',
        });
      }
      if (!updated?.id) {
        return jsonResp({
          success: false,
          message: 'No encontré esa cita. ¿Puedes verificar el identificador?',
        });
      }

      const tzR = await resolveTenantTimezone(supabase, updated.tenant_id);

      // Fire-and-forget Google Calendar mirror
      detach(fetch(`${SUPABASE_URL}/functions/v1/calendar-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ action: 'update_event', appointment_id }),
      }).then(() => undefined));

      // Notify staff owner (if any)
      if (updated.user_id) {
        const prevDisplay = prev?.start_at
          ? formatInTimezone(new Date(prev.start_at), tzR, { dateStyle: 'full', timeStyle: 'short' })
          : 'anterior';
        const newDisplay = formatInTimezone(newStart, tzR, { dateStyle: 'full', timeStyle: 'short' });
        const msg = `La cita con ${updated.contact_name}${prev?.service_type ? ' (' + prev.service_type + ')' : ''} fue reprogramada.\n\nAntes: ${prevDisplay}\nAhora: ${newDisplay}\n\nActualización automática desde el asistente de voz.`;
        try {
          await supabase.from('appointment_notifications').insert({
            appointment_id, tenant_id: updated.tenant_id,
            target_user_id: updated.user_id,
            notification_type: 'staff_update',
            status: 'pending',
            scheduled_at: new Date().toISOString(),
            message_body: msg,
          });
        } catch (nErr) { console.warn('[voice-scheduling] notify insert failed:', nErr); }
      }

      const dateStrR = formatInTimezone(newStart, tzR, { weekday: 'long', day: 'numeric', month: 'long' });
      const timeStrR = formatInTimezone(newStart, tzR, { hour: '2-digit', minute: '2-digit', hour12: true });
      return jsonResp({
        success: true,
        appointment: updated,
        message: `Cita de ${updated.contact_name} reprogramada para ${dateStrR} a las ${timeStrR}`,
      });
    }

    // ─── CANCEL ───
    if (action === 'cancel_appointment') {
      const { appointment_id } = data;
      if (!appointment_id) {
        return jsonResp({ error: 'Missing appointment_id' }, 400);
      }

      let cancelled: any = null;
      try {
        const { data: cRow, error: cancelErr } = await supabase
          .from('appointments')
          .update({ status: 'cancelled' })
          .eq('id', appointment_id)
          .select('id, contact_name, tenant_id, user_id, start_at, service_type')
          .maybeSingle();
        if (cancelErr) throw cancelErr;
        cancelled = cRow;
      } catch (e) {
        console.error('[voice-scheduling] cancel update error:', e);
        return jsonResp({
          success: false,
          message: 'No pude cancelar la cita en este momento. ¿Podemos intentar de nuevo?',
        });
      }
      if (!cancelled?.id) {
        return jsonResp({
          success: false,
          message: 'No encontré esa cita para cancelarla.',
        });
      }

      // Fire-and-forget Google Calendar mirror
      detach(fetch(`${SUPABASE_URL}/functions/v1/calendar-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ action: 'cancel_event', appointment_id }),
      }).then(() => undefined));

      if (cancelled.user_id) {
        const tzC = await resolveTenantTimezone(supabase, cancelled.tenant_id);
        const when = cancelled.start_at
          ? formatInTimezone(new Date(cancelled.start_at), tzC, { dateStyle: 'full', timeStyle: 'short' })
          : '';
        const msg = `La cita con ${cancelled.contact_name}${cancelled.service_type ? ' (' + cancelled.service_type + ')' : ''} programada para ${when} fue CANCELADA por el cliente.\n\nActualización automática desde el asistente de voz.`;
        try {
          await supabase.from('appointment_notifications').insert({
            appointment_id, tenant_id: cancelled.tenant_id,
            target_user_id: cancelled.user_id,
            notification_type: 'staff_update',
            status: 'pending',
            scheduled_at: new Date().toISOString(),
            message_body: msg,
          });
        } catch (nErr) { console.warn('[voice-scheduling] cancel notify insert failed:', nErr); }
      }

      return jsonResp({
        success: true,
        message: `Cita de ${cancelled.contact_name} cancelada exitosamente`,
      });
    }

    // ─── CONFIRM ───
    if (action === 'confirm_appointment') {
      const { appointment_id } = data;
      if (!appointment_id) {
        return jsonResp({ error: 'Missing appointment_id' }, 400);
      }
      let confirmed: any = null;
      try {
        const { data: cRow, error: confErr } = await supabase
          .from('appointments')
          .update({ status: 'confirmed' })
          .eq('id', appointment_id)
          .select('id, contact_name')
          .maybeSingle();
        if (confErr) throw confErr;
        confirmed = cRow;
      } catch (e) {
        console.error('[voice-scheduling] confirm update error:', e);
        return jsonResp({
          success: false,
          message: 'No pude confirmar la cita en este momento. ¿Podemos intentar de nuevo?',
        });
      }
      if (!confirmed?.id) {
        return jsonResp({
          success: false,
          message: 'No encontré esa cita para confirmarla.',
        });
      }
      return jsonResp({
        success: true,
        message: `Cita de ${confirmed.contact_name} confirmada`,
      });
    }




    // ─── LIST EMPLOYEES ───
    if (action === 'list_employees') {
      const { tenant_id } = data;
      const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('user_id, name, email, phone')
        .eq('tenant_id', tenant_id)
        .eq('status', 'active');

      if (profErr) throw profErr;

      return jsonResp({
        employees: (profiles || []).map(p => ({
          id: p.user_id,
          name: p.name,
          email: p.email,
          phone: p.phone,
        })),
      });
    }

    return jsonResp({ error: 'Unknown action' }, 400);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('voice-scheduling error:', msg);
    return jsonResp({ error: msg }, 500);
  }
});

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
      'Content-Type': 'application/json',
    },
  });
}

// Returns UTC offset string for common Mexican timezones
function getTzOffset(tz: string): string {
  const offsets: Record<string, string> = {
    'America/Mexico_City': '-06:00',
    'America/Monterrey': '-06:00',
    'America/Merida': '-06:00',
    'America/Cancun': '-05:00',
    'America/Chihuahua': '-06:00',
    'America/Mazatlan': '-07:00',
    'America/Hermosillo': '-07:00',
    'America/Tijuana': '-08:00',
    'America/Bogota': '-05:00',
    'America/Lima': '-05:00',
    'America/Santiago': '-03:00',
    'America/Buenos_Aires': '-03:00',
    'America/Sao_Paulo': '-03:00',
    'America/New_York': '-05:00',
    'America/Chicago': '-06:00',
    'America/Denver': '-07:00',
    'America/Los_Angeles': '-08:00',
    'Europe/Madrid': '+01:00',
    'UTC': '+00:00',
  };
  return offsets[tz] || '-06:00'; // Default to Mexico City
}

// Push a booking to Cal.com using the tenant-level integration.
// Uses the tenant's default_event_type_id so employees without a per-user Cal.com
// sync still book against the main tenant calendar (single source of truth).
async function pushToCalcom(
  supabase: any,
  tenantId: string,
  args: { appointment_id: string; start_iso: string; contact_name: string; contact_email: string; timezone: string; source: string },
): Promise<{ calcom_uid?: string; conflict?: boolean; error?: string } | null> {
  const { data: integ } = await supabase
    .from('calcom_integrations')
    .select('api_key_encrypted, default_event_type_id, status')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .maybeSingle();
  if (!integ?.api_key_encrypted || !integ?.default_event_type_id) return null;

  const secret = Deno.env.get('CREDENTIALS_ENCRYPTION_KEY');
  if (!secret) return null;
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

  const res = await fetch('https://api.cal.com/v2/bookings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'cal-api-version': '2024-08-13',
    },
    body: JSON.stringify({
      eventTypeId: Number(integ.default_event_type_id),
      start: args.start_iso,
      attendee: { name: args.contact_name, email: args.contact_email, timeZone: args.timezone, language: 'es' },
      metadata: { source: args.source, appointment_id: args.appointment_id },
    }),
  });

  if (res.ok) {
    const j = await res.json();
    return { calcom_uid: j?.data?.uid || j?.uid };
  }
  const body = (await res.text()).slice(0, 300);
  const snippet = body.toLowerCase();
  const conflict = /already has booking|not available|no_available_users|no available|time conflict/.test(snippet);
  return { conflict, error: body.slice(0, 180) };
}
