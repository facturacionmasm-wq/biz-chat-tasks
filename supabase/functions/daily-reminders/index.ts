import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

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
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    return new Response(JSON.stringify({ error: 'Twilio not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Get all active employees with WhatsApp numbers
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, name, whatsapp_number, tenant_id')
      .eq('status', 'active')
      .not('whatsapp_number', 'is', null);

    if (!profiles || profiles.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, message: 'No employees with WhatsApp numbers' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const today = new Date().toISOString().split('T')[0];
    let sentCount = 0;

    for (const profile of profiles) {
      // Check tenant quiet hours
      const { data: tenant } = await supabase
        .from('tenants')
        .select('notification_rules, timezone')
        .eq('id', profile.tenant_id)
        .single();

      // Fetch today's appointments
      const { data: appointments } = await supabase
        .from('appointments')
        .select('start_at, end_at, contact_name, service_type, status')
        .eq('user_id', profile.user_id)
        .eq('tenant_id', profile.tenant_id)
        .gte('start_at', `${today}T00:00:00`)
        .lte('start_at', `${today}T23:59:59`)
        .neq('status', 'cancelled')
        .order('start_at');

      // Fetch pending expenses (optional summary)
      const { count: pendingExpenses } = await supabase
        .from('expenses')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.user_id)
        .eq('status', 'pending');

      // Build message
      const parts: string[] = [];
      parts.push(`☀️ *Buenos días, ${profile.name}!*`);
      parts.push(`📅 *Resumen del día - ${new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}*\n`);

      // Appointments section
      if (appointments && appointments.length > 0) {
        parts.push(`📋 *Tienes ${appointments.length} cita${appointments.length > 1 ? 's' : ''} hoy:*`);
        for (const apt of appointments) {
          const time = new Date(apt.start_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
          const endTime = new Date(apt.end_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
          parts.push(`  • ${time}-${endTime} — ${apt.contact_name} (${apt.service_type || 'General'})`);
        }
      } else {
        parts.push('📋 No tienes citas programadas para hoy.');
      }

      // Pending expenses
      if (pendingExpenses && pendingExpenses > 0) {
        parts.push(`\n💰 Tienes *${pendingExpenses} gasto${pendingExpenses > 1 ? 's' : ''}* pendiente${pendingExpenses > 1 ? 's' : ''} de aprobación.`);
      }

      parts.push('\n_Responde a este mensaje para interactuar conmigo. Soy Aria, tu asistente._ 🤖');

      const message = parts.join('\n');

      // Send via Twilio
      try {
        const fromWhatsApp = TWILIO_PHONE_NUMBER.startsWith('whatsapp:') ? TWILIO_PHONE_NUMBER : `whatsapp:${TWILIO_PHONE_NUMBER}`;
        const toWhatsApp = profile.whatsapp_number!.startsWith('whatsapp:') ? profile.whatsapp_number! : `whatsapp:${profile.whatsapp_number}`;
        const basicAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${basicAuth}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              From: fromWhatsApp,
              To: toWhatsApp,
              Body: message,
            }).toString(),
          }
        );

        const data = await res.json();
        if (res.ok) {
          sentCount++;
          console.log(`Reminder sent to ${profile.name} (${profile.whatsapp_number})`);

          // Find or create conversation to save the message
          let { data: conv } = await supabase
            .from('whatsapp_conversations')
            .select('id')
            .eq('contact_phone', profile.whatsapp_number)
            .eq('tenant_id', profile.tenant_id)
            .neq('status', 'closed')
            .limit(1)
            .maybeSingle();

          if (!conv) {
            const { data: newConv } = await supabase
              .from('whatsapp_conversations')
              .insert({
                tenant_id: profile.tenant_id,
                contact_phone: profile.whatsapp_number!,
                contact_name: profile.name,
                status: 'open',
                verified_user_id: profile.user_id,
                bot_state: 'employee_mode',
                bot_context: { role: 'employee', user_id: profile.user_id, user_name: profile.name },
              })
              .select('id')
              .single();
            conv = newConv;
          }

          if (conv) {
            await supabase.from('whatsapp_messages').insert({
              tenant_id: profile.tenant_id,
              conversation_id: conv.id,
              direction: 'out',
              body: message,
              status: 'sent',
              metadata: { provider: 'daily-reminder', message_sid: data.sid },
            });
          }
        } else {
          console.error(`Failed to send to ${profile.name}:`, JSON.stringify(data));
        }
      } catch (sendErr) {
        console.error(`Error sending to ${profile.name}:`, sendErr);
      }
    }

    return new Response(JSON.stringify({ ok: true, sent: sentCount, total: profiles.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Daily reminders error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
