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
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

  // Twilio is required for WhatsApp; email works independently via Resend.
  const twilioConfigured = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER);
  if (!twilioConfigured && !RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'Neither Twilio nor Resend configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const now = new Date().toISOString();
    const basicAuth = twilioConfigured ? btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`) : '';
    const fromWA = twilioConfigured
      ? (TWILIO_PHONE_NUMBER!.startsWith('whatsapp:') ? TWILIO_PHONE_NUMBER! : `whatsapp:${TWILIO_PHONE_NUMBER}`)
      : '';

    // ============================================================
    // PART 1: Process regular user reminders (existing logic)
    // ============================================================
    const { data: claimed, error: claimErr } = await supabase.rpc('claim_due_reminders', { _limit: 50 });
    
    let reminders: any[] = [];
    if (claimErr) {
      console.log('claim_due_reminders RPC not available, using fallback query');
      const { data, error: fetchErr } = await supabase
        .from('reminders')
        .select('id, user_id, tenant_id, message, remind_at, retry_count, max_retries, status, timezone, channel, contact_phone, contact_email')
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
      // Hydrate channel/contact fields (RPC may not return them)
      if (reminders.length > 0) {
        const { data: extra } = await supabase
          .from('reminders')
          .select('id, channel, contact_phone, contact_email')
          .in('id', reminders.map((r: any) => r.id));
        const extraMap = new Map<string, any>();
        for (const e of (extra || [])) extraMap.set(e.id, e);
        reminders = reminders.map((r: any) => ({ ...r, ...(extraMap.get(r.id) || {}) }));
      }
    }

    console.log(`Processing ${reminders.length} user reminders`);

    // Batch-fetch profiles for user reminders
    const userIds = [...new Set(reminders.map((r: any) => r.user_id))];
    const { data: profiles } = userIds.length > 0
      ? await supabase.from('profiles').select('user_id, tenant_id, name, whatsapp_number, email').in('user_id', userIds)
      : { data: [] };

    const profileMap = new Map<string, any>();
    for (const p of (profiles || [])) {
      profileMap.set(`${p.user_id}|${p.tenant_id}`, p);
    }

    // Batch-fetch tenant WhatsApp config so Part 1 uses the same sender
    // (messaging_service_sid / phone_number) as Part 2. Prevents Twilio 63007
    // when the global TWILIO_PHONE_NUMBER isn't a registered WhatsApp channel.
    const tenantIdsR = [...new Set(reminders.map((r: any) => r.tenant_id))];
    const { data: tenantsR } = tenantIdsR.length > 0
      ? await supabase.from('tenants').select('id, whatsapp_config').in('id', tenantIdsR)
      : { data: [] };
    const tenantConfigMapR = new Map<string, any>();
    for (const t of (tenantsR || [])) {
      tenantConfigMapR.set(t.id, t.whatsapp_config);
    }

    let sentCount = 0;
    const results: any[] = [];

    for (const reminder of reminders) {
      const profile = profileMap.get(`${reminder.user_id}|${reminder.tenant_id}`);
      const channel: 'whatsapp' | 'email' = reminder.channel === 'email' ? 'email' : 'whatsapp';

      let sendResult: { ok: boolean; sid?: string; error?: string };
      const reminderMsg = `⏰ *Recordatorio de Aria*\n\n${reminder.message}\n\n_Este recordatorio fue programado por ti._`;

      if (channel === 'email') {
        const toEmail = (reminder.contact_email && String(reminder.contact_email).trim()) || profile?.email;
        if (!toEmail) {
          await supabase.from('reminders').update({
            status: 'no_phone', sent_at: now,
            error_message: 'No hay email disponible para enviar el recordatorio',
          }).eq('id', reminder.id);
          results.push({ id: reminder.id, status: 'no_email' });
          continue;
        }
        if (!RESEND_API_KEY) {
          await supabase.from('reminders').update({
            status: 'failed', error_message: 'Resend no está configurado',
            retry_count: (reminder.retry_count || 0) + 1,
          }).eq('id', reminder.id);
          results.push({ id: reminder.id, status: 'failed', error: 'resend_missing' });
          continue;
        }
        sendResult = await sendEmail(RESEND_API_KEY, toEmail, 'Recordatorio', reminder.message);
      } else {
        // WhatsApp path
        const targetPhone = (reminder.contact_phone && String(reminder.contact_phone).trim()) || profile?.whatsapp_number;
        if (!targetPhone) {
          await supabase.from('reminders').update({
            status: 'no_phone', sent_at: now,
            error_message: 'El usuario no tiene número de WhatsApp configurado',
          }).eq('id', reminder.id);
          results.push({ id: reminder.id, status: 'no_phone' });
          continue;
        }

        const phone = String(targetPhone).replace(/\s/g, '');
        if (!/^\+?\d{10,15}$/.test(phone.replace('whatsapp:', ''))) {
          await supabase.from('reminders').update({
            status: 'failed', error_message: `Número inválido: ${phone}`,
            retry_count: (reminder.retry_count || 0) + 1,
          }).eq('id', reminder.id);
          results.push({ id: reminder.id, status: 'invalid_phone' });
          continue;
        }

        if (!twilioConfigured) {
          await supabase.from('reminders').update({
            status: 'failed', error_message: 'Twilio no está configurado',
            retry_count: (reminder.retry_count || 0) + 1,
          }).eq('id', reminder.id);
          results.push({ id: reminder.id, status: 'failed', error: 'twilio_missing' });
          continue;
        }

        // Resolve sender per-tenant
        const waR = tenantConfigMapR.get(reminder.tenant_id) as Record<string, any> | null;
        const tFromR = waR?.phone_number ? String(waR.phone_number).replace(/^whatsapp:/i, '') : null;
        const tMsgSvcR = waR?.messaging_service_sid ? String(waR.messaging_service_sid).trim() : null;
        const effectiveFromR = tFromR
          ? (tFromR.startsWith('whatsapp:') ? tFromR : `whatsapp:${tFromR}`)
          : fromWA;

        if (tMsgSvcR) {
          sendResult = await sendWhatsAppWithMsgSvc(basicAuth, TWILIO_ACCOUNT_SID!, phone, reminderMsg, tMsgSvcR);
          if (!sendResult.ok) {
            sendResult = await sendWhatsApp(basicAuth, TWILIO_ACCOUNT_SID!, effectiveFromR, phone, reminderMsg);
          }
        } else {
          sendResult = await sendWhatsApp(basicAuth, TWILIO_ACCOUNT_SID!, effectiveFromR, phone, reminderMsg);
        }

        // Save to WhatsApp messages on success
        if (sendResult.ok && profile?.whatsapp_number) {
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
        }
      }

      if (sendResult.ok) {
        sentCount++;
        console.log(`✅ Reminder sent (${channel}) id=${reminder.id}`);
        await supabase.from('reminders').update({ status: 'sent', sent_at: now, error_message: null }).eq('id', reminder.id);
        results.push({ id: reminder.id, status: 'sent', channel, sid: sendResult.sid });
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
      .select('id, appointment_id, tenant_id, target_phone, target_email, target_user_id, notification_type, message_body, status')
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
        ? await supabase.from('profiles').select('user_id, tenant_id, whatsapp_number, phone, name, email').in('user_id', notifUserIds)
        : { data: [] };


      const notifProfileMap = new Map<string, any>();
      for (const p of (notifProfiles || [])) {
        notifProfileMap.set(`${p.user_id}|${p.tenant_id}`, p);
      }

      // Fetch appointments (used by voice-call reminders for dynamic variables)
      const { data: apptFull } = await supabase
        .from('appointments')
        .select('id, contact_name, contact_phone, contact_email, service_type, start_at, notes, user_id, tenant_id')
        .in('id', apptIds);
      const apptMap = new Map<string, any>();
      for (const a of (apptFull || [])) apptMap.set(a.id, a);

      // Batch-fetch tenant WhatsApp config for Part 2 (reminder_whatsapp branch)
      const tenantIdsN = [...new Set(apptNotifications.map((n: any) => n.tenant_id))];
      const missingTenantIds = tenantIdsN.filter((id: string) => !tenantConfigMapR.has(id));
      if (missingTenantIds.length > 0) {
        const { data: tenantsN } = await supabase
          .from('tenants').select('id, whatsapp_config').in('id', missingTenantIds);
        for (const t of (tenantsN || [])) tenantConfigMapR.set(t.id, t.whatsapp_config);
      }

      for (const notif of apptNotifications) {
        // Skip if appointment was cancelled
        if (!activeApptIds.has(notif.appointment_id)) {
          await supabase.from('appointment_notifications').update({ status: 'cancelled' }).eq('id', notif.id);
          results.push({ id: notif.id, type: 'appt_notif', status: 'cancelled_appt' });
          continue;
        }

        // Determine target phone / email
        let targetPhone: string | null = notif.target_phone;
        let targetEmail: string | null = notif.target_email || null;
        if (!targetPhone && notif.target_user_id) {
          const profile = notifProfileMap.get(`${notif.target_user_id}|${notif.tenant_id}`);
          targetPhone = profile?.whatsapp_number || profile?.phone || null;
        }
        if (!targetEmail && notif.target_user_id) {
          const profile = notifProfileMap.get(`${notif.target_user_id}|${notif.tenant_id}`);
          targetEmail = (profile as any)?.email || null;
        }

        const notifType: string = String(notif.notification_type || '');
        const messageBody: string = notif.message_body || `⏰ Recordatorio de tu cita programada.`;
        let sendResult: { ok: boolean; sid?: string; error?: string } = { ok: false, error: 'no_channel' };

        // ────────── Channel routing by notification_type ──────────
        // reminder_24h  → EMAIL only (client)
        // reminder_1h   → VOICE outbound call (client), fallback email if voice fails/unsupported
        // staff_update  → EMAIL to staff (target_user_id)
        // (unknown)     → email if available
        if (notifType === 'reminder_1h') {
          if (!targetPhone) {
            await supabase.from('appointment_notifications').update({
              status: 'no_phone', error_message: 'No phone available for voice reminder',
            }).eq('id', notif.id);
            results.push({ id: notif.id, type: 'appt_notif', status: 'no_phone' });
            continue;
          }

          // Invoke voice-outbound-call
          try {
            const appt = apptMap.get(notif.appointment_id);
            const startAt = appt?.start_at ? new Date(appt.start_at) : null;
            const voiceRes = await fetch(`${SUPABASE_URL}/functions/v1/voice-outbound-call`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              },
              body: JSON.stringify({
                tenant_id: notif.tenant_id,
                to_number: targetPhone,
                appointment_id: notif.appointment_id,
                notification_id: notif.id,
                dynamic_variables: {
                  contact_name: appt?.contact_name || '',
                  service_type: appt?.service_type || '',
                  appointment_date: startAt ? startAt.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }) : '',
                  appointment_time: startAt ? startAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '',
                  purpose: 'appointment_reminder_1h',
                },
              }),
            });
            const voiceData = await voiceRes.json();
            if (voiceRes.ok && voiceData?.success) {
              sendResult = { ok: true, sid: voiceData.call_sid || voiceData.conversation_id || 'voice' };
            } else {
              sendResult = { ok: false, error: voiceData?.error || voiceData?.message || `voice-outbound-call ${voiceRes.status}` };
            }
          } catch (err) {
            sendResult = { ok: false, error: err instanceof Error ? err.message : 'voice-outbound-call error' };
          }

          // Fallback to email if voice fails
          if (!sendResult.ok && targetEmail && RESEND_API_KEY) {
            console.warn(`[appt-1h] voice failed (${sendResult.error}); falling back to email`);
            sendResult = await sendEmail(RESEND_API_KEY, targetEmail, 'Tu cita es en 1 hora', messageBody);
          }
        } else if (notifType === 'reminder_24h' || notifType === 'staff_update') {
          if (!targetEmail) {
            await supabase.from('appointment_notifications').update({
              status: 'no_phone', error_message: 'No email available',
            }).eq('id', notif.id);
            results.push({ id: notif.id, type: 'appt_notif', status: 'no_email' });
            continue;
          }
          if (!RESEND_API_KEY) {
            await supabase.from('appointment_notifications').update({
              status: 'failed', error_message: 'Resend not configured',
            }).eq('id', notif.id);
            results.push({ id: notif.id, type: 'appt_notif', status: 'failed', error: 'resend_missing' });
            continue;
          }
          const subject = notifType === 'reminder_24h'
            ? 'Recordatorio de tu cita para mañana'
            : notifType === 'staff_update'
              ? 'Actualización de cita'
              : 'Recordatorio de tu cita';
          sendResult = await sendEmail(RESEND_API_KEY, targetEmail, subject, messageBody);
        } else if (notifType === 'reminder_whatsapp' || notifType === 'staff_whatsapp') {
          // Optional WhatsApp channel for appointments (additional, non-default)
          if (!targetPhone) {
            await supabase.from('appointment_notifications').update({
              status: 'no_phone', error_message: 'No phone available for WhatsApp reminder',
            }).eq('id', notif.id);
            results.push({ id: notif.id, type: 'appt_notif', status: 'no_phone' });
            continue;
          }
          if (!twilioConfigured) {
            await supabase.from('appointment_notifications').update({
              status: 'failed', error_message: 'Twilio not configured',
            }).eq('id', notif.id);
            results.push({ id: notif.id, type: 'appt_notif', status: 'failed', error: 'twilio_missing' });
            continue;
          }
          const phoneN = String(targetPhone).replace(/\s/g, '');
          if (!/^\+?\d{10,15}$/.test(phoneN.replace('whatsapp:', ''))) {
            await supabase.from('appointment_notifications').update({
              status: 'failed', error_message: `Invalid phone: ${phoneN}`,
            }).eq('id', notif.id);
            results.push({ id: notif.id, type: 'appt_notif', status: 'invalid_phone' });
            continue;
          }
          const waN = tenantConfigMapR.get(notif.tenant_id) as Record<string, any> | null;
          const tFromN = waN?.phone_number ? String(waN.phone_number).replace(/^whatsapp:/i, '') : null;
          const tMsgSvcN = waN?.messaging_service_sid ? String(waN.messaging_service_sid).trim() : null;
          const effectiveFromN = tFromN
            ? (tFromN.startsWith('whatsapp:') ? tFromN : `whatsapp:${tFromN}`)
            : fromWA;
          if (tMsgSvcN) {
            sendResult = await sendWhatsAppWithMsgSvc(basicAuth, TWILIO_ACCOUNT_SID!, phoneN, messageBody, tMsgSvcN);
            if (!sendResult.ok) {
              sendResult = await sendWhatsApp(basicAuth, TWILIO_ACCOUNT_SID!, effectiveFromN, phoneN, messageBody);
            }
          } else {
            sendResult = await sendWhatsApp(basicAuth, TWILIO_ACCOUNT_SID!, effectiveFromN, phoneN, messageBody);
          }
        } else {
          // Unknown legacy types → prefer email
          if (targetEmail && RESEND_API_KEY) {
            sendResult = await sendEmail(RESEND_API_KEY, targetEmail, 'Recordatorio', messageBody);
          } else {
            await supabase.from('appointment_notifications').update({
              status: 'failed', error_message: `Unsupported notification_type=${notifType}`,
            }).eq('id', notif.id);
            results.push({ id: notif.id, type: 'appt_notif', status: 'failed', error: 'unsupported_type' });
            continue;
          }
        }

        if (sendResult.ok) {
          sentCount++;
          await supabase.from('appointment_notifications').update({
            status: 'sent', sent_at: now,
          }).eq('id', notif.id);
          console.log(`✅ Appt notification sent: type=${notif.notification_type} to=${targetPhone || targetEmail}`);
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

async function sendEmail(apiKey: string, to: string, subject: string, body: string): Promise<{ ok: boolean; sid?: string; error?: string }> {
  try {
    // Convert plain-text markdown-lite body (with * and \n) into simple HTML
    const html = body
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*(.+?)\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Recordatorios <onboarding@resend.dev>',
        to: [to],
        subject,
        html: `<div style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 15px; color: #111; line-height: 1.5;">${html}</div>`,
      }),
    });
    const data = await res.json();
    if (res.ok) return { ok: true, sid: data.id };
    return { ok: false, error: data?.message || `Resend error ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
