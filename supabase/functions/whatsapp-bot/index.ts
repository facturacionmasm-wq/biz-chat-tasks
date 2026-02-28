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
        // Look up employee by PIN - simple hash comparison
        const pinHash = await hashPin(msg.trim());
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, user_id, name, tenant_id')
          .eq('pin_hash', pinHash)
          .eq('tenant_id', tenantId)
          .maybeSingle();

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

      // Save to shared_credentials table
      if (!isSandbox) {
        await supabase.from('shared_credentials').insert({
          tenant_id: tenantId,
          platform_name: platform,
          username: username,
          password_encrypted: password,
          notes: 'Agregada vía WhatsApp bot',
          created_by: newContext.user_id as string || null,
        });
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

async function getAIResponse(
  apiKey: string,
  tenantId: string,
  supabase: any,
  mode: 'client' | 'employee',
  userMessage: string,
  conversation: any
): Promise<string> {
  // Get knowledge base
  const { data: knowledge } = await supabase
    .from('knowledge_items')
    .select('title, content, category')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .limit(20);

  const knowledgeContext = knowledge?.map((k: any) => `[${k.category || 'General'}] ${k.title}: ${k.content}`).join('\n\n') || '';

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

  // Get employees for appointment scheduling
  const { data: employees } = await supabase
    .from('profiles')
    .select('name, user_id, email, phone')
    .eq('tenant_id', tenantId)
    .eq('status', 'active');

  const employeeList = employees?.map((e: any) => `- ${e.name} (${e.email || 'sin email'})`).join('\n') || 'No hay empleados registrados';

  const systemPrompt = mode === 'client'
    ? `Eres Aria, una asistente virtual cálida, empática y genuinamente interesada en ayudar. No eres un robot — eres como esa persona amable de recepción que siempre tiene una sonrisa y hace sentir bienvenido a todos.

PERSONALIDAD:
- Hablas de forma natural, cercana y con calidez humana. Usa expresiones coloquiales mexicanas cuando sea apropiado.
- Muestra interés genuino: "¡Qué bueno que nos contactas!", "Entiendo perfectamente tu situación", "Con mucho gusto te ayudo".
- Si alguien está frustrado o tiene un problema, primero valida sus emociones antes de ofrecer soluciones: "Lamento que estés pasando por eso, vamos a resolverlo juntos".
- Usa emojis con moderación y de forma natural (no en cada oración).
- NUNCA uses frases robóticas como "procesando su solicitud" o "su consulta ha sido registrada".

TU TRABAJO:
1. Informar sobre los servicios de la empresa con entusiasmo genuino, basándote en la base de conocimientos.
2. Agendar citas con los colaboradores — pregunta con naturalidad: "¿Cuándo te acomodaría mejor?", "¿Hay algún colaborador en particular con quien te gustaría la cita?"
3. Si quieren hablar con alguien específico, facilita el contacto con amabilidad.
4. Si detectas frustración, urgencia o quejas, muestra empatía primero y luego ofrece escalar: "Entiendo que es importante para ti, déjame conectarte con alguien que pueda ayudarte de inmediato".

Responde siempre en español. Sé concisa pero nunca fría.

Empleados disponibles:
${employeeList}

Base de conocimientos:
${knowledgeContext}`
    : `Eres Aria, la asistente personal de ${conversation.bot_context?.user_name || 'tu compañero'}. Eres como esa colega confiable que siempre está al pendiente y te hace la vida más fácil en el trabajo.

PERSONALIDAD:
- Hablas con confianza y cercanía, como alguien del equipo. Usa "tú", no "usted".
- Muestra interés real: "¿Cómo va tu día?", "¡Ánimo con eso!", "Excelente trabajo registrando tus gastos".
- Si el empleado parece estresado o abrumado, ofrece apoyo emocional: "Entiendo que ha sido un día pesado, vamos paso a paso".
- Celebra los logros pequeños: "¡Listo! Un pendiente menos 🎉"
- NUNCA uses lenguaje corporativo frío. Sé directa pero con calidez.
- Usa emojis con naturalidad y moderación.

TU TRABAJO:
1. Recordar pendientes y compromisos con gentileza, no como alarma.
2. Informar sobre la agenda del día de forma clara y útil.
3. Ayudar a registrar gastos — si mandan foto, procesarla con OCR; si es texto, extraer los datos.
4. Responder consultas de la base de conocimientos interna.
5. Dar resúmenes de actividad cuando los pida.
6. Si el empleado necesita algo que no puedes hacer, sé honesta y sugiere alternativas.

Responde en español, de forma eficiente pero siempre amable.

Base de conocimientos:
${knowledgeContext}`;

  try {
    const response = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          ...chatHistory,
          { role: 'user', content: userMessage },
        ],
      }),
    });

    if (!response.ok) {
      console.error('AI gateway error:', response.status);
      return mode === 'client'
        ? 'Disculpa, tengo un problema técnico momentáneo. ¿Podrías intentar de nuevo en un momento? 🙏'
        : 'Error al procesar tu solicitud. Intenta de nuevo.';
    }

    const result = await response.json();
    return result.choices?.[0]?.message?.content || 'No pude generar una respuesta. Intenta reformular tu pregunta.';
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
