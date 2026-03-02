import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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
    const basicAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const fromWA = TWILIO_PHONE_NUMBER.startsWith('whatsapp:') ? TWILIO_PHONE_NUMBER : `whatsapp:${TWILIO_PHONE_NUMBER}`;

    // ============================================================
    // PART 1: Process regular user reminders (existing logic)
    // ============================================================
    const { data: claimed, error: claimErr } = await supabase.rpc('claim_due_reminders', { _limit: 50 });
    
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

      if (reminders.length > 0) {
        await supabase
          .from('reminders')
          .update({ status: 'processing' })
          .in('id', reminders.map((r: any) => r.id));
      }
    } else {
      reminders = claimed || [];
    }

    console.log(`Processing ${reminders.length} user reminders`);

    // Batch-fetch profiles for user reminders
    const userIds = [...new Set(reminders.map((r: any) => r.user_id))];
    const { data: profiles } = userIds.length > 0 
      ? await supabase.from('profiles').select('user_id, tenant_id, name, whatsapp_number').in('user_id', userIds)
      : { data: [] };

    const profileMap = new Map<string, any>();
    for (const p of (profiles || [])) {
      profileMap.set(`${p.user_id}|${p.tenant_id}`, p);
    }

    let sentCount = 0;
    const results: any[] = [];

    for (const reminder of reminders) {
      const profile = profileMap.get(`${reminder.user_id}|${reminder.tenant_id}`);

      if (!profile?.whatsapp_number) {
        await supabase.from('reminders').update({ 
          status: 'no_phone', sent_at: now,
          error_message: 'El usuario no tiene número de WhatsApp configurado',
        }).eq('id', reminder.id);
        results.push({ id: reminder.id, status: 'no_phone' });
        continue;
      }

      const phone = profile.whatsapp_number.replace(/\s/g, '');
      if (!/^\+?\d{10,15}$/.test(phone.replace('whatsapp:', ''))) {
        await supabase.from('reminders').update({ 
          status: 'failed', error_message: `Número inválido: ${phone}`,
          retry_count: (reminder.retry_count || 0) + 1,
        }).eq('id', reminder.id);
        results.push({ id: reminder.id, status: 'invalid_phone' });
        continue;
      }

      const reminderMsg = `⏰ *Recordatorio de Aria*\n\n${reminder.message}\n\n_Este recordatorio fue programado por ti._`;
      const sendResult = await sendWhatsApp(basicAuth, TWILIO_ACCOUNT_SID, fromWA, phone, reminderMsg);

      if (sendResult.ok) {
        sentCount++;
        console.log(`✅ Reminder sent to ${profile.name}: "${reminder.message}" (id=${reminder.id})`);
        await supabase.from('reminders').update({ status: 'sent', sent_at: now, error_message: null }).eq('id', reminder.id);

        // Save to WhatsApp messages
        try {
          const { data: conv } = await supabase.from('whatsapp_conversations').select('id')
            .eq('contact_phone', profile.whatsapp_number).eq('tenant_id', reminder.tenant_id)
            .neq('status', 'closed').limit(1).maybeSingle();
          if (conv) {
            await supabase.from('whatsapp_messages').insert({
              tenant_id: reminder.tenant_id, conversation_id: conv.id,
              direction: 'out', body: reminderMsg, status: 'sent',
              metadata: { provider: 'reminder', reminder_id: reminder.id, message_sid: sendResult.sid },
            });
          }
        } catch (convErr) {
          console.error(`Warning: couldn't save to conversation:`, convErr);
        }
        results.push({ id: reminder.id, status: 'sent', sid: sendResult.sid });
      } else {
        const newRetryCount = (reminder.retry_count || 0) + 1;
        const maxRetries = reminder.max_retries || 3;
        const isFinalFailure = newRetryCount >= maxRetries;
        const nextRetryAt = isFinalFailure ? undefined : new Date(Date.now() + getNextRetryDelay(newRetryCount) * 60000).toISOString();

        await supabase.from('reminders').update({ 
          status: isFinalFailure ? 'failed' : 'pending',
          error_message: sendResult.error, retry_count: newRetryCount,
          ...(nextRetryAt ? { remind_at: nextRetryAt } : {}),
        }).eq('id', reminder.id);
        results.push({ id: reminder.id, status: isFinalFailure ? 'failed' : 'retry_scheduled', error: sendResult.error });
      }
    }

    // ============================================================
    // PART 2: Process appointment notifications
    // ============================================================
    const { data: apptNotifs, error: apptErr } = await supabase
      .from('appointment_notifications')
      .select('id, appointment_id, tenant_id, target_phone, target_user_id, notification_type, message_body, status')
      .in('status', ['pending'])
      .lte('scheduled_at', now)
      .order('scheduled_at')
      .limit(50);

    if (apptErr) {
      console.error('Error fetching appointment notifications:', apptErr.message);
    }

    const apptNotifications = apptNotifs || [];
    console.log(`Processing ${apptNotifications.length} appointment notifications`);

    if (apptNotifications.length > 0) {
      // Mark as processing
      await supabase.from('appointment_notifications')
        .update({ status: 'processing' })
        .in('id', apptNotifications.map((n: any) => n.id));

      // Check which appointments are still active (not cancelled)
      const apptIds = [...new Set(apptNotifications.map((n: any) => n.appointment_id))];
      const { data: activeAppts } = await supabase
        .from('appointments')
        .select('id, status')
        .in('id', apptIds)
        .is('deleted_at', null);

      const activeApptIds = new Set((activeAppts || []).filter((a: any) => a.status !== 'cancelled').map((a: any) => a.id));

      // Get user profiles for internal notifications
      const notifUserIds = [...new Set(apptNotifications.filter((n: any) => n.target_user_id).map((n: any) => n.target_user_id))];
      const { data: notifProfiles } = notifUserIds.length > 0
        ? await supabase.from('profiles').select('user_id, tenant_id, whatsapp_number, phone, name').in('user_id', notifUserIds)
        : { data: [] };

      const notifProfileMap = new Map<string, any>();
      for (const p of (notifProfiles || [])) {
        notifProfileMap.set(`${p.user_id}|${p.tenant_id}`, p);
      }

      // Get tenant from-numbers
      const tenantIds = [...new Set(apptNotifications.map((n: any) => n.tenant_id))];
      const { data: tenants } = await supabase.from('tenants').select('id, whatsapp_config').in('id', tenantIds);
      const tenantConfigMap = new Map<string, any>();
      for (const t of (tenants || [])) {
        tenantConfigMap.set(t.id, t.whatsapp_config);
      }

      for (const notif of apptNotifications) {
        // Skip if appointment was cancelled
        if (!activeApptIds.has(notif.appointment_id)) {
          await supabase.from('appointment_notifications').update({ status: 'cancelled' }).eq('id', notif.id);
          results.push({ id: notif.id, type: 'appt_notif', status: 'cancelled_appt' });
          continue;
        }

        // Determine target phone
        let targetPhone: string | null = notif.target_phone;
        if (!targetPhone && notif.target_user_id) {
          const profile = notifProfileMap.get(`${notif.target_user_id}|${notif.tenant_id}`);
          targetPhone = profile?.whatsapp_number || profile?.phone || null;
        }

        if (!targetPhone) {
          await supabase.from('appointment_notifications').update({ 
            status: 'no_phone', error_message: 'No phone number available',
          }).eq('id', notif.id);
          results.push({ id: notif.id, type: 'appt_notif', status: 'no_phone' });
          continue;
        }

        // Get tenant-specific from number
        const waConfig = tenantConfigMap.get(notif.tenant_id) as Record<string, any> | null;
        const tenantFromNum = waConfig?.phone_number ? String(waConfig.phone_number).replace(/^whatsapp:/i, '') : null;
        const tenantMsgSvc = waConfig?.messaging_service_sid ? String(waConfig.messaging_service_sid).trim() : null;
        const effectiveFrom = tenantFromNum ? (tenantFromNum.startsWith('whatsapp:') ? tenantFromNum : `whatsapp:${tenantFromNum}`) : fromWA;

        const messageBody = notif.message_body || `⏰ Recordatorio de tu cita programada.`;

        // Try sending with MessagingServiceSid first, then fallback
        let sendResult: { ok: boolean; sid?: string; error?: string };
        if (tenantMsgSvc) {
          sendResult = await sendWhatsAppWithMsgSvc(basicAuth, TWILIO_ACCOUNT_SID, targetPhone, messageBody, tenantMsgSvc);
          if (!sendResult.ok) {
            sendResult = await sendWhatsApp(basicAuth, TWILIO_ACCOUNT_SID, effectiveFrom, targetPhone, messageBody);
          }
        } else {
          sendResult = await sendWhatsApp(basicAuth, TWILIO_ACCOUNT_SID, effectiveFrom, targetPhone, messageBody);
        }

        if (sendResult.ok) {
          sentCount++;
          await supabase.from('appointment_notifications').update({
            status: 'sent', sent_at: now,
          }).eq('id', notif.id);
          console.log(`✅ Appt notification sent: type=${notif.notification_type} to=${targetPhone}`);
          results.push({ id: notif.id, type: 'appt_notif', status: 'sent' });
        } else {
          await supabase.from('appointment_notifications').update({
            status: 'failed', error_message: sendResult.error,
          }).eq('id', notif.id);
          console.error(`❌ Appt notification failed: ${sendResult.error}`);
          results.push({ id: notif.id, type: 'appt_notif', status: 'failed', error: sendResult.error });
        }
      }
    }

    console.log(`Batch complete: ${sentCount} total sent (reminders + appt notifications)`);

    return new Response(JSON.stringify({ 
      ok: true, sent: sentCount,
      total_reminders: reminders.length,
      total_appt_notifications: apptNotifications.length,
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

// ==================== Helper functions ====================

async function sendWhatsApp(basicAuth: string, accountSid: string, from: string, to: string, body: string): Promise<{ ok: boolean; sid?: string; error?: string }> {
  const toWA = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`, To: toWA, Body: body }).toString(),
    });
    const data = await res.json();
    if (res.ok) return { ok: true, sid: data.sid };
    return { ok: false, error: data.message || data.error_message || `Twilio error ${data.code}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function sendWhatsAppWithMsgSvc(basicAuth: string, accountSid: string, to: string, body: string, messagingServiceSid: string): Promise<{ ok: boolean; sid?: string; error?: string }> {
  const toWA = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ MessagingServiceSid: messagingServiceSid, To: toWA, Body: body }).toString(),
    });
    const data = await res.json();
    if (res.ok) return { ok: true, sid: data.sid };
    return { ok: false, error: data.message || data.error_message || `Twilio error ${data.code}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
