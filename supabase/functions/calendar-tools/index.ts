import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

interface CalendarAction {
  action: 'list_events' | 'create_event' | 'update_event' | 'delete_event' | 'get_event';
  // list_events
  time_min?: string;
  time_max?: string;
  max_results?: number;
  query?: string;
  // create/update event
  summary?: string;
  description?: string;
  start_datetime?: string;
  end_datetime?: string;
  location?: string;
  attendees?: string[];
  // update/delete/get event
  event_id?: string;
}

async function refreshAccessToken(
  supabase: any,
  tokenRow: any,
): Promise<string> {
  const now = new Date();
  const expires = new Date(tokenRow.token_expires_at);

  // Return current token if still valid (with 5min buffer)
  if (expires.getTime() - now.getTime() > 5 * 60 * 1000) {
    return tokenRow.access_token;
  }

  const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
  const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;

  if (!tokenRow.refresh_token) {
    throw new Error('No refresh token available. User must reconnect Google Calendar.');
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: tokenRow.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    console.error('Token refresh failed:', JSON.stringify(data));
    // Mark token as expired
    await supabase
      .from('google_calendar_tokens')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', tokenRow.id);
    throw new Error('Google Calendar token expired. User must reconnect.');
  }

  const newExpires = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
  await supabase
    .from('google_calendar_tokens')
    .update({
      access_token: data.access_token,
      token_expires_at: newExpires,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tokenRow.id);

  return data.access_token;
}

async function callGoogleCalendar(
  accessToken: string,
  calendarId: string,
  action: CalendarAction,
): Promise<any> {
  const cal = encodeURIComponent(calendarId);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  switch (action.action) {
    case 'list_events': {
      const params = new URLSearchParams();
      params.set('singleEvents', 'true');
      params.set('orderBy', 'startTime');
      params.set('maxResults', String(action.max_results || 10));
      if (action.time_min) params.set('timeMin', action.time_min);
      else params.set('timeMin', new Date().toISOString());
      if (action.time_max) params.set('timeMax', action.time_max);
      if (action.query) params.set('q', action.query);

      const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${cal}/events?${params}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(`Google API error: ${JSON.stringify(data.error)}`);
      return {
        events: (data.items || []).map((e: any) => ({
          id: e.id,
          summary: e.summary || '(Sin título)',
          description: e.description || '',
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date,
          location: e.location || '',
          status: e.status,
          attendees: (e.attendees || []).map((a: any) => a.email),
          htmlLink: e.htmlLink,
        })),
        count: (data.items || []).length,
      };
    }

    case 'get_event': {
      if (!action.event_id) throw new Error('event_id is required');
      const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${cal}/events/${action.event_id}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(`Google API error: ${JSON.stringify(data.error)}`);
      return {
        id: data.id,
        summary: data.summary,
        description: data.description,
        start: data.start?.dateTime || data.start?.date,
        end: data.end?.dateTime || data.end?.date,
        location: data.location,
        attendees: (data.attendees || []).map((a: any) => a.email),
        htmlLink: data.htmlLink,
      };
    }

    case 'create_event': {
      if (!action.summary) throw new Error('summary is required');
      if (!action.start_datetime) throw new Error('start_datetime is required');
      if (!action.end_datetime) throw new Error('end_datetime is required');

      const body: any = {
        summary: action.summary,
        start: { dateTime: action.start_datetime, timeZone: 'America/Mexico_City' },
        end: { dateTime: action.end_datetime, timeZone: 'America/Mexico_City' },
      };
      if (action.description) body.description = action.description;
      if (action.location) body.location = action.location;
      if (action.attendees?.length) {
        body.attendees = action.attendees.map(email => ({ email }));
      }

      const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${cal}/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`Google API error: ${JSON.stringify(data.error)}`);
      return {
        id: data.id,
        summary: data.summary,
        start: data.start?.dateTime,
        end: data.end?.dateTime,
        htmlLink: data.htmlLink,
        status: 'created',
      };
    }

    case 'update_event': {
      if (!action.event_id) throw new Error('event_id is required');

      const body: any = {};
      if (action.summary) body.summary = action.summary;
      if (action.description !== undefined) body.description = action.description;
      if (action.start_datetime) body.start = { dateTime: action.start_datetime, timeZone: 'America/Mexico_City' };
      if (action.end_datetime) body.end = { dateTime: action.end_datetime, timeZone: 'America/Mexico_City' };
      if (action.location !== undefined) body.location = action.location;
      if (action.attendees) body.attendees = action.attendees.map(email => ({ email }));

      const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${cal}/events/${action.event_id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`Google API error: ${JSON.stringify(data.error)}`);
      return {
        id: data.id,
        summary: data.summary,
        start: data.start?.dateTime,
        end: data.end?.dateTime,
        htmlLink: data.htmlLink,
        status: 'updated',
      };
    }

    case 'delete_event': {
      if (!action.event_id) throw new Error('event_id is required');

      const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${cal}/events/${action.event_id}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Google API error: ${text}`);
      }
      return { event_id: action.event_id, status: 'deleted' };
    }

    default:
      throw new Error(`Unknown action: ${action.action}`);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // Validate caller — accept both user JWT and service-role calls
  let userId: string;
  const isServiceCall = req.headers.get('X-Service-Call') === 'true';
  
  if (isServiceCall) {
    // Called internally from ai-assistant edge function
    const body = await req.json();
    userId = body.user_id;
    if (!userId) {
      return new Response(JSON.stringify({ error: 'user_id required for service calls' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return await handleAction(supabase, userId, body);
  }

  // Regular user call
  const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claims, error: claimsErr } = await anonClient.auth.getClaims(authHeader.replace('Bearer ', ''));
  if (claimsErr || !claims?.claims?.sub) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  userId = claims.claims.sub as string;
  const body = await req.json();

  return await handleAction(supabase, userId, body);
});

async function handleAction(supabase: any, userId: string, body: any): Promise<Response> {
  try {
    const action: CalendarAction = body;

    // Get user's calendar token
    const { data: tokenRow, error: tokenErr } = await supabase
      .from('google_calendar_tokens')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (tokenErr || !tokenRow) {
      return new Response(JSON.stringify({
        error: 'Google Calendar no está conectado. Ve a Configuración → Google Calendar para conectar tu cuenta.',
        calendar_not_connected: true,
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await refreshAccessToken(supabase, tokenRow);
    const calendarId = tokenRow.calendar_id || 'primary';
    const result = await callGoogleCalendar(accessToken, calendarId, action);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('calendar-tools error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
