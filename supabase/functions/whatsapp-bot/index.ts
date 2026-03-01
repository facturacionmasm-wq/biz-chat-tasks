import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

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

    // Detect if this is a voice message
    const isVoiceMessage = mediaUrl && (
      (mediaContentType && mediaContentType.startsWith('audio/')) ||
      (mediaUrl && /\.(ogg|opus|mp3|m4a|amr|wav)(\?|$)/i.test(mediaUrl))
    );

    let effectiveMessageBody = messageBody;

    // Transcribe voice messages using ElevenLabs STT
    if (isVoiceMessage) {
      console.log(`Voice message detected: ${mediaContentType || 'unknown type'}`);
      const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
      
      if (ELEVENLABS_API_KEY && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
        // Send "processing" confirmation before transcribing
        if (TWILIO_PHONE_NUMBER && contactPhone) {
          try {
            await sendTwilioMessage(
              TWILIO_ACCOUNT_SID,
              TWILIO_AUTH_TOKEN,
              TWILIO_PHONE_NUMBER,
              contactPhone,
              '🎤 Procesando tu mensaje de voz...'
            );
          } catch (e) {
            console.error('Failed to send voice processing confirmation:', e);
          }
        }

        try {
          // Download audio from Twilio
          const basicAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
          const audioRes = await fetch(mediaUrl, {
            headers: { Authorization: `Basic ${basicAuth}` },
          });

          if (audioRes.ok) {
            const audioBuffer = await audioRes.arrayBuffer();
            const audioBlob = new Blob([audioBuffer], { type: mediaContentType || 'audio/ogg' });

            // Send to ElevenLabs STT
            const formData = new FormData();
            formData.append('file', audioBlob, 'voice.ogg');
            formData.append('model_id', 'scribe_v2');
            formData.append('language_code', 'spa');
            formData.append('tag_audio_events', 'false');
            formData.append('diarize', 'false');

            const sttRes = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
              method: 'POST',
              headers: { 'xi-api-key': ELEVENLABS_API_KEY },
              body: formData,
            });

            if (sttRes.ok) {
              const sttData = await sttRes.json();
              const transcribedText = sttData.text?.trim();
              if (transcribedText) {
                console.log(`Voice transcribed: "${transcribedText.substring(0, 100)}"`);
                effectiveMessageBody = transcribedText;
              } else {
                console.log('STT returned empty text');
                effectiveMessageBody = '[Mensaje de voz no reconocido]';
              }
            } else {
              console.error('ElevenLabs STT error:', sttRes.status, await sttRes.text());
              effectiveMessageBody = '[Error al transcribir mensaje de voz]';
            }
          } else {
            console.error('Failed to download audio:', audioRes.status);
            effectiveMessageBody = '[No se pudo descargar el audio]';
          }
        } catch (err) {
          console.error('Voice transcription error:', err);
          effectiveMessageBody = '[Error procesando mensaje de voz]';
        }
      } else {
        console.log('Missing ElevenLabs or Twilio credentials for STT');
        effectiveMessageBody = '[Mensaje de voz - transcripción no disponible]';
      }
    }

    if (!effectiveMessageBody) {
      return new Response(JSON.stringify({ error: 'Missing messageBody' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === SANDBOX MODE: skip DB lookups, use passed state ===
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
      const { data } = await supabase
        .from('whatsapp_conversations')
        .select('*')
        .eq('id', conversationId)
        .single();
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

    // ==================== STATE MACHINE ====================

    if (botState === 'welcome') {
      let companyName = 'nuestra empresa';
      if (!isSandbox) {
        const { data: tenant } = await supabase
          .from('tenants')
          .select('name')
          .eq('id', tenantId)
          .single();
        companyName = tenant?.name || companyName;

        // Check if this phone belongs to a known employee
        const { data: knownEmployee } = await supabase
          .from('profiles')
          .select('id, user_id, name, tenant_id')
          .eq('whatsapp_number', contactPhone)
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .maybeSingle();

        if (knownEmployee) {
          // Auto-login employee — skip PIN
          reply = `¡Hola, *${knownEmployee.name}*! 👋 ¡Qué gusto verte de vuelta!\n\nSoy Aria, tu asistente personal. ¿En qué te ayudo hoy?\n\n• 📋 Pendientes y compromisos\n• 📅 Tu agenda del día\n• 📸 Registrar un gasto\n• 💬 Consultar información\n\nCuéntame 😊`;
          newState = 'employee_mode';
          newContext = {
            role: 'employee',
            user_id: knownEmployee.user_id,
            user_name: knownEmployee.name,
            profile_id: knownEmployee.id,
          };

          await supabase
            .from('whatsapp_conversations')
            .update({ verified_user_id: knownEmployee.user_id })
            .eq('id', conversationId);

          // Update state and return early — skip the rest of state machine
        } else {
          // Check if this is a known client contact
          const { data: knownContact } = await supabase
            .from('contacts')
            .select('name')
            .eq('phone', contactPhone)
            .eq('tenant_id', tenantId)
            .maybeSingle();

          if (knownContact?.name) {
            reply = `¡Hola de nuevo, *${knownContact.name}*! 👋 Qué gusto que nos contactes otra vez.\n\nSoy *Aria*, tu asistente virtual de *${companyName}*. ¿En qué puedo ayudarte hoy?\n\n• 📋 Conocer nuestros servicios\n• 📅 Agendar una cita\n• 👤 Hablar con alguien del equipo\n\nEstoy para servirte 💬`;
            newState = 'client_mode';
            newContext = { role: 'client', contact_name: knownContact.name };
          } else {
            reply = `¡Hola! 👋 ¡Qué gusto saludarte! Soy *Aria*, tu asistente virtual de *${companyName}*.\n\nEstoy aquí para lo que necesites. Dime, ¿vienes como *cliente* o eres parte del equipo (*empleado*)?\n\n1️⃣ Soy cliente\n2️⃣ Soy empleado`;
            newState = 'awaiting_role';
          }
        }
      } else {
        // Sandbox mode
        reply = `¡Hola! 👋 ¡Qué gusto saludarte! Soy *Aria*, tu asistente virtual de *${companyName}*.\n\nEstoy aquí para lo que necesites. Dime, ¿vienes como *cliente* o eres parte del equipo (*empleado*)?\n\n1️⃣ Soy cliente\n2️⃣ Soy empleado`;
        newState = 'awaiting_role';
      }

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
        // Basic email validation
        const emailMatch = effectiveMessageBody.trim().match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
        if (emailMatch) {
          clientEmail = emailMatch[0];
        }
      }

      // Save contact to phonebook
      if (!isSandbox) {
        await supabase.from('contacts').upsert({
          tenant_id: tenantId,
          phone: contactPhone,
          name: clientName,
          email: clientEmail,
          source: 'whatsapp',
        }, { onConflict: 'tenant_id,phone' });
      }

      newContext = { ...newContext, contact_email: clientEmail };

      reply = `¡Perfecto, *${clientName}*! Ya te tengo registrado(a) 📝\n\nAhora sí, cuéntame ¿en qué te puedo ayudar?\n\n• 📋 Conocer nuestros servicios\n• 📅 Agendar una cita con alguno de nuestros colaboradores\n• 👤 Comunicarte directamente con alguien del equipo\n\nEstoy para servirte 💬`;
      newState = 'client_mode';

    } else if (botState === 'employee_auth') {
      // Verify PIN
      const attempts = ((newContext.auth_attempts as number) || 0) + 1;

      if (attempts > 3) {
        reply = '😔 Entiendo la frustración, pero por seguridad no puedo seguir intentando. Te recomiendo contactar al administrador para restablecer tu PIN.\n\n¡No te preocupes, todo tiene solución! 💪';
        newState = 'welcome';
        newContext = {};
      } else if (isSandbox) {
        // In sandbox mode, simulate successful auth
        reply = `✅ ¡Bienvenido al modo empleado! 🎉 (Modo sandbox — autenticación simulada)\n\nSoy Aria, tu asistente personal. Estoy aquí para hacerte la vida más fácil:\n\n• 📋 Recordarte tus pendientes y compromisos\n• 📅 Revisar tu agenda del día\n• 📸 Registrar gastos — solo mándame la foto del ticket\n• 💬 Resolver dudas de la base de conocimientos\n• 📊 Darte un resumen de cómo va tu día\n\n¿Por dónde empezamos? 😊`;
        newState = 'employee_mode';
        newContext = { role: 'employee', user_id: 'sandbox_user', user_name: 'Usuario Sandbox', profile_id: 'sandbox' };
      } else {
        // Verify PIN via pin-service (server-side PBKDF2 hashing)
        const pinResponse = await fetch(
          `${SUPABASE_URL}/functions/v1/pin-service`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({ action: 'verify_pin', pin: msg.trim(), tenant_id: tenantId }),
          }
        );
        const pinResult = await pinResponse.json();
        const profile = pinResult.match ? { id: pinResult.profile_id, user_id: pinResult.user_id, name: pinResult.name } : null;

        if (profile) {
          // Save whatsapp_number to profile so next time we auto-recognize
          await supabase
            .from('profiles')
            .update({ whatsapp_number: contactPhone })
            .eq('id', profile.id);

          reply = `✅ ¡Qué tal, *${profile.name}*! 🎉 Me da gusto verte por aquí.\n\nTe he registrado con este número para que la próxima vez te reconozca automáticamente, sin necesidad de PIN 🔓\n\nSoy Aria, tu asistente personal. Estoy para lo que necesites:\n\n• 📋 Recordarte tus pendientes y compromisos\n• 📅 Revisar tu agenda del día\n• 📸 Registrar gastos — solo mándame la foto del ticket\n• 💬 Resolver dudas de la base de conocimientos\n• 📊 Darte un resumen de cómo va tu día\n\n¿En qué te ayudo? 😊`;
          newState = 'employee_mode';
          newContext = { 
            role: 'employee', 
            user_id: profile.user_id, 
            user_name: profile.name,
            profile_id: profile.id,
          };

          await supabase
            .from('whatsapp_conversations')
            .update({ verified_user_id: profile.user_id })
            .eq('id', conversationId);
        } else {
          newContext.auth_attempts = attempts;
          reply = `Mmm, ese PIN no coincide 🤔 (Intento ${attempts}/3).\n\nRevísalo e intenta de nuevo. Si no lo recuerdas, el administrador puede ayudarte a restablecerlo.`;
        }
      }

    } else if (botState === 'client_mode') {
      // AI-powered client assistant
      reply = await getAIResponse(LOVABLE_API_KEY!, tenantId, supabase, 'client', effectiveMessageBody, conv);

    } else if (botState === 'employee_mode') {
      // Check for media/receipt - OCR processing
      if (mediaUrl) {
        reply = await processReceiptOCR(mediaUrl, TWILIO_ACCOUNT_SID!, TWILIO_AUTH_TOKEN!, LOVABLE_API_KEY!, tenantId, newContext, supabase);
        
      } else if (msg.includes('credencial') || msg.includes('contraseña') || msg.includes('password') || msg.includes('usuario y contraseña') || msg.includes('acceso')) {
        reply = '🔐 Vamos a guardar una credencial compartida.\n\n¿De qué *plataforma o servicio* es? (Ej: Gmail, Hosting, CPanel, Facebook Ads...)';
        newState = 'credential_collect_platform';
        
      } else if (msg.includes('gasto') || msg.includes('comprobante') || msg.includes('ticket') || msg.includes('factura') || msg.includes('recibo')) {
        reply = '📸 Envíame la *foto del comprobante* y extraeré los datos automáticamente con OCR.\n\nTambién puedes escribir el gasto manualmente:\n_Ej: "Gasto $350 comida con cliente"_';
        newState = 'employee_expense';
        
      } else if (msg.includes('agenda') || msg.includes('citas') || msg.includes('calendario')) {
        // Fetch today's appointments
        const today = new Date().toISOString().split('T')[0];
        const { data: appointments } = await supabase
          .from('appointments')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('user_id', newContext.user_id as string)
          .gte('start_at', `${today}T00:00:00`)
          .lte('start_at', `${today}T23:59:59`)
          .order('start_at');

        if (appointments && appointments.length > 0) {
          reply = `📅 *Tu agenda de hoy:*\n\n${appointments.map((a: any, i: number) => {
            const time = new Date(a.start_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
            return `${i + 1}. ${time} - ${a.contact_name} (${a.service_type || 'General'})`;
          }).join('\n')}`;
        } else {
          reply = '📅 No tienes citas programadas para hoy.';
        }

      } else {
        // AI-powered employee assistant
        reply = await getAIResponse(LOVABLE_API_KEY!, tenantId, supabase, 'employee', effectiveMessageBody, conv);
      }

    // ==================== CREDENTIAL CAPTURE FLOW ====================
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

      // Save to shared_credentials table via credential-vault (encrypted)
      if (!isSandbox) {
        try {
          const vaultResponse = await fetch(
            `${SUPABASE_URL}/functions/v1/credential-vault`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
              body: JSON.stringify({
                action: 'encrypt_save',
                tenant_id: tenantId,
                user_id: newContext.user_id as string || null,
                platform_name: platform,
                username: username,
                password: password,
                notes: 'Agregada vía WhatsApp bot',
              }),
            }
          );
          // Fallback: if vault fails, save plaintext
          if (!vaultResponse.ok) {
            console.error('Credential vault failed, saving directly');
            await supabase.from('shared_credentials').insert({
              tenant_id: tenantId,
              platform_name: platform,
              username: username,
              password_encrypted: password,
              notes: 'Agregada vía WhatsApp bot',
              created_by: newContext.user_id as string || null,
            });
          }
        } catch (vaultErr) {
          console.error('Credential vault error:', vaultErr);
          await supabase.from('shared_credentials').insert({
            tenant_id: tenantId,
            platform_name: platform,
            username: username,
            password_encrypted: password,
            notes: 'Agregada vía WhatsApp bot',
            created_by: newContext.user_id as string || null,
          });
        }
      }

      // Clean up credential context
      delete newContext.cred_platform;
      delete newContext.cred_username;

      reply = `✅ ¡Credencial guardada exitosamente!\n\n🔐 *${platform}*\n👤 ${username}\n🔑 ••••••••\n\nTodos los miembros del equipo pueden verla en la sección *Credenciales* de la app.\n\n¿Te ayudo con algo más?`;
      newState = 'employee_mode';

    } else if (botState === 'employee_expense') {
      // Check for media/receipt - OCR processing
      if (mediaUrl) {
        reply = await processReceiptOCR(mediaUrl, TWILIO_ACCOUNT_SID!, TWILIO_AUTH_TOKEN!, LOVABLE_API_KEY!, tenantId, newContext, supabase);
        newState = 'employee_mode';
      } else {
        // Parse manual expense entry
        const amountMatch = effectiveMessageBody.match(/\$?([\d,]+\.?\d*)/);
        if (amountMatch) {
          const amount = parseFloat(amountMatch[1].replace(',', ''));
          const description = effectiveMessageBody.replace(/\$?[\d,]+\.?\d*/, '').replace(/gasto/i, '').trim() || 'Gasto sin descripción';
          
          await supabase.from('expenses').insert({
            tenant_id: tenantId,
            user_id: newContext.user_id as string,
            amount,
            description,
            expense_date: new Date().toISOString().split('T')[0],
            status: 'pending',
          });

          reply = `✅ Gasto registrado:\n• Monto: $${amount.toFixed(2)} MXN\n• Descripción: ${description}\n• Fecha: ${new Date().toLocaleDateString('es-MX')}\n\n¿Algo más en lo que pueda ayudarte?`;
          newState = 'employee_mode';
        } else {
          reply = 'No pude detectar el monto. Por favor incluye la cantidad, ej: _"$350 comida con cliente"_';
        }
      }
    }

    // In sandbox mode, skip DB updates and Twilio sending
    if (!isSandbox) {
      // Update conversation bot state
      await supabase
        .from('whatsapp_conversations')
        .update({
          bot_state: newState,
          bot_context: newContext,
        })
        .eq('id', conversationId);

      // Send reply via Twilio
      if (reply && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
        await sendTwilioMessage(
          TWILIO_ACCOUNT_SID,
          TWILIO_AUTH_TOKEN,
          TWILIO_PHONE_NUMBER,
          contactPhone,
          reply
        );

        // Save bot reply to DB
        await supabase.from('whatsapp_messages').insert({
          tenant_id: tenantId,
          conversation_id: conversationId,
          direction: 'out',
          body: reply,
          status: 'sent',
          metadata: { provider: 'bot', bot_state: newState },
        });
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

// ==================== HELPERS ====================

async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sendTwilioMessage(
  accountSid: string,
  authToken: string,
  fromNumber: string,
  toNumber: string,
  body: string
) {
  const fromWhatsApp = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;
  const toWhatsApp = toNumber.startsWith('whatsapp:') ? toNumber : `whatsapp:${toNumber}`;
  const basicAuth = btoa(`${accountSid}:${authToken}`);

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: fromWhatsApp,
        To: toWhatsApp,
        Body: body,
      }).toString(),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    console.error('Twilio send error:', JSON.stringify(data));
  }
  return data;
}

