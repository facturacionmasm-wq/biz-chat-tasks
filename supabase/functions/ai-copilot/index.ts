import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { action, data } = await req.json();

    if (action === 'summarize_call') {
      const { transcript, extractedData } = data;
      const response = await fetch(AI_GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            {
              role: 'system',
              content: `Eres un asistente de análisis de llamadas para un sistema CRM. Genera un resumen estructurado en español con el siguiente formato:

**Resumen:** (2-3 líneas)

**Puntos clave:**
- punto 1
- punto 2

**Acciones sugeridas:**
- acción 1
- acción 2

**Seguimiento recomendado:** (fecha y contexto)

También extrae datos estructurados como JSON: contactName, reason, intent, budget, location, urgency, objections[], agreements[], followUp (fecha ISO).`
            },
            {
              role: 'user',
              content: `Transcripción de la llamada:\n${transcript}\n\nDatos previos extraídos: ${JSON.stringify(extractedData)}`
            }
          ],
        }),
      });

      const result = await response.json();
      return new Response(JSON.stringify({ summary: result.choices?.[0]?.message?.content }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'extract_whatsapp_intent') {
      const { messages, knowledgeContext } = data;
      const response = await fetch(AI_GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            {
              role: 'system',
              content: `Eres un asistente de atención al cliente que analiza conversaciones de WhatsApp. Tu trabajo:
1. Detectar la intención del usuario (agendar cita, pedir información, soporte, queja, solicitud interna).
2. Si detectas palabras como "humano", "queja", "urgente", marca escalamiento.
3. Si hay una solicitud de cita, extrae: fecha, hora, servicio, contacto.
4. Si hay preguntas, responde basándote en el Knowledge Hub proporcionado.
5. Responde siempre en español, de forma profesional y concisa.

Knowledge Hub disponible:
${knowledgeContext || 'No hay artículos disponibles.'}`
            },
            ...messages.map((m: any) => ({
              role: m.direction === 'in' ? 'user' : 'assistant',
              content: m.body,
            })),
          ],
        }),
      });

      const result = await response.json();
      return new Response(JSON.stringify({
        response: result.choices?.[0]?.message?.content,
        intent: 'auto_detected',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'weekly_summary') {
      const { callCount, missedCalls, waConversations, appointments, openTasks } = data;
      const response = await fetch(AI_GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            {
              role: 'system',
              content: 'Genera un resumen ejecutivo semanal en español para un dashboard de comunicación y atención. Incluye secciones: 📞 Comunicación, ⚠️ Atención requerida, ✅ Logros y próximos pasos. Sé conciso y accionable.'
            },
            {
              role: 'user',
              content: `Datos de la semana:\n- Llamadas: ${callCount} (${missedCalls} perdidas)\n- Conversaciones WhatsApp activas: ${waConversations}\n- Citas programadas: ${appointments}\n- Tareas abiertas: ${openTasks}`
            }
          ],
        }),
      });

      const result = await response.json();
      return new Response(JSON.stringify({ summary: result.choices?.[0]?.message?.content }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'knowledge_search') {
      const { query, articles } = data;
      const response = await fetch(AI_GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            {
              role: 'system',
              content: `Eres un asistente que busca en el Knowledge Hub. Responde la pregunta del usuario basándote SOLO en los artículos proporcionados. Si no hay información suficiente, dilo. Cita las fuentes usadas (IDs de artículos). Responde en español.`
            },
            {
              role: 'user',
              content: `Pregunta: ${query}\n\nArtículos disponibles:\n${articles.map((a: any) => `[ID: ${a.id}] ${a.title}: ${a.content}`).join('\n\n')}`
            }
          ],
        }),
      });

      const result = await response.json();
      return new Response(JSON.stringify({ answer: result.choices?.[0]?.message?.content }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
