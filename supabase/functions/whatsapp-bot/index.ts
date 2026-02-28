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
    const { conversationId, messageBody, contactPhone, tenantId } = await req.json();

    if (!conversationId || !messageBody) {
      return new Response(JSON.stringify({ error: 'Missing conversationId or messageBody' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get conversation with bot state
    const { data: conv } = await supabase
      .from('whatsapp_conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    if (!conv) {
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const botState = conv.bot_state || 'welcome';
    const botContext = (conv.bot_context as Record<string, unknown>) || {};
    const msg = messageBody.trim().toLowerCase();
    let reply = '';
    let newState = botState;
    let newContext = { ...botContext };

    // ==================== STATE MACHINE ====================

    if (botState === 'welcome') {
      // First interaction: welcome message
      const { data: tenant } = await supabase
        .from('tenants')
        .select('name')
        .eq('id', tenantId)
        .single();

      const companyName = tenant?.name || 'nuestra empresa';
      reply = `¡Hola! 👋 Soy el asistente virtual de *${companyName}*. Mi nombre es *Aria*.\n\n¿Eres *cliente* o *empleado*?\n\n1️⃣ Cliente\n2️⃣ Empleado`;
      newState = 'awaiting_role';

    } else if (botState === 'awaiting_role') {
      if (msg.includes('cliente') || msg === '1') {
        reply = '¡Perfecto! 🙂 Estoy aquí para ayudarte.\n\nPuedo:\n• 📋 Informarte sobre nuestros servicios\n• 📅 Agendar una cita con alguno de nuestros colaboradores\n• 👤 Comunicarte con un empleado específico\n\n¿En qué puedo ayudarte?';
        newState = 'client_mode';
        newContext = { role: 'client' };

      } else if (msg.includes('empleado') || msg === '2') {
        reply = '🔐 Para verificar tu identidad, por favor ingresa tu *PIN de autenticación* (el que seleccionaste al crear tu cuenta).';
        newState = 'employee_auth';
        newContext = { role: 'employee', auth_attempts: 0 };

      } else {
        reply = 'No entendí tu respuesta. Por favor escribe *cliente* o *empleado*, o responde con *1* o *2*.';
      }

    } else if (botState === 'employee_auth') {
      // Verify PIN
      const attempts = ((newContext.auth_attempts as number) || 0) + 1;

      if (attempts > 3) {
        reply = '❌ Demasiados intentos fallidos. Por favor intenta más tarde o contacta al administrador.';
        newState = 'welcome';
        newContext = {};
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
          reply = `✅ ¡Bienvenido, *${profile.name}*! Soy tu asistente personal.\n\nPuedo ayudarte con:\n• 📋 Ver tus tareas y recordatorios\n• 📅 Consultar tu agenda del día\n• 📎 Registrar gastos (envía foto de comprobante)\n• 💬 Consultar la base de conocimientos\n• 📊 Ver resumen de actividad\n\n¿Qué necesitas?`;
          newState = 'employee_mode';
          newContext = { 
            role: 'employee', 
            user_id: profile.user_id, 
            user_name: profile.name,
            profile_id: profile.id,
          };

          // Update verified user
          await supabase
            .from('whatsapp_conversations')
            .update({ verified_user_id: profile.user_id })
            .eq('id', conversationId);
        } else {
          newContext.auth_attempts = attempts;
          reply = `❌ PIN incorrecto. Intento ${attempts}/3. Por favor intenta de nuevo.`;
        }
      }

    } else if (botState === 'client_mode') {
      // AI-powered client assistant
      reply = await getAIResponse(LOVABLE_API_KEY!, tenantId, supabase, 'client', messageBody, conv);

    } else if (botState === 'employee_mode') {
      // Check for media/receipt
      if (msg.includes('gasto') || msg.includes('comprobante') || msg.includes('ticket') || msg.includes('factura') || msg.includes('recibo')) {
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
          reply = `📅 *Tu agenda de hoy:*\n\n${appointments.map((a, i) => {
            const time = new Date(a.start_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
            return `${i + 1}. ${time} - ${a.contact_name} (${a.service_type || 'General'})`;
          }).join('\n')}`;
        } else {
          reply = '📅 No tienes citas programadas para hoy.';
        }

      } else {
        // AI-powered employee assistant
        reply = await getAIResponse(LOVABLE_API_KEY!, tenantId, supabase, 'employee', messageBody, conv);
      }

    } else if (botState === 'employee_expense') {
      // Parse manual expense entry
      const amountMatch = messageBody.match(/\$?([\d,]+\.?\d*)/);
      if (amountMatch) {
        const amount = parseFloat(amountMatch[1].replace(',', ''));
        const description = messageBody.replace(/\$?[\d,]+\.?\d*/, '').replace(/gasto/i, '').trim() || 'Gasto sin descripción';
        
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

    return new Response(JSON.stringify({ ok: true, reply, state: newState }), {
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
    ? `Eres Aria, la recepcionista virtual inteligente de la empresa. Tu trabajo es:
1. Informar sobre los servicios de la empresa basándote en la base de conocimientos.
2. Agendar citas con los colaboradores de la empresa.
3. Si el cliente quiere hablar con un empleado específico, ofrécele sus datos de contacto.
4. Sé amable, profesional y concisa. Responde siempre en español.
5. Si el cliente pide agendar cita, pregunta: fecha preferida, hora, con qué empleado, y motivo.
6. Si detectas palabras como "queja", "urgente", "problema grave", indica que escalarás al equipo humano.

Empleados disponibles:
${employeeList}

Base de conocimientos:
${knowledgeContext}`
    : `Eres Aria, la asistente personal del empleado ${conversation.bot_context?.user_name || 'colaborador'}. Tu trabajo es:
1. Recordar tareas pendientes y compromisos.
2. Informar sobre la agenda del día.
3. Ayudar a registrar gastos (pide monto, descripción y categoría).
4. Responder consultas sobre la base de conocimientos interna.
5. Dar resúmenes de actividad.
6. Sé eficiente, directa y profesional. Responde en español.

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
