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
    const now = new Date().toISOString();

    // Get pending reminders that are due
    const { data: reminders, error: fetchErr } = await supabase
      .from('reminders')
      .select('id, user_id, tenant_id, message, remind_at')
      .eq('status', 'pending')
      .lte('remind_at', now)
      .order('remind_at')
      .limit(50);

    if (fetchErr) throw fetchErr;

    if (!reminders || reminders.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, message: 'No pending reminders' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let sentCount = 0;

    for (const reminder of reminders) {
      // Get user's WhatsApp number
      const { data: profile } = await supabase
        .from('profiles')
        .select('name, whatsapp_number')
        .eq('user_id', reminder.user_id)
        .eq('tenant_id', reminder.tenant_id)
        .maybeSingle();

      if (!profile?.whatsapp_number) {
        // Mark as sent anyway to avoid retrying forever
        await supabase.from('reminders').update({ status: 'no_phone', sent_at: now }).eq('id', reminder.id);
        continue;
      }

      const reminderMsg = `⏰ *Recordatorio de Aria*\n\n${reminder.message}\n\n_Este recordatorio fue programado por ti._`;

      try {
        const fromWA = TWILIO_PHONE_NUMBER.startsWith('whatsapp:') ? TWILIO_PHONE_NUMBER : `whatsapp:${TWILIO_PHONE_NUMBER}`;
        const toWA = profile.whatsapp_number.startsWith('whatsapp:') ? profile.whatsapp_number : `whatsapp:${profile.whatsapp_number}`;
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
              From: fromWA,
              To: toWA,
              Body: reminderMsg,
            }).toString(),
          }
        );

        const data = await res.json();
        if (res.ok) {
          sentCount++;
          console.log(`Reminder sent to ${profile.name}: "${reminder.message}"`);

          await supabase.from('reminders').update({ status: 'sent', sent_at: now }).eq('id', reminder.id);

          // Save to WhatsApp messages
          const { data: conv } = await supabase
            .from('whatsapp_conversations')
            .select('id')
            .eq('contact_phone', profile.whatsapp_number)
            .eq('tenant_id', reminder.tenant_id)
            .neq('status', 'closed')
            .limit(1)
            .maybeSingle();

          if (conv) {
            await supabase.from('whatsapp_messages').insert({
              tenant_id: reminder.tenant_id,
              conversation_id: conv.id,
              direction: 'out',
              body: reminderMsg,
              status: 'sent',
              metadata: { provider: 'reminder', reminder_id: reminder.id },
            });
          }
        } else {
          console.error(`Failed to send reminder to ${profile.name}:`, JSON.stringify(data));
          await supabase.from('reminders').update({ status: 'failed' }).eq('id', reminder.id);
        }
      } catch (sendErr) {
        console.error(`Error sending reminder:`, sendErr);
        await supabase.from('reminders').update({ status: 'failed' }).eq('id', reminder.id);
      }
    }

    return new Response(JSON.stringify({ ok: true, sent: sentCount, total: reminders.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Send reminders error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
