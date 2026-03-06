import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { corsHeaders } from "./constants.ts";
import { sendTwilioMessage, transcribeVoiceMessage } from "./helpers.ts";
import { getAIResponse } from "./ai-response.ts";
import {
  processExpenseDocument,
  classifyExpenseType,
  handleBudgetCollectApprover,
  checkAndHandleApprovalResponse,
  checkAndHandleReceiptUpload,
} from "./expense-handler.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  const TWILIO_MESSAGING_SERVICE_SID = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { conversationId, messageBody, contactPhone, tenantId, mediaUrl, mediaContentType, sandboxMode, sandboxState, sandboxContext, skipSend } = await req.json();

    console.log(`[BOT] Processing conv=${conversationId} tenant=${tenantId} body_len=${(messageBody || '').length}`);

    // ==================== RESOLVE TENANT FROM-NUMBER ====================
    // Use tenant's configured WhatsApp number instead of global env var
    let fromNumber: string | null = null;
    let tenantMessagingServiceSid: string | null = null;
    if (tenantId) {
      const { data: tenantData } = await supabase
        .from('tenants')
        .select('whatsapp_config')
        .eq('id', tenantId)
        .single();

      const waConfig = tenantData?.whatsapp_config as Record<string, any> | null;
      if (waConfig?.phone_number) {
        fromNumber = String(waConfig.phone_number).replace(/^whatsapp:/i, '');
        console.log(`[BOT] Using tenant from-number: ${fromNumber}`);
      }

      if (waConfig?.messaging_service_sid) {
        tenantMessagingServiceSid = String(waConfig.messaging_service_sid).trim();
        console.log(`[BOT] Using tenant messaging service SID`);
      }
    }

    // Fallback to global env var only if tenant has no configured number
    if (!fromNumber) {
      fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER') || null;
      if (fromNumber) console.log(`[BOT] Fallback to global TWILIO_PHONE_NUMBER`);
    }

    const effectiveMessagingServiceSid = tenantMessagingServiceSid || TWILIO_MESSAGING_SERVICE_SID || undefined;

    // ==================== VOICE TRANSCRIPTION ====================
    const isVoiceMessage = mediaUrl && (
      (mediaContentType && mediaContentType.startsWith('audio/')) ||
      (mediaUrl && /\.(ogg|opus|mp3|m4a|amr|wav)(\?|$)/i.test(mediaUrl))
    );

    let effectiveMessageBody = messageBody;

    if (isVoiceMessage) {
      console.log(`[BOT] Voice message detected: ${mediaContentType || 'unknown type'}`);
      const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');

      if (ELEVENLABS_API_KEY && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
        if (fromNumber && contactPhone) {
          try {
            await sendTwilioMessage(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, fromNumber, contactPhone, '🎤 Procesando tu mensaje de voz...');
          } catch (e) {
            console.error('[BOT] Voice processing confirmation failed:', e);
          }
        }
        try {
          effectiveMessageBody = await transcribeVoiceMessage(mediaUrl, mediaContentType, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, ELEVENLABS_API_KEY);
        } catch (err) {
          console.error('[BOT] Voice transcription error:', err);
          effectiveMessageBody = '[Error procesando mensaje de voz]';
        }
      } else {
        effectiveMessageBody = '[Mensaje de voz - transcripción no disponible]';
      }
    }

    if (!effectiveMessageBody) {
      return new Response(JSON.stringify({ error: 'Missing messageBody' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==================== CONVERSATION SETUP ====================
    const isSandbox = sandboxMode === true;
    let botState: string;
    let botContext: Record<string, unknown>;
    let conv: any = null;

    if (isSandbox) {
      botState = sandboxState || 'welcome';
      botContext = sandboxContext || {};
      conv = { id: '__sandbox__', bot_state: botState, bot_context: botContext };
    } else {
      if (!conversationId) {
        return new Response(JSON.stringify({ error: 'Missing conversationId' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data, error: convError } = await supabase.from('whatsapp_conversations').select('*').eq('id', conversationId).single();
      if (convError) {
        console.error(`[BOT] Conversation fetch error: ${convError.message}`);
      }
      conv = data;
      if (!conv) {
        console.error(`[BOT] Conversation not found: ${conversationId}`);
        return new Response(JSON.stringify({ error: 'Conversation not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      botState = conv.bot_state || 'welcome';
      botContext = (conv.bot_context as Record<string, unknown>) || {};
    }

    const msg = effectiveMessageBody.trim().toLowerCase();

    // ==================== GLOBAL COMMANDS ====================
    const isResetCommand = /^(menu|menú|inicio|reiniciar|reset|salir|volver|empezar)$/i.test(msg);

    // ==================== STALE CONVERSATION RESET ====================
    let isStale = false;
    if (!isSandbox && conv.updated_at) {
      const lastActivity = new Date(conv.updated_at).getTime();
      const hoursSinceActivity = (Date.now() - lastActivity) / (1000 * 60 * 60);
      if (hoursSinceActivity > 24 && !['welcome', 'awaiting_role'].includes(botState)) {
        isStale = true;
        console.log(`[BOT] Stale conversation (${hoursSinceActivity.toFixed(1)}h idle), was: ${botState}`);
      }
    }

    // ==================== STATE MACHINE ====================
    const effectiveBotState = (isResetCommand || isStale) ? 'welcome' : botState;
    const effectiveContext = (isResetCommand || isStale) ? {} : { ...botContext };

    console.log(`[BOT] State: ${botState} → effective: ${effectiveBotState}, msg: "${msg.substring(0, 50)}"`);

    const stateResult = await handleState({
      botState: effectiveBotState, msg: isResetCommand ? '' : msg, effectiveMessageBody, isSandbox, tenantId, contactPhone,
      conversationId, conv, newContext: effectiveContext, supabase, mediaUrl,
      TWILIO_ACCOUNT_SID: TWILIO_ACCOUNT_SID!, TWILIO_AUTH_TOKEN: TWILIO_AUTH_TOKEN!,
      LOVABLE_API_KEY: LOVABLE_API_KEY!, SUPABASE_URL,
    });

    let reply = stateResult.reply;
    const newState = stateResult.newState;
    const newContext = stateResult.newContext;

    console.log(`[BOT] Result: state=${newState}, reply_len=${(reply || '').length}`);

    // ==================== PERSIST & REPLY ====================
    if (!isSandbox) {
      await supabase.from('whatsapp_conversations').update({ bot_state: newState, bot_context: newContext }).eq('id', conversationId);

      // Track inbound usage event
      try {
        await supabase.from('whatsapp_usage_events').insert({
          tenant_id: tenantId, region: 'LATAM', provider: 'twilio',
          event_type: 'message_in', units: 1,
          metadata: { conversation_id: conversationId, bot_state: botState },
        });
      } catch (e) { console.error('[BOT] Usage tracking (in) error:', e); }

      if (!skipSend && reply && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && fromNumber) {
        // Send reply (From first, MessagingServiceSid fallback is handled in helper)
        let twilioResult: any = null;
        let sendSuccess = false;

        try {
          twilioResult = await sendTwilioMessage(
            TWILIO_ACCOUNT_SID,
            TWILIO_AUTH_TOKEN,
            fromNumber,
            contactPhone,
            reply,
            effectiveMessagingServiceSid,
          );

          const twilioStatus = String(twilioResult?.status || '').toLowerCase();
          const hasTwilioError = Boolean(twilioResult?.error_code);

          if (!hasTwilioError && twilioStatus !== 'failed' && twilioStatus !== 'undelivered') {
            sendSuccess = true;
          } else {
            console.error(`[BOT] Send failed: status=${twilioStatus} error=${twilioResult?.error_code} msg=${twilioResult?.error_message}`);
          }
        } catch (sendErr) {
          console.error('[BOT] Send exception:', sendErr);
        }

        const outboundStatus = sendSuccess ? (String(twilioResult?.status || 'sent').toLowerCase()) : 'failed';

        await supabase.from('whatsapp_messages').insert({
          tenant_id: tenantId,
          conversation_id: conversationId,
          direction: 'out',
          body: reply,
          status: outboundStatus,
          metadata: {
            provider: 'bot',
            bot_state: newState,
            message_sid: twilioResult?.sid || null,
            twilio_status: twilioResult?.status || null,
            twilio_error_code: twilioResult?.error_code || null,
            twilio_error_message: twilioResult?.error_message || null,
            from_number: fromNumber,
          },
        });

        try {
          await supabase.from('whatsapp_usage_events').insert({
            tenant_id: tenantId, region: 'LATAM', provider: 'twilio',
            provider_message_id: twilioResult?.sid || null,
            event_type: 'message_out', units: 1,
            metadata: { conversation_id: conversationId, bot_state: newState, twilio_status: twilioResult?.status || null },
          });
        } catch (e) { console.error('[BOT] Usage tracking (out) error:', e); }

      } else if (!skipSend && reply) {
        console.error(`[BOT] Cannot send: missing config (SID=${!!TWILIO_ACCOUNT_SID} AUTH=${!!TWILIO_AUTH_TOKEN} FROM=${fromNumber})`);
        await supabase.from('whatsapp_messages').insert({
          tenant_id: tenantId,
          conversation_id: conversationId,
          direction: 'out',
          body: reply,
          status: 'failed',
          metadata: { provider: 'bot', bot_state: newState, error: 'missing_twilio_config' },
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, reply, state: newState, context: newContext }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[BOT] Fatal error:', errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ==================== STATE MACHINE HANDLER ====================

interface StateInput {
  botState: string;
  msg: string;
  effectiveMessageBody: string;
  isSandbox: boolean;
  tenantId: string;
  contactPhone: string;
  conversationId: string;
  conv: any;
  newContext: Record<string, unknown>;
  supabase: any;
  mediaUrl?: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  LOVABLE_API_KEY: string;
  SUPABASE_URL: string;
}

interface StateResult {
  reply: string;
  newState: string;
  newContext: Record<string, unknown>;
}

async function handleState(input: StateInput): Promise<StateResult> {
  const { botState, msg, effectiveMessageBody, isSandbox, tenantId, contactPhone, conversationId, conv, supabase, mediaUrl, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, LOVABLE_API_KEY, SUPABASE_URL } = input;
  let newContext = { ...input.newContext };
  let reply = '';
  let newState = botState;

  if (botState === 'welcome') {
    let companyName = 'nuestra empresa';
    if (!isSandbox) {
      const { data: tenant } = await supabase.from('tenants').select('name').eq('id', tenantId).single();
      companyName = tenant?.name || companyName;

      const { data: knownEmployee } = await supabase
        .from('profiles')
        .select('id, user_id, name, tenant_id')
        .eq('whatsapp_number', contactPhone)
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .maybeSingle();

      if (knownEmployee) {
        reply = `¡Hola, *${knownEmployee.name}*! 👋 ¡Qué gusto verte de vuelta!\n\nSoy Aria, tu asistente personal. ¿En qué te ayudo hoy?\n\n• 📋 Pendientes y compromisos\n• 📅 Tu agenda del día\n• 📸 Registrar un gasto (envía foto)\n• 📋 Registrar un presupuesto\n• 💬 Consultar información\n\nCuéntame 😊`;
        newState = 'employee_mode';
        newContext = { role: 'employee', user_id: knownEmployee.user_id, user_name: knownEmployee.name, profile_id: knownEmployee.id };
        await supabase.from('whatsapp_conversations').update({ verified_user_id: knownEmployee.user_id }).eq('id', conversationId);
        return { reply, newState, newContext };
      }

      const { data: knownContact } = await supabase.from('contacts').select('name').eq('phone', contactPhone).eq('tenant_id', tenantId).maybeSingle();

      if (knownContact?.name) {
        reply = `¡Hola de nuevo, *${knownContact.name}*! 👋 Qué gusto que nos contactes otra vez.\n\nSoy *Aria*, tu asistente virtual de *${companyName}*. ¿En qué puedo ayudarte hoy?\n\n• 📋 Conocer nuestros servicios\n• 📅 Agendar una cita\n• 👤 Hablar con alguien del equipo\n\nEstoy para servirte 💬`;
        newState = 'client_mode';
        newContext = { role: 'client', contact_name: knownContact.name };
        return { reply, newState, newContext };
      }
    }

    reply = `¡Hola! 👋 ¡Qué gusto saludarte! Soy *Aria*, tu asistente virtual de *${companyName}*.\n\nEstoy aquí para lo que necesites. Dime, ¿vienes como *cliente* o eres parte del equipo (*empleado*)?\n\n1️⃣ Soy cliente\n2️⃣ Soy empleado`;
    newState = 'awaiting_role';

  } else if (botState === 'awaiting_role') {
    if (msg.includes('cliente') || msg === '1') {
      reply = '¡Excelente! 😊 Antes de ayudarte, me encantaría conocerte un poco.\n\n¿Me podrías compartir tu *nombre completo*?';
      newState = 'client_collect_name';
      newContext = { role: 'client' };
    } else if (msg.includes('empleado') || msg === '2') {
      reply = '¡Hola, compañero! 👋 Para reconocerte necesito que me compartas tu *PIN de autenticación* (el que elegiste al crear tu cuenta).\n\nEscríbelo aquí y te doy la bienvenida 🔐';
      newState = 'employee_auth';
      newContext = { role: 'employee', auth_attempts: 0 };
    } else {
      reply = 'Perdona, no logré entenderte 😅 ¿Podrías decirme si vienes como *cliente* o como *empleado*?\n\nTambién puedes responder con *1* o *2* 👆';
    }

  } else if (botState === 'client_collect_name') {
    const clientName = effectiveMessageBody.trim();
    newContext = { ...newContext, contact_name: clientName };
    reply = `¡Mucho gusto, *${clientName}*! 🙂\n\n¿Me podrías compartir también tu *correo electrónico*? Así podré enviarte confirmaciones y mantenerte informado(a).\n\n_Si prefieres no compartirlo, escribe "no"_`;
    newState = 'client_collect_email';

  } else if (botState === 'client_collect_email') {
    const clientName = (newContext.contact_name as string) || 'Cliente';
    let clientEmail: string | null = null;
    if (msg !== 'no' && msg !== 'omitir' && msg !== 'saltar') {
      const emailMatch = effectiveMessageBody.trim().match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
      if (emailMatch) clientEmail = emailMatch[0];
    }
    if (!isSandbox) {
      await supabase.from('contacts').upsert({
        tenant_id: tenantId, phone: contactPhone, name: clientName, email: clientEmail, source: 'whatsapp',
      }, { onConflict: 'tenant_id,phone' });
    }
    newContext = { ...newContext, contact_email: clientEmail };
    reply = `¡Perfecto, *${clientName}*! Ya te tengo registrado(a) 📝\n\nAhora sí, cuéntame ¿en qué te puedo ayudar?\n\n• 📋 Conocer nuestros servicios\n• 📅 Agendar una cita con alguno de nuestros colaboradores\n• 👤 Comunicarte directamente con alguien del equipo\n\nEstoy para servirte 💬`;
    newState = 'client_mode';

  } else if (botState === 'employee_auth') {
    const attempts = ((newContext.auth_attempts as number) || 0) + 1;
    if (attempts > 3) {
      reply = '😔 Entiendo la frustración, pero por seguridad no puedo seguir intentando. Te recomiendo contactar al administrador para restablecer tu PIN.\n\n¡No te preocupes, todo tiene solución! 💪';
      newState = 'welcome';
      newContext = {};
    } else if (isSandbox) {
      reply = `✅ ¡Bienvenido al modo empleado! 🎉 (Modo sandbox — autenticación simulada)\n\nSoy Aria, tu asistente personal. Estoy aquí para hacerte la vida más fácil:\n\n• 📋 Recordarte tus pendientes y compromisos\n• 📅 Revisar tu agenda del día\n• 📸 Registrar gastos — solo mándame la foto del ticket\n• 📋 Registrar presupuestos por autorizar\n• 💬 Resolver dudas\n\n¿Por dónde empezamos? 😊`;
      newState = 'employee_mode';
      newContext = { role: 'employee', user_id: 'sandbox_user', user_name: 'Usuario Sandbox', profile_id: 'sandbox' };
    } else {
      const pinResponse = await fetch(`${SUPABASE_URL}/functions/v1/pin-service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ action: 'verify_pin', pin: msg.trim(), tenant_id: tenantId }),
      });
      const pinResult = await pinResponse.json();
      const profile = pinResult.match ? { id: pinResult.profile_id, user_id: pinResult.user_id, name: pinResult.name } : null;

      if (profile) {
        await supabase.from('profiles').update({ whatsapp_number: contactPhone }).eq('id', profile.id);
        reply = `✅ ¡Qué tal, *${profile.name}*! 🎉 Me da gusto verte por aquí.\n\nTe he registrado con este número para que la próxima vez te reconozca automáticamente 🔓\n\nSoy Aria, tu asistente personal:\n\n• 📸 Registrar gastos — mándame la foto\n• 📋 Presupuestos por autorizar\n• 📅 Revisar tu agenda\n• 💬 Consultar información\n\n¿En qué te ayudo? 😊`;
        newState = 'employee_mode';
        newContext = { role: 'employee', user_id: profile.user_id, user_name: profile.name, profile_id: profile.id };
        await supabase.from('whatsapp_conversations').update({ verified_user_id: profile.user_id }).eq('id', conversationId);
      } else {
        newContext.auth_attempts = attempts;
        reply = `Mmm, ese PIN no coincide 🤔 (Intento ${attempts}/3).\n\nRevísalo e intenta de nuevo. Si no lo recuerdas, el administrador puede ayudarte a restablecerlo.`;
      }
    }

  } else if (botState === 'client_mode') {
    // Check for appointment confirmation/cancellation responses
    const confirmMatch = /^(confirmo|si confirmo|sí confirmo|confirmar|acepto|asistiré|asistire|si voy|sí voy)$/i.test(msg);
    const cancelMatch = /^(cancelo|cancelar|no puedo|no voy|no asistiré|no asistire|no podré|no podre)$/i.test(msg);

    if (confirmMatch || cancelMatch) {
      const responseType = confirmMatch ? 'confirmed' : 'rejected';

      // Find pending confirmation for this contact phone
      const { data: pendingConfirm } = await supabase
        .from('appointment_notifications')
        .select('id, appointment_id, tenant_id')
        .eq('tenant_id', tenantId)
        .eq('target_phone', contactPhone)
        .eq('notification_type', 'confirmation')
        .is('response', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pendingConfirm) {
        // Update notification with response
        await supabase.from('appointment_notifications').update({
          response: responseType,
          responded_at: new Date().toISOString(),
        }).eq('id', pendingConfirm.id);

        // Update appointment status
        const newApptStatus = confirmMatch ? 'confirmed' : 'cancelled';
        await supabase.from('appointments').update({
          status: newApptStatus,
        }).eq('id', pendingConfirm.appointment_id);

        // Get appointment details to notify creator
        const { data: appt } = await supabase
          .from('appointments')
          .select('contact_name, start_at, user_id, service_type, notes')
          .eq('id', pendingConfirm.appointment_id)
          .single();

        if (appt?.user_id) {
          // Get creator's WhatsApp number to notify them
          const { data: creatorProfile } = await supabase
            .from('profiles')
            .select('whatsapp_number, phone, name')
            .eq('user_id', appt.user_id)
            .eq('tenant_id', tenantId)
            .maybeSingle();

          const creatorPhone = creatorProfile?.whatsapp_number || creatorProfile?.phone;
          if (creatorPhone) {
            const { data: tData } = await supabase.from('tenants').select('timezone').eq('id', tenantId).single();
            const tz = tData?.timezone || 'America/Mexico_City';
            const apptDate = new Date(appt.start_at).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
            const apptTime = new Date(appt.start_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: tz });

            const statusEmoji = confirmMatch ? '✅' : '❌';
            const statusText = confirmMatch ? 'CONFIRMÓ' : 'CANCELÓ';
            const notifyMsg = `${statusEmoji} *Actualización de cita*\n\n*${appt.contact_name}* ${statusText} su cita:\n\n📆 ${apptDate}\n⏰ ${apptTime}\n${appt.service_type ? `📋 ${appt.service_type}\n` : ''}${appt.notes ? `📝 ${appt.notes}\n` : ''}\n${confirmMatch ? '¡Todo listo para la reunión! 🎉' : 'La cita ha sido cancelada por el contacto.'}`;

            try {
              const TWILIO_ACCOUNT_SID_VAL = Deno.env.get('TWILIO_ACCOUNT_SID')!;
              const TWILIO_AUTH_TOKEN_VAL = Deno.env.get('TWILIO_AUTH_TOKEN')!;
              const { sendTwilioMessage } = await import('./helpers.ts');
              const { data: waConf } = await supabase.from('tenants').select('whatsapp_config').eq('id', tenantId).single();
              const waCfg = waConf?.whatsapp_config as Record<string, any> | null;
              const fromNum = waCfg?.phone_number ? String(waCfg.phone_number).replace(/^whatsapp:/i, '') : Deno.env.get('TWILIO_PHONE_NUMBER') || '';
              const msgSvc = waCfg?.messaging_service_sid ? String(waCfg.messaging_service_sid).trim() : undefined;
              await sendTwilioMessage(TWILIO_ACCOUNT_SID_VAL, TWILIO_AUTH_TOKEN_VAL, fromNum, creatorPhone, notifyMsg, msgSvc);

              // Save confirmation status notification
              await supabase.from('appointment_notifications').insert({
                appointment_id: pendingConfirm.appointment_id,
                tenant_id: tenantId,
                target_user_id: appt.user_id,
                notification_type: 'confirmation_status',
                status: 'sent',
                scheduled_at: new Date().toISOString(),
                sent_at: new Date().toISOString(),
                response: responseType,
                message_body: notifyMsg,
              });
            } catch (notifyErr) {
              console.error('[BOT] Error notifying creator:', notifyErr);
            }
          }
        }

        // Cancel pending reminders if appointment was cancelled
        if (!confirmMatch) {
          await supabase.from('appointment_notifications')
            .update({ status: 'cancelled' })
            .eq('appointment_id', pendingConfirm.appointment_id)
            .in('notification_type', ['reminder_1h', 'reminder_15m'])
            .eq('status', 'pending');
        }

        reply = confirmMatch
          ? '✅ ¡Perfecto! Tu asistencia ha sido confirmada. ¡Te esperamos! 😊\n\nTe enviaremos un recordatorio antes de la cita.'
          : '❌ Entendido, tu cita ha sido cancelada. Si necesitas reagendar, no dudes en escribirme. 🙏';
        return { reply, newState, newContext };
      }
    }

    reply = await getAIResponse(LOVABLE_API_KEY, tenantId, supabase, 'client', effectiveMessageBody, conv);

  } else if (botState === 'employee_mode') {
    const userId = newContext.user_id as string;
    const userName = newContext.user_name as string || '';

    // ---- 1. Check for approval responses (APROBAR/RECHAZAR) ----
    if (userId) {
      const approvalResult = await checkAndHandleApprovalResponse(msg, userId, userName, tenantId, supabase);
      if (approvalResult.handled) {
        reply = approvalResult.reply;
        return { reply, newState, newContext };
      }
    }

    // ---- 2. Check if image is a receipt for approved budget ----
    if (mediaUrl && userId) {
      const receiptResult = await checkAndHandleReceiptUpload(
        mediaUrl, userId, tenantId, supabase,
        TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, LOVABLE_API_KEY, effectiveMessageBody
      );
      if (receiptResult.handled) {
        reply = receiptResult.reply;
        return { reply, newState, newContext };
      }
    }

    // ---- 3. Detect expense/budget intent ----
    const isExpenseIntent =
      /\b(registra|registrar|agrega|agregar|captura|capturar|sube|subir|guarda|guardar|carga|cargar)\b/i.test(msg) &&
      /(gasto|comprobante|ticket|factura|recibo|presupuesto|cotizaci[oó]n|pago)/i.test(msg);

    const isBudgetKeyword = /\b(presupuesto|cotizaci[oó]n|quote|propuesta|estimado|por\s*pagar|pendiente|a\s*autorizaci[oó]n)\b/i.test(msg);

    if (mediaUrl) {
      const result = await processExpenseDocument(
        mediaUrl, effectiveMessageBody, LOVABLE_API_KEY, tenantId, newContext, supabase,
        TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
      );
      reply = result.reply;
      newState = result.newState;
      newContext = result.newContext;

    } else if (
      (msg.includes('credencial') || msg.includes('contraseña') || msg.includes('password') || msg.includes('usuario y contraseña') || msg.includes('acceso')) &&
      !(/(borr|elimin|quita|borra|elimina|quitar|delete|remove)/i.test(msg))
    ) {
      reply = '🔐 Vamos a guardar una credencial compartida.\n\n¿De qué *plataforma o servicio* es? (Ej: Gmail, Hosting, CPanel, Facebook Ads...)';
      newState = 'credential_collect_platform';

    } else if (isExpenseIntent || isBudgetKeyword) {
      const result = await processExpenseDocument(
        null, effectiveMessageBody, LOVABLE_API_KEY, tenantId, newContext, supabase,
        TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
      );
      reply = result.reply;
      newState = result.newState;
      newContext = result.newContext;

    } else {
      reply = await getAIResponse(LOVABLE_API_KEY, tenantId, supabase, 'employee', effectiveMessageBody, conv);
    }

  } else if (botState === 'budget_collect_approver') {
    const result = await handleBudgetCollectApprover(
      msg, effectiveMessageBody, tenantId, newContext, supabase, conversationId
    );
    reply = result.reply;
    newState = result.newState;
    newContext = result.newContext;

  } else if (botState === 'expense_classify') {
    if (/pagado|gasto|ya\s*pag/i.test(msg) || msg === '1') {
      const result = await processExpenseDocument(
        newContext._pending_media_url as string || null,
        newContext._pending_message as string || '',
        LOVABLE_API_KEY, tenantId,
        newContext, supabase, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
      );
      reply = result.reply;
      newState = result.newState;
      newContext = result.newContext;
      delete newContext._pending_media_url;
      delete newContext._pending_message;
    } else if (/presupuesto|cotizaci[oó]n|autorizar|pendiente/i.test(msg) || msg === '2') {
      const originalMsg = (newContext._pending_message as string || '') + ' presupuesto';
      const result = await processExpenseDocument(
        newContext._pending_media_url as string || null,
        originalMsg,
        LOVABLE_API_KEY, tenantId,
        newContext, supabase, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
      );
      reply = result.reply;
      newState = result.newState;
      newContext = result.newContext;
      delete newContext._pending_media_url;
      delete newContext._pending_message;
    } else {
      reply = 'Por favor elige:\n\n1️⃣ Gasto ya pagado\n2️⃣ Presupuesto por autorizar';
    }

  } else if (botState === 'credential_collect_platform') {
    // Cancel detection for credential flow
    const isCancelIntent = /\b(cancel|cancela|cancelar|no|salir|deja|dejarlo|olvida|olv[ií]dalo|para|detente|stop)\b/i.test(msg);
    if (isCancelIntent) {
      delete newContext.cred_platform;
      delete newContext.cred_username;
      reply = '✅ Proceso de credencial cancelado. ¿En qué más te puedo ayudar? 😊';
      newState = 'employee_mode';
    } else {
      const platformName = effectiveMessageBody.trim();
      newContext = { ...newContext, cred_platform: platformName };
      reply = `📌 Plataforma: *${platformName}*\n\nAhora escríbeme el *usuario o email* de acceso:\n\n_Escribe *cancelar* para salir del proceso._`;
      newState = 'credential_collect_username';
    }

  } else if (botState === 'credential_collect_username') {
    const isCancelIntent = /\b(cancel|cancela|cancelar|no|salir|deja|dejarlo|olvida|olv[ií]dalo|para|detente|stop)\b/i.test(msg);
    if (isCancelIntent) {
      delete newContext.cred_platform;
      delete newContext.cred_username;
      reply = '✅ Proceso de credencial cancelado. ¿En qué más te puedo ayudar? 😊';
      newState = 'employee_mode';
    } else {
      const username = effectiveMessageBody.trim();
      newContext = { ...newContext, cred_username: username };
      reply = `👤 Usuario: *${username}*\n\nAhora escríbeme la *contraseña*:\n\n_Escribe *cancelar* para salir del proceso._`;
      newState = 'credential_collect_password';
    }

  } else if (botState === 'credential_collect_password') {
    const isCancelIntent = /\b(cancel|cancela|cancelar|salir|deja|dejarlo|olvida|olv[ií]dalo|para|detente|stop)\b/i.test(msg);
    if (isCancelIntent) {
      delete newContext.cred_platform;
      delete newContext.cred_username;
      reply = '✅ Proceso de credencial cancelado. ¿En qué más te puedo ayudar? 😊';
      newState = 'employee_mode';
    } else {
      const password = effectiveMessageBody.trim();
    const platform = newContext.cred_platform as string;
    const username = newContext.cred_username as string;

    if (!isSandbox) {
      try {
        const vaultResponse = await fetch(`${SUPABASE_URL}/functions/v1/credential-vault`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
          body: JSON.stringify({ action: 'encrypt_save', tenant_id: tenantId, user_id: newContext.user_id as string || null, platform_name: platform, username, password, notes: 'Agregada vía WhatsApp bot' }),
        });
        if (!vaultResponse.ok) {
          console.error('[BOT] Credential vault failed, saving directly');
          await supabase.from('shared_credentials').insert({ tenant_id: tenantId, platform_name: platform, username, password_encrypted: password, notes: 'Agregada vía WhatsApp bot', created_by: newContext.user_id as string || null });
        }
      } catch (vaultErr) {
        console.error('[BOT] Credential vault error:', vaultErr);
        await supabase.from('shared_credentials').insert({ tenant_id: tenantId, platform_name: platform, username, password_encrypted: password, notes: 'Agregada vía WhatsApp bot', created_by: newContext.user_id as string || null });
      }
    }
    delete newContext.cred_platform;
    delete newContext.cred_username;
    reply = `✅ ¡Credencial guardada exitosamente!\n\n🔐 *${platform}*\n👤 ${username}\n🔑 ••••••••\n\nTodos los miembros del equipo pueden verla en la sección *Credenciales* de la app.\n\n¿Te ayudo con algo más?`;
    newState = 'employee_mode';
    }

  } else if (botState === 'employee_expense') {
    if (mediaUrl) {
      const result = await processExpenseDocument(
        mediaUrl, effectiveMessageBody, LOVABLE_API_KEY, tenantId, newContext, supabase,
        TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
      );
      reply = result.reply;
      newState = result.newState;
      newContext = result.newContext;
    } else {
      const result = await processExpenseDocument(
        null, effectiveMessageBody, LOVABLE_API_KEY, tenantId, newContext, supabase,
        TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
      );
      reply = result.reply;
      newState = result.newState;
      newContext = result.newContext;
    }

  } else {
    // ==================== UNKNOWN STATE FALLBACK ====================
    console.error(`[BOT] Unknown state: "${botState}", resetting`);
    newState = 'welcome';
    newContext = {};
    reply = '¡Hola! 👋 Parece que tuvimos un pequeño desajuste. Empecemos de nuevo.\n\n¿Vienes como *cliente* o eres parte del equipo (*empleado*)?\n\n1️⃣ Soy cliente\n2️⃣ Soy empleado';
    newState = 'awaiting_role';
  }

  // ==================== EMPTY REPLY GUARD ====================
  if (!reply || reply.trim() === '') {
    console.error(`[BOT] Empty reply. State: ${botState} → ${newState}, msg: "${msg.substring(0, 50)}"`);
    reply = 'Disculpa, no pude procesar tu mensaje. ¿Podrías intentarlo de nuevo? 🙏\n\n_Escribe *menu* para volver al inicio._';
  }

  return { reply, newState, newContext };
}