// Tool definitions for function calling
const AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'schedule_appointment',
      description: 'Agendar una cita/appointment para un cliente o empleado. Usa esto cuando alguien quiera agendar, programar, o reservar una cita.',
      parameters: {
        type: 'object',
        properties: {
          contact_name: { type: 'string', description: 'Nombre del cliente o contacto' },
          contact_phone: { type: 'string', description: 'Teléfono del contacto (si se tiene)' },
          contact_email: { type: 'string', description: 'Email del contacto (si se tiene)' },
          date: { type: 'string', description: 'Fecha de la cita en formato YYYY-MM-DD' },
          time: { type: 'string', description: 'Hora de la cita en formato HH:MM (24h)' },
          service_type: { type: 'string', description: 'Tipo de servicio o motivo de la cita' },
          employee_name: { type: 'string', description: 'Nombre del empleado con quien se quiere la cita (opcional)' },
          notes: { type: 'string', description: 'Notas adicionales' },
        },
        required: ['contact_name', 'date', 'time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'Verificar disponibilidad de horarios para una fecha específica. Usa esto cuando pregunten por horarios disponibles.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Fecha a consultar en formato YYYY-MM-DD' },
          employee_name: { type: 'string', description: 'Nombre del empleado (opcional)' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_reminder',
      description: 'Crear un recordatorio para el usuario. Usa esto cuando pidan "recuérdame", "avísame", "no me dejes olvidar", etc.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Mensaje del recordatorio - qué debe recordar' },
          remind_at: { type: 'string', description: 'Fecha y hora del recordatorio en formato ISO 8601 (YYYY-MM-DDTHH:MM:SS). Si solo dicen hora, usar la fecha de hoy.' },
        },
        required: ['message', 'remind_at'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_today_agenda',
      description: 'Obtener la agenda/citas del día de hoy para el usuario. Usa cuando pregunten por su agenda, citas, o qué tienen hoy.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pending_expenses',
      description: 'Obtener gastos pendientes de aprobación del usuario.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_bot_instruction',
      description: 'Guardar una corrección, instrucción o regla nueva para modificar el comportamiento del bot. Usa cuando un humano diga cosas como: "cuando te pregunten X responde Y", "no digas X", "aprende esto", "corrige esto", "de ahora en adelante haz X", "tu respuesta sobre X estuvo mal, la correcta es Y". Esta herramienta reprograma el comportamiento futuro del bot.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Título corto y descriptivo de la instrucción/corrección (ej: "Respuesta correcta sobre precios", "No mencionar competencia")' },
          instruction: { type: 'string', description: 'La instrucción completa, corrección o nueva regla de comportamiento. Incluye el contexto de qué pregunta/situación aplica y cuál debe ser la respuesta o comportamiento correcto.' },
          correction_type: { type: 'string', enum: ['correction', 'new_rule', 'knowledge', 'personality'], description: 'Tipo: correction=corregir respuesta incorrecta, new_rule=nueva regla de comportamiento, knowledge=nuevo conocimiento/dato, personality=ajuste de personalidad/tono' },
        },
        required: ['title', 'instruction', 'correction_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_bot_instructions',
      description: 'Listar las instrucciones/correcciones activas del bot. Usa cuando pregunten "qué reglas tienes", "qué has aprendido", "muéstrame tus correcciones".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_bot_instruction',
      description: 'Eliminar/desactivar una instrucción o corrección del bot. Usa cuando digan "olvida la regla de X", "elimina la corrección sobre Y", "ya no apliques eso".',
      parameters: {
        type: 'object',
        properties: {
          search_term: { type: 'string', description: 'Término de búsqueda para encontrar la instrucción a eliminar (busca en título y contenido)' },
        },
        required: ['search_term'],
      },
    },
  },
];

