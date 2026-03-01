import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Exponential backoff: 5min, 10min, 20min, 40min...
function getNextRetryDelay(retryCount: number, baseMinutes = 5): number {
  return baseMinutes * Math.pow(2, retryCount);
}

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

    // ============================================================
    // STEP 1: Atomically claim pending reminders to prevent race conditions.
    // We update status to 'processing' in a single query, then fetch them.
    // This ensures concurrent cron invocations don't double-send.
    // ============================================================
    const { data: claimed, error: claimErr } = await supabase.rpc('claim_due_reminders', { _limit: 50 });
    
    // Fallback if RPC doesn't exist yet — use standard query
    let reminders: any[] = [];
    if (claimErr) {
      console.log('claim_due_reminders RPC not available, using fallback query');
      const { data, error: fetchErr } = await supabase
        .from('reminders')
        .select('id, user_id, tenant_id, message, remind_at, retry_count, max_retries, status, timezone')
        .or('status.eq.pending,status.eq.failed')
        .lte('remind_at', now)
        .order('remind_at')
        .limit(50);

      if (fetchErr) throw fetchErr;
      reminders = (data || []).filter((r: any) => {
        if (r.status === 'pending') return true;
        if (r.status === 'failed' && r.retry_count < (r.max_retries || 3)) return true;
        return false;
      });

      // Mark as processing to prevent race conditions
      if (reminders.length > 0) {
        await supabase
          .from('reminders')
          .update({ status: 'processing' })
          .in('id', reminders.map((r: any) => r.id));
      }
    } else {
      reminders = claimed || [];
    }

    if (reminders.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, message: 'No pending reminders' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Processing ${reminders.length} reminders`);

    // ============================================================
    // STEP 2: Batch-fetch all profiles to eliminate N+1 queries
    // ============================================================
    const userTenantPairs = [...new Set(reminders.map((r: any) => `${r.user_id}|${r.tenant_id}`))];
    const userIds = [...new Set(reminders.map((r: any) => r.user_id))];

    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, tenant_id, name, whatsapp_number')
      .in('user_id', userIds);

    // Build a lookup map: `user_id|tenant_id` -> profile
    const profileMap = new Map<string, any>();
    for (const p of (profiles || [])) {
      profileMap.set(`${p.user_id}|${p.tenant_id}`, p);
    }

    // ============================================================
    // STEP 3: Send reminders with retry tracking
    // ============================================================
    let sentCount = 0;
    const results: any[] = [];
    const basicAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const fromWA = TWILIO_PHONE_NUMBER.startsWith('whatsapp:') ? TWILIO_PHONE_NUMBER : `whatsapp:${TWILIO_PHONE_NUMBER}`;

    for (const reminder of reminders) {
      const profile = profileMap.get(`${reminder.user_id}|${reminder.tenant_id}`);

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
        const toWA = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;

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

          // Save to WhatsApp messages (best-effort, don't block)
          try {
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
          } catch (convErr) {
            console.error(`Warning: couldn't save to conversation:`, convErr);
          }

          results.push({ id: reminder.id, status: 'sent', sid: data.sid });
        } else {
          const errorMsg = data.message || data.error_message || `Twilio error ${data.code}`;
          console.error(`❌ Failed to send reminder to ${profile.name}: ${errorMsg}`);
          
          const newRetryCount = (reminder.retry_count || 0) + 1;
          const maxRetries = reminder.max_retries || 3;
          const isFinalFailure = newRetryCount >= maxRetries;
          
          // Exponential backoff: schedule next retry in the future
          const nextRetryAt = isFinalFailure 
            ? undefined 
            : new Date(Date.now() + getNextRetryDelay(newRetryCount) * 60000).toISOString();

          await supabase.from('reminders').update({ 
            status: isFinalFailure ? 'failed' : 'pending', // Back to pending for retry
            error_message: errorMsg,
            retry_count: newRetryCount,
            ...(nextRetryAt ? { remind_at: nextRetryAt } : {}),
          }).eq('id', reminder.id);

          results.push({ 
            id: reminder.id, 
            status: isFinalFailure ? 'failed' : 'retry_scheduled', 
            error: errorMsg, 
            retry: `${newRetryCount}/${maxRetries}`,
            ...(nextRetryAt ? { next_retry: nextRetryAt } : {}),
          });
        }
      } catch (sendErr) {
        const errorMsg = sendErr instanceof Error ? sendErr.message : 'Unknown send error';
        console.error(`❌ Error sending reminder ${reminder.id}:`, errorMsg);
        
        const newRetryCount = (reminder.retry_count || 0) + 1;
        const maxRetries = reminder.max_retries || 3;
        const isFinalFailure = newRetryCount >= maxRetries;
        const nextRetryAt = isFinalFailure 
          ? undefined 
          : new Date(Date.now() + getNextRetryDelay(newRetryCount) * 60000).toISOString();

        await supabase.from('reminders').update({ 
          status: isFinalFailure ? 'failed' : 'pending',
          error_message: errorMsg,
          retry_count: newRetryCount,
          ...(nextRetryAt ? { remind_at: nextRetryAt } : {}),
        }).eq('id', reminder.id);

        results.push({ id: reminder.id, status: 'error', error: errorMsg });
      }
    }

    console.log(`Reminder batch complete: ${sentCount}/${reminders.length} sent`);

    return new Response(JSON.stringify({ 
      ok: true, 
      sent: sentCount, 
      total: reminders.length,
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
