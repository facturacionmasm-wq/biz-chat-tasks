// Calendar sync engine: create/update/delete Google Calendar events + retry worker
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
  const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const { action } = body;

    // ─── SYNC SINGLE APPOINTMENT ───
    if (action === 'sync_appointment') {
      const { appointment_id } = body;
      const result = await syncAppointment(supabase, appointment_id, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
      return jsonResp(result);
    }

    // ─── RETRY PENDING ─── (called by cron)
    if (action === 'retry_pending') {
      const result = await retryPending(supabase, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
      return jsonResp(result);
    }

    // ─── UPDATE EVENT ───
    if (action === 'update_event') {
      const { appointment_id } = body;
      const result = await updateCalendarEvent(supabase, appointment_id, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
      return jsonResp(result);
    }

    // ─── DELETE/CANCEL EVENT ───
    if (action === 'cancel_event') {
      const { appointment_id } = body;
      const result = await cancelCalendarEvent(supabase, appointment_id, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
      return jsonResp(result);
    }

    // ─── HEALTH CHECK ───
    if (action === 'health_check') {
      const { user_id, tenant_id } = body;
      const result = await healthCheck(supabase, user_id, tenant_id, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
      return jsonResp(result);
    }

    return jsonResp({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('calendar-sync error:', err);
    return jsonResp({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

// ==================== Core sync logic ====================

async function syncAppointment(
  supabase: any,
  appointmentId: string,
  clientId: string,
  clientSecret: string,
): Promise<any> {
  const correlationId = crypto.randomUUID().slice(0, 8);
  console.log(`[${correlationId}] Syncing appointment ${appointmentId}`);

  // Get appointment
  const { data: apt, error: aptErr } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .single();

  if (aptErr || !apt) {
    console.error(`[${correlationId}] Appointment not found:`, aptErr);
    return { error: 'Appointment not found', correlationId };
  }

  // Already synced?
  if (apt.calendar_event_id && apt.calendar_sync_status === 'SYNCED') {
    console.log(`[${correlationId}] Already synced: ${apt.calendar_event_id}`);
    return { success: true, event_id: apt.calendar_event_id, already_synced: true, correlationId };
  }

  // Find user with calendar tokens — use the assigned employee's calendar
  let userId = apt.user_id;
  if (!userId) {
    // No user assigned — try to find employee from availability rules for this time slot
    const aptDate = new Date(apt.start_at);
    const dayOfWeek = aptDate.getDay();

    const { data: matchingRules } = await supabase
      .from('availability_rules')
      .select('user_id')
      .eq('tenant_id', apt.tenant_id)
      .eq('day_of_week', dayOfWeek)
      .eq('active', true)
      .not('user_id', 'is', null)
      .limit(5);

    if (matchingRules && matchingRules.length > 0) {
      // Find first employee with active Google Calendar token
      for (const rule of matchingRules) {
        const { data: gcalToken } = await supabase
          .from('google_calendar_tokens')
          .select('user_id')
          .eq('user_id', rule.user_id)
          .eq('tenant_id', apt.tenant_id)
          .eq('status', 'active')
          .maybeSingle();
        if (gcalToken) {
          userId = rule.user_id;
          console.log(`[${correlationId}] Assigned employee ${userId} from availability rules`);
          await supabase.from('appointments').update({ user_id: userId }).eq('id', appointmentId);
          break;
        }
      }
    }

    if (!userId) {
      await updateSyncStatus(supabase, appointmentId, 'PENDING_SYNC', 'No employee with Google Calendar found for this time slot');
      return { error: 'No employee with Google Calendar found', correlationId };
    }
  }

  // Get tokens
  const tokenResult = await getValidToken(supabase, userId, apt.tenant_id, clientId, clientSecret);
  if (tokenResult.error) {
    const status = tokenResult.auth_required ? 'AUTH_REQUIRED' : 'FAILED_SYNC';
    await updateSyncStatus(supabase, appointmentId, status, tokenResult.error);
    return { error: tokenResult.error, status, correlationId };
  }

  // Get tenant timezone
  const { data: tenant } = await supabase
    .from('tenants')
    .select('timezone')
    .eq('id', apt.tenant_id)
    .single();
  const tz = tenant?.timezone || 'America/Mexico_City';

  // Build event payload
  const event = {
    summary: `${apt.service_type || 'Cita'} - ${apt.contact_name}`,
    description: [
      `Cliente: ${apt.contact_name}`,
      apt.contact_phone ? `Tel: ${apt.contact_phone}` : '',
      apt.contact_email ? `Email: ${apt.contact_email}` : '',
      apt.notes ? `Notas: ${apt.notes}` : '',
      `Fuente: ${apt.source || 'app'}`,
      `ID: ${apt.id}`,
    ].filter(Boolean).join('\n'),
    start: {
      dateTime: apt.start_at,
      timeZone: tz,
    },
    end: {
      dateTime: apt.end_at,
      timeZone: tz,
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 30 },
      ],
    },
  };

  const calendarId = tokenResult.calendar_id || 'primary';

  console.log(`[${correlationId}] Creating event in calendar ${calendarId}`);

  try {
    const res = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenResult.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      },
    );

    const resData = await res.json();

    if (!res.ok) {
      console.error(`[${correlationId}] Google API error ${res.status}:`, JSON.stringify(resData));
      const status = res.status === 401 || res.status === 403 ? 'AUTH_REQUIRED' : 'FAILED_SYNC';
      await updateSyncStatus(supabase, appointmentId, status, `Google API ${res.status}: ${resData.error?.message || 'unknown'}`);

      if (res.status === 401) {
        // Mark tokens as needing refresh
        await supabase
          .from('google_calendar_tokens')
          .update({ status: 'auth_required' })
          .eq('user_id', userId)
          .eq('tenant_id', apt.tenant_id);
      }

      return { error: resData.error?.message || 'Google API error', status: res.status, correlationId };
    }

    // Success! Save event ID
    const eventId = resData.id;
    console.log(`[${correlationId}] Event created: ${eventId}`);

    await supabase
      .from('appointments')
      .update({
        calendar_event_id: eventId,
        calendar_sync_status: 'SYNCED',
        calendar_sync_error: null,
        last_sync_attempt: new Date().toISOString(),
      })
      .eq('id', appointmentId);

    // Audit
    await supabase.from('audit_events').insert({
      tenant_id: apt.tenant_id,
      event_type: 'calendar_event_created',
      actor_id: userId,
      resource_type: 'appointments',
      resource_id: appointmentId,
      payload: { event_id: eventId, calendar_id: calendarId, correlation_id: correlationId },
    });

    return { success: true, event_id: eventId, correlationId };
  } catch (err) {
    console.error(`[${correlationId}] Network error:`, err);
    await updateSyncStatus(supabase, appointmentId, 'FAILED_SYNC', `Network error: ${err instanceof Error ? err.message : 'unknown'}`);
    return { error: 'Network error', correlationId };
  }
}

async function updateCalendarEvent(
  supabase: any,
  appointmentId: string,
  clientId: string,
  clientSecret: string,
): Promise<any> {
  const { data: apt } = await supabase.from('appointments').select('*').eq('id', appointmentId).single();
  if (!apt || !apt.calendar_event_id || !apt.user_id) {
    return { error: 'No event to update' };
  }

  const tokenResult = await getValidToken(supabase, apt.user_id, apt.tenant_id, clientId, clientSecret);
  if (tokenResult.error) return { error: tokenResult.error };

  const { data: tenant } = await supabase.from('tenants').select('timezone').eq('id', apt.tenant_id).single();
  const tz = tenant?.timezone || 'America/Mexico_City';
  const calendarId = tokenResult.calendar_id || 'primary';

  const event = {
    summary: `${apt.service_type || 'Cita'} - ${apt.contact_name}`,
    description: `Cliente: ${apt.contact_name}\nTel: ${apt.contact_phone || 'N/A'}\nID: ${apt.id}`,
    start: { dateTime: apt.start_at, timeZone: tz },
    end: { dateTime: apt.end_at, timeZone: tz },
  };

  const res = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${apt.calendar_event_id}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenResult.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    },
  );
  const resBody = await res.text();
  if (!res.ok) return { error: `Update failed: ${res.status}` };
  return { success: true };
}

async function cancelCalendarEvent(
  supabase: any,
  appointmentId: string,
  clientId: string,
  clientSecret: string,
): Promise<any> {
  const { data: apt } = await supabase.from('appointments').select('*').eq('id', appointmentId).single();
  if (!apt || !apt.calendar_event_id || !apt.user_id) {
    return { error: 'No event to cancel' };
  }

  const tokenResult = await getValidToken(supabase, apt.user_id, apt.tenant_id, clientId, clientSecret);
  if (tokenResult.error) return { error: tokenResult.error };

  const calendarId = tokenResult.calendar_id || 'primary';

  const res = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${apt.calendar_event_id}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenResult.access_token}` },
    },
  );
  // 204 or 410 (already deleted) are both fine
  const body = res.status !== 204 ? await res.text() : '';
  if (res.ok || res.status === 410) {
    await supabase.from('appointments').update({ calendar_sync_status: 'CANCELLED' }).eq('id', appointmentId);
    return { success: true };
  }
  return { error: `Delete failed: ${res.status}` };
}

// ==================== Retry worker ====================

async function retryPending(
  supabase: any,
  clientId: string,
  clientSecret: string,
): Promise<any> {
  // Get appointments that need sync (max 20 per batch)
  const { data: pending } = await supabase
    .from('appointments')
    .select('id, sync_attempts')
    .in('calendar_sync_status', ['PENDING_SYNC', 'FAILED_SYNC'])
    .neq('status', 'cancelled')
    .is('deleted_at', null)
    .lt('sync_attempts', 10)
    .order('last_sync_attempt', { ascending: true, nullsFirst: true })
    .limit(20);

  if (!pending || pending.length === 0) {
    return { processed: 0, message: 'No pending appointments' };
  }

  console.log(`Retrying ${pending.length} pending appointments`);

  const results = [];
  for (const apt of pending) {
    // Exponential backoff check
    const { data: fullApt } = await supabase
      .from('appointments')
      .select('last_sync_attempt, sync_attempts')
      .eq('id', apt.id)
      .single();

    if (fullApt?.last_sync_attempt) {
      const lastAttempt = new Date(fullApt.last_sync_attempt).getTime();
      const backoffMs = Math.min(60000 * Math.pow(2, fullApt.sync_attempts), 3600000); // max 1h
      if (Date.now() - lastAttempt < backoffMs) {
        results.push({ id: apt.id, skipped: true, reason: 'backoff' });
        continue;
      }
    }

    // Increment attempt counter
    await supabase
      .from('appointments')
      .update({
        sync_attempts: (fullApt?.sync_attempts || 0) + 1,
        last_sync_attempt: new Date().toISOString(),
      })
      .eq('id', apt.id);

    const result = await syncAppointment(supabase, apt.id, clientId, clientSecret);
    results.push({ id: apt.id, ...result });
  }

  return { processed: results.length, results };
}

// ==================== Health check ====================

async function healthCheck(
  supabase: any,
  userId: string,
  tenantId: string,
  clientId: string,
  clientSecret: string,
): Promise<any> {
  const tokenResult = await getValidToken(supabase, userId, tenantId, clientId, clientSecret);
  if (tokenResult.error) {
    return { healthy: false, error: tokenResult.error, auth_required: tokenResult.auth_required };
  }

  // List calendars
  try {
    const res = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, {
      headers: { Authorization: `Bearer ${tokenResult.access_token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      return { healthy: false, error: `Google API ${res.status}: ${data.error?.message}` };
    }

    const calendars = (data.items || []).map((c: any) => ({
      id: c.id,
      summary: c.summary,
      accessRole: c.accessRole,
      primary: c.primary || false,
    }));

    const activeCalId = tokenResult.calendar_id || 'primary';
    const activeCalendar = calendars.find((c: any) => c.id === activeCalId || (activeCalId === 'primary' && c.primary));
    const canWrite = activeCalendar ? ['writer', 'owner'].includes(activeCalendar.accessRole) : false;

    return {
      healthy: canWrite,
      calendars,
      active_calendar: activeCalId,
      can_write: canWrite,
      email: tokenResult.email,
    };
  } catch (err) {
    return { healthy: false, error: 'Network error checking Google Calendar' };
  }
}

// ==================== Token management ====================

async function getValidToken(
  supabase: any,
  userId: string,
  tenantId: string,
  clientId: string,
  clientSecret: string,
): Promise<{ access_token?: string; calendar_id?: string; email?: string; error?: string; auth_required?: boolean }> {
  const { data: tokenRow, error: tokenErr } = await supabase
    .from('google_calendar_tokens')
    .select('*')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .single();

  if (tokenErr || !tokenRow) {
    return { error: 'No Google Calendar tokens found. User needs to connect Calendar.', auth_required: true };
  }

  if (tokenRow.status === 'auth_required') {
    return { error: 'Google Calendar authorization expired. User needs to reconnect.', auth_required: true };
  }

  // Check if token expires within 5 minutes
  const expiresAt = new Date(tokenRow.token_expires_at);
  if (expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
    // Token still valid
    return { access_token: tokenRow.access_token, calendar_id: tokenRow.calendar_id, email: tokenRow.email };
  }

  // Refresh token
  if (!tokenRow.refresh_token) {
    await supabase
      .from('google_calendar_tokens')
      .update({ status: 'auth_required' })
      .eq('id', tokenRow.id);
    return { error: 'No refresh token available. User needs to reconnect.', auth_required: true };
  }

  console.log(`Refreshing token for user ${userId}`);

  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenRow.refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.access_token) {
      console.error('Token refresh failed:', JSON.stringify(data));
      // invalid_grant = refresh token revoked
      if (data.error === 'invalid_grant') {
        await supabase
          .from('google_calendar_tokens')
          .update({ status: 'auth_required' })
          .eq('id', tokenRow.id);
        return { error: 'Google authorization revoked. User needs to reconnect.', auth_required: true };
      }
      return { error: `Token refresh failed: ${data.error_description || data.error}` };
    }

    // Update tokens
    const newExpiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
    await supabase
      .from('google_calendar_tokens')
      .update({
        access_token: data.access_token,
        refresh_token: data.refresh_token || tokenRow.refresh_token,
        token_expires_at: newExpiresAt,
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', tokenRow.id);

    return { access_token: data.access_token, calendar_id: tokenRow.calendar_id, email: tokenRow.email };
  } catch (err) {
    console.error('Token refresh network error:', err);
    return { error: 'Network error refreshing token' };
  }
}

// ==================== Utils ====================

async function updateSyncStatus(supabase: any, appointmentId: string, status: string, error?: string) {
  await supabase
    .from('appointments')
    .update({
      calendar_sync_status: status,
      calendar_sync_error: error || null,
      last_sync_attempt: new Date().toISOString(),
      sync_attempts: supabase.rpc ? undefined : undefined, // incremented separately
    })
    .eq('id', appointmentId);
}

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Content-Type': 'application/json',
    },
  });
}