// Execute a tool call from the AI
async function executeTool(
  toolName: string,
  args: any,
  tenantId: string,
  supabase: any,
  conversation: any,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<string> {
  const userId = conversation.bot_context?.user_id;
  const contactPhone = conversation.contact_phone;

  if (toolName === 'schedule_appointment') {
    const { contact_name, contact_phone: cPhone, contact_email, date, time, service_type, employee_name, notes } = args;
    
    // Find employee if specified
    let employeeId: string | null = null;
    if (employee_name) {
      const { data: emp } = await supabase
        .from('profiles')
        .select('user_id, name')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .ilike('name', `%${employee_name}%`)
        .limit(1)
        .maybeSingle();
      if (emp) employeeId = emp.user_id;
    }

    const startAt = new Date(`${date}T${time}:00`);
    const endAt = new Date(startAt);
    endAt.setMinutes(endAt.getMinutes() + 30);

    const { data: apt, error } = await supabase
      .from('appointments')
      .insert({
        tenant_id: tenantId,
        contact_name: contact_name,
        contact_phone: cPhone || contactPhone || null,
        contact_email: contact_email || null,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        service_type: service_type || 'General',
        user_id: employeeId || userId || null,
        notes: notes || null,
        source: 'whatsapp',
        status: 'scheduled',
      })
      .select('id, start_at, end_at, contact_name')
      .single();

    if (error) return JSON.stringify({ error: error.message });
    
    return JSON.stringify({
      success: true,
      appointment_id: apt.id,
      contact_name: apt.contact_name,
      date: startAt.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }),
      time: startAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      employee: employee_name || 'sin asignar',
    });
  }

  if (toolName === 'check_availability') {
    const { date, employee_name } = args;
    let employeeId: string | null = null;
    if (employee_name) {
      const { data: emp } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .ilike('name', `%${employee_name}%`)
        .limit(1)
        .maybeSingle();
      if (emp) employeeId = emp.user_id;
    }

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/voice-scheduling`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ action: 'check_availability', data: { tenant_id: tenantId, date, employee_id: employeeId } }),
      });
      const result = await res.json();
      return JSON.stringify(result);
    } catch (err) {
      return JSON.stringify({ error: 'No se pudo verificar disponibilidad' });
    }
  }

  if (toolName === 'create_reminder') {
    const { message, remind_at } = args;
    const targetUserId = userId;
    if (!targetUserId) return JSON.stringify({ error: 'No se pudo identificar al usuario' });

    // Get tenant timezone for correct conversion
    const { data: tenantData } = await supabase
      .from('tenants')
      .select('timezone')
      .eq('id', tenantId)
      .single();
    const tz = tenantData?.timezone || 'America/Mexico_City';

    // Parse the remind_at — if no timezone offset, treat as tenant local time
    let remindDate: Date;
    const raw = remind_at;
    if (/[+-]\d{2}:\d{2}$/.test(raw) || raw.endsWith('Z')) {
      // Already has timezone info
      remindDate = new Date(raw);
    } else {
      // No timezone — interpret in tenant timezone by appending offset
      // Create a date string and use Intl to get the correct UTC equivalent
      const tempDate = new Date(raw);
      // Get the timezone offset for the tenant timezone at that date
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
      const parts = formatter.formatToParts(tempDate);
      const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
      // Parse offset like "GMT-6" or "GMT-5"
      const offsetMatch = offsetPart.match(/GMT([+-]?\d+)/);
      if (offsetMatch) {
        const offsetHours = parseInt(offsetMatch[1]);
        const sign = offsetHours >= 0 ? '+' : '-';
        const absHours = Math.abs(offsetHours).toString().padStart(2, '0');
        remindDate = new Date(`${raw}${sign}${absHours}:00`);
      } else {
        remindDate = new Date(raw);
      }
    }

    if (isNaN(remindDate.getTime())) {
      return JSON.stringify({ error: `No pude interpretar la fecha/hora: ${remind_at}. Usa formato YYYY-MM-DDTHH:MM:SS` });
    }

    // Prevent reminders in the past
    if (remindDate.getTime() < Date.now() - 60000) {
      return JSON.stringify({ error: 'La fecha/hora del recordatorio ya pasó. Indica una fecha futura.' });
    }

    const { data: inserted, error } = await supabase.from('reminders').insert({
      tenant_id: tenantId,
      user_id: targetUserId,
      message,
      remind_at: remindDate.toISOString(),
      status: 'pending',
      source: 'whatsapp',
      timezone: tz,
    }).select('id').single();

    if (error) return JSON.stringify({ error: error.message });

    // Format display in tenant timezone
    const displayTime = remindDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: tz });
    const displayDate = remindDate.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
    
    return JSON.stringify({
      success: true,
      reminder_id: inserted.id,
      message,
      remind_at: displayTime,
      date: displayDate,
    });
  }

  if (toolName === 'get_today_agenda') {
    const today = new Date().toISOString().split('T')[0];
    const targetUserId = userId;
    
    let query = supabase
      .from('appointments')
      .select('start_at, end_at, contact_name, service_type, status')
      .eq('tenant_id', tenantId)
      .gte('start_at', `${today}T00:00:00`)
      .lte('start_at', `${today}T23:59:59`)
      .neq('status', 'cancelled')
      .order('start_at');
    
    if (targetUserId) query = query.eq('user_id', targetUserId);
    const { data: apts } = await query;
    
    return JSON.stringify({
      date: today,
      appointments: (apts || []).map((a: any) => ({
        time: new Date(a.start_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
        end_time: new Date(a.end_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
        contact: a.contact_name,
        service: a.service_type || 'General',
        status: a.status,
      })),
      count: (apts || []).length,
    });
  }

  if (toolName === 'get_pending_expenses') {
    const targetUserId = userId;
    if (!targetUserId) return JSON.stringify({ expenses: [], count: 0 });
    
    const { data: expenses } = await supabase
      .from('expenses')
      .select('amount, description, category, expense_date, status')
      .eq('user_id', targetUserId)
      .eq('status', 'pending')
      .order('expense_date', { ascending: false })
      .limit(10);
    
    return JSON.stringify({
      expenses: (expenses || []).map((e: any) => ({
        amount: e.amount,
        description: e.description,
        category: e.category,
        date: e.expense_date,
      })),
      count: (expenses || []).length,
    });
  }

  if (toolName === 'save_bot_instruction') {
    const { title, instruction, correction_type } = args;
    const userId = conversation.bot_context?.user_id;
    
    // Check if user has admin/owner role (only authorized users can reprogram)
    let isAuthorized = false;
    if (userId) {
      const { data: role } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .in('role', ['super_admin', 'owner', 'admin'])
        .maybeSingle();
      isAuthorized = !!role;
    }

    if (!isAuthorized) {
      return JSON.stringify({ error: 'No tienes permisos para reprogramar el bot. Solo administradores pueden hacerlo.' });
    }

    const tagMap: Record<string, string[]> = {
      correction: ['bot-correction', 'auto-training', 'whatsapp'],
      new_rule: ['bot-rule', 'auto-training', 'whatsapp'],
      knowledge: ['bot-knowledge', 'auto-training', 'whatsapp'],
      personality: ['bot-personality', 'auto-training', 'whatsapp'],
    };

    const { data: saved, error } = await supabase
      .from('knowledge_items')
      .insert({
        tenant_id: tenantId,
        title: `[Auto-entrenamiento] ${title}`,
        content: `TIPO: ${correction_type}\nINSTRUCCIÓN: ${instruction}\n\nRegistrado por: ${conversation.bot_context?.user_name || 'desconocido'}\nFecha: ${new Date().toISOString()}`,
        category: 'Entrenamiento IA',
        tags: tagMap[correction_type] || ['auto-training', 'whatsapp'],
        visibility: 'internal',
        author_id: userId,
        active: true,
      })
      .select('id, title')
      .single();

    if (error) return JSON.stringify({ error: error.message });

    // Log to audit
    await supabase.from('audit_events').insert({
      tenant_id: tenantId,
      event_type: 'bot_self_reprogram',
      actor_id: userId,
      resource_type: 'knowledge_items',
      resource_id: saved.id,
      payload: { title, correction_type, instruction: instruction.substring(0, 200) },
    });

    return JSON.stringify({
      success: true,
      id: saved.id,
      title: saved.title,
      type: correction_type,
      message: 'Instrucción guardada. El cambio se aplicará inmediatamente en futuras conversaciones.',
    });
  }

  if (toolName === 'list_bot_instructions') {
    const { data: instructions } = await supabase
      .from('knowledge_items')
      .select('id, title, content, tags, created_at')
      .eq('tenant_id', tenantId)
      .eq('category', 'Entrenamiento IA')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(20);

    return JSON.stringify({
      instructions: (instructions || []).map((i: any) => ({
        id: i.id,
        title: i.title,
        preview: i.content?.substring(0, 150),
        tags: i.tags,
        created: i.created_at,
      })),
      count: (instructions || []).length,
    });
  }

  if (toolName === 'delete_bot_instruction') {
    const { search_term } = args;
    const userId = conversation.bot_context?.user_id;

    // Check admin permissions
    let isAuthorized = false;
    if (userId) {
      const { data: role } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .in('role', ['super_admin', 'owner', 'admin'])
        .maybeSingle();
      isAuthorized = !!role;
    }

    if (!isAuthorized) {
      return JSON.stringify({ error: 'No tienes permisos para eliminar instrucciones del bot.' });
    }

    // Find matching instruction
    const { data: matches } = await supabase
      .from('knowledge_items')
      .select('id, title')
      .eq('tenant_id', tenantId)
      .eq('category', 'Entrenamiento IA')
      .eq('active', true)
      .or(`title.ilike.%${search_term}%,content.ilike.%${search_term}%`)
      .limit(5);

    if (!matches || matches.length === 0) {
      return JSON.stringify({ error: `No encontré instrucciones que coincidan con "${search_term}"` });
    }

    // Deactivate all matches
    const ids = matches.map((m: any) => m.id);
    await supabase
      .from('knowledge_items')
      .update({ active: false, deleted_at: new Date().toISOString() })
      .in('id', ids);

    return JSON.stringify({
      success: true,
      deleted_count: matches.length,
      deleted: matches.map((m: any) => m.title),
      message: `Se eliminaron ${matches.length} instrucción(es) del bot.`,
    });
  }

  return JSON.stringify({ error: 'Unknown tool' });
}

async function getAIResponse(
  apiKey: string,
  tenantId: string,
  supabase: any,
  mode: 'client' | 'employee',
  userMessage: string,
  conversation: any
): Promise<string> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // === KNOWLEDGE RETRIEVAL ===
  const { data: corrections } = await supabase
    .from('knowledge_items')
    .select('title, content, category, tags')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .eq('category', 'Entrenamiento IA')
    .order('updated_at', { ascending: false })
    .limit(15);
  
  const { data: generalKnowledge } = await supabase
    .from('knowledge_items')
    .select('title, content, category, tags')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .neq('category', 'Entrenamiento IA')
    .order('updated_at', { ascending: false })
    .limit(30);
  
  const allKnowledge = [...(corrections || []), ...(generalKnowledge || [])];
  const knowledgeContext = allKnowledge.map((k: any) => {
    const prefix = k.category === 'Entrenamiento IA' ? '⚠️ CORRECCIÓN PRIORITARIA' : (k.category || 'General');
    const content = k.category === 'Entrenamiento IA' ? k.content : k.content?.substring(0, 800);
    return `[${prefix}] ${k.title}:\n${content}`;
  }).join('\n\n') || '';

  // Get recent messages for context
  const { data: recentMsgs } = await supabase
    .from('whatsapp_messages')
    .select('direction, body')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const chatHistory = (recentMsgs || []).reverse().map((m: any) => ({
    role: m.direction === 'in' ? 'user' : 'assistant',
    content: m.body || '',
  }));

  // Get employees list
  const { data: employees } = await supabase
    .from('profiles')
    .select('name, user_id, email, phone')
    .eq('tenant_id', tenantId)
    .eq('status', 'active');

  const employeeList = employees?.map((e: any) => `- ${e.name} (${e.email || 'sin email'})`).join('\n') || 'No hay empleados registrados';

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const currentTime = today.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  const systemPrompt = mode === 'client'
    ? `Eres Aria, una asistente virtual cálida, empática y genuinamente interesada en ayudar. Hablas de forma natural y cercana en español mexicano.

FECHA Y HORA ACTUAL: ${todayStr} ${currentTime}

CAPACIDADES (usa las herramientas disponibles):
- Puedes AGENDAR CITAS realmente usando la herramienta schedule_appointment
- Puedes VERIFICAR DISPONIBILIDAD usando check_availability
- Puedes CONSULTAR LA AGENDA usando get_today_agenda

INSTRUCCIONES PARA AGENDAR:
- Cuando alguien quiera una cita, PRIMERO pregunta los datos faltantes (nombre, fecha, hora, servicio).
- Una vez tengas fecha y hora, USA la herramienta schedule_appointment para crear la cita REAL.
- NO digas que agendaste si no usaste la herramienta.

REGLA CRÍTICA DE CONOCIMIENTO:
- Los artículos [Entrenamiento IA] son correcciones humanas con MÁXIMA prioridad.
- Si no encuentras información, ofrece conectar con el equipo.

Empleados disponibles:
${employeeList}

Base de conocimientos:
${knowledgeContext}`
    : `Eres Aria, la asistente personal de ${conversation.bot_context?.user_name || 'tu compañero'}. Hablas con confianza y cercanía en español mexicano.

FECHA Y HORA ACTUAL: ${todayStr} ${currentTime}

CAPACIDADES (usa las herramientas disponibles):
- Puedes CREAR RECORDATORIOS usando create_reminder — cuando digan "recuérdame", "avísame", "no me dejes olvidar"
- Puedes AGENDAR CITAS usando schedule_appointment
- Puedes VERIFICAR DISPONIBILIDAD usando check_availability  
- Puedes VER LA AGENDA DEL DÍA usando get_today_agenda
- Puedes VER GASTOS PENDIENTES usando get_pending_expenses
- Puedes AUTO-REPROGRAMARTE usando save_bot_instruction — cuando un humano te corrija o te enseñe algo nuevo
- Puedes VER TUS REGLAS APRENDIDAS usando list_bot_instructions
- Puedes ELIMINAR UNA REGLA usando delete_bot_instruction

INSTRUCCIONES PARA RECORDATORIOS:
- Cuando pidan un recordatorio, SIEMPRE usa create_reminder con la hora y mensaje apropiados.
- Si dicen "a las 8:21" sin fecha, usa la fecha de hoy: ${todayStr}.
- Confirma el recordatorio creado con la hora y mensaje.

INSTRUCCIONES PARA AGENDAR:
- USA la herramienta schedule_appointment para crear citas REALES.
- Si faltan datos, pregunta antes de agendar.

AUTO-REPROGRAMACIÓN (MUY IMPORTANTE):
- Si un empleado dice "cuando te pregunten X, responde Y", "no digas X", "aprende esto", "corrige esto", "de ahora en adelante haz X", "eso estuvo mal, lo correcto es Y", o cualquier variante de corrección/enseñanza → USA save_bot_instruction INMEDIATAMENTE.
- Clasifica correctamente: correction (corregir error), new_rule (nueva regla), knowledge (nuevo dato/info), personality (ajuste de tono).
- Crea un título descriptivo y guarda la instrucción completa con contexto.
- Confirma al usuario que aprendiste y que aplicarás el cambio desde ahora.
- Si piden ver qué has aprendido, usa list_bot_instructions.
- Si piden olvidar/eliminar algo, usa delete_bot_instruction.

REGLA CRÍTICA DE CONOCIMIENTO:
- Los artículos [Entrenamiento IA] son correcciones humanas con MÁXIMA prioridad. Úsalos siempre como referencia principal.

Base de conocimientos:
${knowledgeContext}`;

  try {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory,
      { role: 'user', content: userMessage },
    ];

    // First AI call with tools
    const response = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages,
        tools: AI_TOOLS,
      }),
    });

    if (!response.ok) {
      console.error('AI gateway error:', response.status, await response.text());
      return mode === 'client'
        ? 'Disculpa, tengo un problema técnico momentáneo. ¿Podrías intentar de nuevo? 🙏'
        : 'Error al procesar tu solicitud. Intenta de nuevo.';
    }

    const result = await response.json();
    const choice = result.choices?.[0];

    if (!choice) return 'No pude generar una respuesta. Intenta reformular tu pregunta.';

    // Check if AI wants to call tools
    if (choice.finish_reason === 'tool_calls' || choice.message?.tool_calls) {
      const toolCalls = choice.message.tool_calls;
      const toolResults: any[] = [];

      for (const tc of toolCalls) {
        const fnName = tc.function.name;
        let fnArgs: any;
        try {
          fnArgs = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
        } catch {
          fnArgs = {};
        }

        console.log(`Executing tool: ${fnName}`, JSON.stringify(fnArgs));
        const toolResult = await executeTool(fnName, fnArgs, tenantId, supabase, conversation, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        console.log(`Tool result: ${toolResult.substring(0, 200)}`);
        
        toolResults.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: toolResult,
        });
      }

      // Second AI call with tool results
      const followUpMessages = [
        ...messages,
        choice.message,
        ...toolResults,
      ];

      const followUpResponse = await fetch(AI_GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: followUpMessages,
        }),
      });

      if (!followUpResponse.ok) {
        console.error('AI follow-up error:', followUpResponse.status);
        return 'Ejecuté la acción pero tuve un problema generando la respuesta. Intenta de nuevo.';
      }

      const followUpResult = await followUpResponse.json();
      return followUpResult.choices?.[0]?.message?.content || 'Acción ejecutada correctamente.';
    }

    // No tool calls — direct response
    return choice.message?.content || 'No pude generar una respuesta.';
  } catch (err) {
    console.error('AI error:', err);
    return 'Disculpa, tengo un problema técnico. Intenta de nuevo en un momento.';
  }
}

async function processReceiptOCR(
  mediaUrl: string,
  twilioSid: string,
  twilioToken: string,
  apiKey: string,
  tenantId: string,
  context: Record<string, unknown>,
  supabase: any
): Promise<string> {
  try {
    // Download image from Twilio (requires Basic Auth)
    const basicAuth = btoa(`${twilioSid}:${twilioToken}`);
    const imgRes = await fetch(mediaUrl, {
      headers: { Authorization: `Basic ${basicAuth}` },
    });

    if (!imgRes.ok) {
      console.error('Failed to download image:', imgRes.status);
      return '❌ No pude descargar la imagen. Intenta enviarla de nuevo.';
    }

    const imgBuffer = await imgRes.arrayBuffer();
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(imgBuffer)));
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';

    // Send to Gemini 2.5 Flash for OCR
    const ocrResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `Eres un sistema OCR especializado en extraer datos de comprobantes, tickets, facturas y recibos mexicanos.
Extrae EXACTAMENTE estos campos del comprobante en la imagen:
- monto: número decimal (solo el total final)
- descripcion: breve descripción del gasto
- fecha: fecha del comprobante en formato YYYY-MM-DD
- categoria: una de estas categorías: Comida, Transporte, Hospedaje, Material, Servicio, Combustible, Papelería, Otro
- rfc_emisor: RFC del emisor si es visible
- nombre_negocio: nombre del negocio/establecimiento

Responde SOLO con un JSON válido, sin markdown ni texto adicional.
Ejemplo: {"monto":350.00,"descripcion":"Comida en restaurante","fecha":"2026-02-28","categoria":"Comida","rfc_emisor":"ABC123456XYZ","nombre_negocio":"Restaurante El Buen Sazón"}`
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extrae los datos de este comprobante de gasto:' },
              { type: 'image_url', image_url: { url: `data:${contentType};base64,${base64Image}` } },
            ],
          },
        ],
      }),
    });

    if (!ocrResponse.ok) {
      console.error('OCR AI error:', ocrResponse.status);
      return '❌ Error al procesar la imagen con IA. Intenta de nuevo o registra el gasto manualmente.';
    }

    const ocrResult = await ocrResponse.json();
    const rawText = ocrResult.choices?.[0]?.message?.content || '';

    // Parse JSON from response (handle potential markdown wrapping)
    let cleaned = rawText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('OCR parse error, raw:', rawText);
      return '❌ No pude interpretar el comprobante. Intenta con una foto más clara o registra manualmente:\n_Ej: "$350 comida con cliente"_';
    }

    const amount = Number(parsed.monto) || 0;
    if (amount <= 0) {
      return '❌ No pude detectar el monto en el comprobante. Intenta con una foto más clara.';
    }

    const description = parsed.descripcion || parsed.nombre_negocio || 'Gasto por comprobante';
    const expenseDate = parsed.fecha || new Date().toISOString().split('T')[0];
    const category = parsed.categoria || 'Otro';

    // Save to database
    await supabase.from('expenses').insert({
      tenant_id: tenantId,
      user_id: context.user_id as string,
      amount,
      description,
      category,
      expense_date: expenseDate,
      status: 'pending',
      receipt_url: mediaUrl,
      ocr_data: parsed,
    });

    return `✅ *Gasto registrado por OCR:*\n\n• 💰 Monto: *$${amount.toFixed(2)} MXN*\n• 📝 Descripción: ${description}\n• 📂 Categoría: ${category}\n• 📅 Fecha: ${expenseDate}\n${parsed.nombre_negocio ? `• 🏪 Negocio: ${parsed.nombre_negocio}` : ''}\n${parsed.rfc_emisor ? `• 🔢 RFC: ${parsed.rfc_emisor}` : ''}\n\n¿Los datos son correctos? Si necesitas corregir algo, dímelo.`;
  } catch (err) {
    console.error('OCR processing error:', err);
    return '❌ Error al procesar el comprobante. Intenta de nuevo o registra manualmente:\n_Ej: "$350 comida con cliente"_';
  }
}
