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

    // Get pending reminders that are due (including retryable failed ones)
    const { data: reminders, error: fetchErr } = await supabase
      .from('reminders')
      .select('id, user_id, tenant_id, message, remind_at, retry_count, max_retries, status')
      .or('status.eq.pending,and(status.eq.failed,retry_count.lt.max_retries)')
      .lte('remind_at', now)
      .order('remind_at')
      .limit(50);

    if (fetchErr) throw fetchErr;

    if (!reminders || reminders.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, message: 'No pending reminders' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Filter failed ones that haven't exceeded max retries
    const eligibleReminders = reminders.filter((r: any) => {
      if (r.status === 'pending') return true;
      if (r.status === 'failed' && r.retry_count < (r.max_retries || 3)) return true;
      return false;
    });

    console.log(`Processing ${eligibleReminders.length} reminders (${reminders.length} total found)`);

    let sentCount = 0;
    const results: any[] = [];

    for (const reminder of eligibleReminders) {
      // Get user's WhatsApp number
      const { data: profile } = await supabase
        .from('profiles')
        .select('name, whatsapp_number')
        .eq('user_id', reminder.user_id)
        .eq('tenant_id', reminder.tenant_id)
        .maybeSingle();

      if (!profile?.whatsapp_number) {
        await supabase.from('reminders').update({ 
          status: 'no_phone', 
          sent_at: now,
          error_message: 'El usuario no tiene número de WhatsApp configurado',
        }).eq('id', reminder.id);
        results.push({ id: reminder.id, status: 'no_phone' });
        continue;
      }

      // Validate phone number format
      const phone = profile.whatsapp_number.replace(/\s/g, '');
      if (!/^\+?\d{10,15}$/.test(phone.replace('whatsapp:', ''))) {
        await supabase.from('reminders').update({ 
          status: 'failed',
          error_message: `Número inválido: ${phone}`,
          retry_count: (reminder.retry_count || 0) + 1,
        }).eq('id', reminder.id);
        results.push({ id: reminder.id, status: 'invalid_phone' });
        continue;
      }

      const reminderMsg = `⏰ *Recordatorio de Aria*\n\n${reminder.message}\n\n_Este recordatorio fue programado por ti._`;

      try {
        const fromWA = TWILIO_PHONE_NUMBER.startsWith('whatsapp:') ? TWILIO_PHONE_NUMBER : `whatsapp:${TWILIO_PHONE_NUMBER}`;
        const toWA = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
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
          console.log(`✅ Reminder sent to ${profile.name}: "${reminder.message}" (id=${reminder.id})`);

          await supabase.from('reminders').update({ 
            status: 'sent', 
            sent_at: now,
            error_message: null,
          }).eq('id', reminder.id);

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
              metadata: { provider: 'reminder', reminder_id: reminder.id, message_sid: data.sid },
            });
          }

          results.push({ id: reminder.id, status: 'sent', sid: data.sid });
        } else {
          const errorMsg = data.message || data.error_message || `Twilio error ${data.code}`;
          console.error(`❌ Failed to send reminder to ${profile.name}: ${errorMsg}`);
          
          const newRetryCount = (reminder.retry_count || 0) + 1;
          const maxRetries = reminder.max_retries || 3;
          
          await supabase.from('reminders').update({ 
            status: newRetryCount >= maxRetries ? 'failed' : 'failed',
            error_message: errorMsg,
            retry_count: newRetryCount,
          }).eq('id', reminder.id);

          results.push({ id: reminder.id, status: 'failed', error: errorMsg, retry: `${newRetryCount}/${maxRetries}` });
        }
      } catch (sendErr) {
        const errorMsg = sendErr instanceof Error ? sendErr.message : 'Unknown send error';
        console.error(`❌ Error sending reminder ${reminder.id}:`, errorMsg);
        
        await supabase.from('reminders').update({ 
          status: 'failed',
          error_message: errorMsg,
          retry_count: (reminder.retry_count || 0) + 1,
        }).eq('id', reminder.id);

        results.push({ id: reminder.id, status: 'error', error: errorMsg });
      }
    }

    console.log(`Reminder batch complete: ${sentCount}/${eligibleReminders.length} sent`);

    return new Response(JSON.stringify({ 
      ok: true, 
      sent: sentCount, 
      total: eligibleReminders.length,
      results,
    }), {
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
