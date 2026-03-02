import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { corsHeaders } from "./constants.ts";
import { sendTwilioMessage, transcribeVoiceMessage } from "./helpers.ts";
import { getAIResponse } from "./ai-response.ts";
import { processReceiptOCR } from "./ocr.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { conversationId, messageBody, contactPhone, tenantId, mediaUrl, mediaContentType, sandboxMode, sandboxState, sandboxContext } = await req.json();

    // ==================== VOICE TRANSCRIPTION ====================
    const isVoiceMessage = mediaUrl && (
      (mediaContentType && mediaContentType.startsWith('audio/')) ||
      (mediaUrl && /\.(ogg|opus|mp3|m4a|amr|wav)(\?|$)/i.test(mediaUrl))
    );

    let effectiveMessageBody = messageBody;

    if (isVoiceMessage) {
      console.log(`Voice message detected: ${mediaContentType || 'unknown type'}`);
      const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');

      if (ELEVENLABS_API_KEY && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
        // Send processing confirmation
        if (TWILIO_PHONE_NUMBER && contactPhone) {
          try {
            await sendTwilioMessage(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, contactPhone, '🎤 Procesando tu mensaje de voz...');
          } catch (e) {
            console.error('Failed to send voice processing confirmation:', e);
          }
        }
        try {
          effectiveMessageBody = await transcribeVoiceMessage(mediaUrl, mediaContentType, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, ELEVENLABS_API_KEY);
        } catch (err) {
          console.error('Voice transcription error:', err);
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
      const { data } = await supabase.from('whatsapp_conversations').select('*').eq('id', conversationId).single();
      conv = data;
      if (!conv) {
        return new Response(JSON.stringify({ error: 'Conversation not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      botState = conv.bot_state || 'welcome';
      botContext = (conv.bot_context as Record<string, unknown>) || {};
    }

    const msg = effectiveMessageBody.trim().toLowerCase();
    let reply = '';
    let newState = botState;
    let newContext = { ...botContext };

    // ==================== GLOBAL COMMANDS ====================
    const isResetCommand = /^(menu|menú|inicio|reiniciar|reset|salir|volver|empezar)$/i.test(msg);

    // ==================== STALE CONVERSATION RESET ====================
    // If conversation has been idle for 24+ hours AND is not in welcome/awaiting_role, auto-reset
    let isStale = false;
    if (!isSandbox && conv.updated_at) {
      const lastActivity = new Date(conv.updated_at).getTime();
      const hoursSinceActivity = (Date.now() - lastActivity) / (1000 * 60 * 60);
      if (hoursSinceActivity > 24 && !['welcome', 'awaiting_role'].includes(botState)) {
        isStale = true;
        console.log(`Stale conversation detected (${hoursSinceActivity.toFixed(1)}h idle), state was: ${botState}`);
      }
    }

    // ==================== STATE MACHINE ====================
    const effectiveBotState = (isResetCommand || isStale) ? 'welcome' : botState;
    const effectiveContext = (isResetCommand || isStale) ? {} : { ...botContext };

    const stateResult = await handleState({
      botState: effectiveBotState, msg: isResetCommand ? '' : msg, effectiveMessageBody, isSandbox, tenantId, contactPhone,
      conversationId, conv, newContext: effectiveContext, supabase, mediaUrl,
      TWILIO_ACCOUNT_SID: TWILIO_ACCOUNT_SID!, TWILIO_AUTH_TOKEN: TWILIO_AUTH_TOKEN!,
      LOVABLE_API_KEY: LOVABLE_API_KEY!, SUPABASE_URL,
    });

    reply = stateResult.reply;
    newState = stateResult.newState;
    newContext = stateResult.newContext;

    // ==================== PERSIST & REPLY ====================
    if (!isSandbox) {
      await supabase.from('whatsapp_conversations').update({ bot_state: newState, bot_context: newContext }).eq('id', conversationId);

      // Track inbound usage event
      try {
        await supabase.from('whatsapp_usage_events').insert({
          tenant_id: tenantId,
          region: 'LATAM',
          provider: 'twilio',
          event_type: 'message_in',
          units: 1,
          metadata: { conversation_id: conversationId, bot_state: botState },
        });
      } catch (e) { console.error('Usage tracking (in) error:', e); }

      if (reply && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
        const twilioResult = await sendTwilioMessage(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, contactPhone, reply);
        await supabase.from('whatsapp_messages').insert({
          tenant_id: tenantId, conversation_id: conversationId,
          direction: 'out', body: reply, status: 'sent',
          metadata: { provider: 'bot', bot_state: newState },
        });

        // Track outbound usage event
        try {
          await supabase.from('whatsapp_usage_events').insert({
            tenant_id: tenantId,
            region: 'LATAM',
            provider: 'twilio',
            provider_message_id: twilioResult?.sid || null,
            event_type: 'message_out',
            units: 1,
            metadata: { conversation_id: conversationId, bot_state: newState },
          });
        } catch (e) { console.error('Usage tracking (out) error:', e); }
      }
    }

    return new Response(JSON.stringify({ ok: true, reply, state: newState, context: newContext }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('WhatsApp bot error:', errorMessage);
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
        reply = `¡Hola, *${knownEmployee.name}*! 👋 ¡Qué gusto verte de vuelta!\n\nSoy Aria, tu asistente personal. ¿En qué te ayudo hoy?\n\n• 📋 Pendientes y compromisos\n• 📅 Tu agenda del día\n• 📸 Registrar un gasto\n• 💬 Consultar información\n\nCuéntame 😊`;
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
      reply = `✅ ¡Bienvenido al modo empleado! 🎉 (Modo sandbox — autenticación simulada)\n\nSoy Aria, tu asistente personal. Estoy aquí para hacerte la vida más fácil:\n\n• 📋 Recordarte tus pendientes y compromisos\n• 📅 Revisar tu agenda del día\n• 📸 Registrar gastos — solo mándame la foto del ticket\n• 💬 Resolver dudas de la base de conocimientos\n• 📊 Darte un resumen de cómo va tu día\n\n¿Por dónde empezamos? 😊`;
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
        reply = `✅ ¡Qué tal, *${profile.name}*! 🎉 Me da gusto verte por aquí.\n\nTe he registrado con este número para que la próxima vez te reconozca automáticamente, sin necesidad de PIN 🔓\n\nSoy Aria, tu asistente personal. Estoy para lo que necesites:\n\n• 📋 Recordarte tus pendientes y compromisos\n• 📅 Revisar tu agenda del día\n• 📸 Registrar gastos — solo mándame la foto del ticket\n• 💬 Resolver dudas de la base de conocimientos\n• 📊 Darte un resumen de cómo va tu día\n\n¿En qué te ayudo? 😊`;
        newState = 'employee_mode';
        newContext = { role: 'employee', user_id: profile.user_id, user_name: profile.name, profile_id: profile.id };
        await supabase.from('whatsapp_conversations').update({ verified_user_id: profile.user_id }).eq('id', conversationId);
      } else {
        newContext.auth_attempts = attempts;
        reply = `Mmm, ese PIN no coincide 🤔 (Intento ${attempts}/3).\n\nRevísalo e intenta de nuevo. Si no lo recuerdas, el administrador puede ayudarte a restablecerlo.`;
      }
    }

  } else if (botState === 'client_mode') {
    reply = await getAIResponse(LOVABLE_API_KEY, tenantId, supabase, 'client', effectiveMessageBody, conv);

  } else if (botState === 'employee_mode') {
    const isExpenseCaptureIntent =
      /\b(registra|registrar|agrega|agregar|captura|capturar|sube|subir|guarda|guardar|carga|cargar)\b/i.test(msg) &&
      /(gasto|comprobante|ticket|factura|recibo)/i.test(msg);

    if (mediaUrl) {
      reply = await processReceiptOCR(mediaUrl, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, LOVABLE_API_KEY, tenantId, newContext, supabase, effectiveMessageBody);
    } else if (msg.includes('credencial') || msg.includes('contraseña') || msg.includes('password') || msg.includes('usuario y contraseña') || msg.includes('acceso')) {
      reply = '🔐 Vamos a guardar una credencial compartida.\n\n¿De qué *plataforma o servicio* es? (Ej: Gmail, Hosting, CPanel, Facebook Ads...)';
      newState = 'credential_collect_platform';
    } else if (isExpenseCaptureIntent) {
      reply = '📸 Envíame la *foto del comprobante* y extraeré los datos automáticamente con OCR.\n\nTambién puedes escribir el gasto manualmente:\n_Ej: "Gasto $350 comida con cliente"_';
      newState = 'employee_expense';
    } else {
      // Delegate scheduling/agenda/calendar/intents to AI tools.
      reply = await getAIResponse(LOVABLE_API_KEY, tenantId, supabase, 'employee', effectiveMessageBody, conv);
    }

  } else if (botState === 'credential_collect_platform') {
    const platformName = effectiveMessageBody.trim();
    newContext = { ...newContext, cred_platform: platformName };
    reply = `📌 Plataforma: *${platformName}*\n\nAhora escríbeme el *usuario o email* de acceso:`;
    newState = 'credential_collect_username';

  } else if (botState === 'credential_collect_username') {
    const username = effectiveMessageBody.trim();
    newContext = { ...newContext, cred_username: username };
    reply = `👤 Usuario: *${username}*\n\nAhora escríbeme la *contraseña*:`;
    newState = 'credential_collect_password';

  } else if (botState === 'credential_collect_password') {
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
          console.error('Credential vault failed, saving directly');
          await supabase.from('shared_credentials').insert({ tenant_id: tenantId, platform_name: platform, username, password_encrypted: password, notes: 'Agregada vía WhatsApp bot', created_by: newContext.user_id as string || null });
        }
      } catch (vaultErr) {
        console.error('Credential vault error:', vaultErr);
        await supabase.from('shared_credentials').insert({ tenant_id: tenantId, platform_name: platform, username, password_encrypted: password, notes: 'Agregada vía WhatsApp bot', created_by: newContext.user_id as string || null });
      }
    }
    delete newContext.cred_platform;
    delete newContext.cred_username;
    reply = `✅ ¡Credencial guardada exitosamente!\n\n🔐 *${platform}*\n👤 ${username}\n🔑 ••••••••\n\nTodos los miembros del equipo pueden verla en la sección *Credenciales* de la app.\n\n¿Te ayudo con algo más?`;
    newState = 'employee_mode';

  } else if (botState === 'employee_expense') {
    if (mediaUrl) {
      reply = await processReceiptOCR(mediaUrl, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, LOVABLE_API_KEY, tenantId, newContext, supabase, effectiveMessageBody);
      newState = 'employee_mode';
    } else {
      const amountMatch = effectiveMessageBody.match(/\$?([\d,]+\.?\d*)/);
      const parsedAmount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : NaN;

      if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
        const description = effectiveMessageBody.replace(/\$?[\d,]+\.?\d*/, '').replace(/gasto/i, '').trim() || 'Gasto sin descripción';
        const { error: insertError } = await supabase.from('expenses').insert({
          tenant_id: tenantId,
          user_id: newContext.user_id as string,
          amount: parsedAmount,
          description,
          expense_date: new Date().toISOString().split('T')[0],
          status: 'pending',
        });

        if (insertError) {
          console.error('Expense insert error:', insertError);
          reply = '❌ No pude guardar el gasto en este momento. Intenta nuevamente en unos segundos.';
        } else {
          reply = `✅ Gasto registrado:\n• Monto: $${parsedAmount.toFixed(2)} MXN\n• Descripción: ${description}\n• Fecha: ${new Date().toLocaleDateString('es-MX')}\n\n¿Algo más en lo que pueda ayudarte?`;
          newState = 'employee_mode';
        }
      } else {
        // Escape: delegate to AI if the message looks like another intent
        const wantsOtherTask = /(temperatura|clima|agenda|cita|recordatorio|lista|listar|detalle|resumen|buscar|investiga|dime|qué|que|c[aá]l|cu[aá]nto|cancela|salir|regresa|hola|ayuda|help)/i.test(msg);

        if (wantsOtherTask) {
          reply = await getAIResponse(LOVABLE_API_KEY, tenantId, supabase, 'employee', effectiveMessageBody, conv);
          newState = 'employee_mode';
        } else {
          reply = 'No pude detectar el monto. Por favor incluye la cantidad, ej: _"$350 comida con cliente"_\n\n_Escribe *menu* para volver al inicio._';
        }
      }
    }

  } else {
    // ==================== UNKNOWN STATE FALLBACK ====================
    console.error(`Unknown bot state: "${botState}", resetting to welcome`);
    newState = 'welcome';
    newContext = {};
    reply = '¡Hola! 👋 Parece que tuvimos un pequeño desajuste. Empecemos de nuevo.\n\n¿Vienes como *cliente* o eres parte del equipo (*empleado*)?\n\n1️⃣ Soy cliente\n2️⃣ Soy empleado';
    newState = 'awaiting_role';
  }

  // ==================== EMPTY REPLY GUARD ====================
  if (!reply || reply.trim() === '') {
    console.error(`Empty reply detected. State: ${botState} → ${newState}, msg: "${msg.substring(0, 50)}"`);
    reply = 'Disculpa, no pude procesar tu mensaje. ¿Podrías intentarlo de nuevo? 🙏\n\n_Escribe *menu* para volver al inicio._';
  }

  return { reply, newState, newContext };
}
