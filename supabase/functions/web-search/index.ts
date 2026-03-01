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

  try {
    const { query, model_preference, context } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ error: 'Query is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use GPT for complex reasoning, Gemini for general knowledge
    const model = model_preference === 'gpt' 
      ? 'openai/gpt-5-mini' 
      : 'google/gemini-2.5-flash';

    const systemPrompt = `Eres un asistente de búsqueda de información. Tu trabajo es responder consultas sobre:
- Conocimiento general, cultura, ciencia, historia, geografía
- Direcciones, ubicaciones y cómo llegar a lugares
- Precios, horarios, información de negocios y servicios
- Clima, noticias, eventos
- Consejos prácticos, recetas, salud general
- Información técnica, definiciones, explicaciones

REGLAS:
- Responde de forma concisa y directa (máximo 300 palabras)
- Si no estás seguro de algo, indícalo claramente
- Para direcciones, da la mejor información que tengas pero aclara que confirmen con un mapa
- Usa español mexicano natural
- Si la pregunta es sobre algo muy específico y actualizado que podrías no tener, sugiere verificar en línea
- NO inventes datos específicos como números de teléfono, precios exactos actuales, o direcciones exactas si no estás seguro

${context ? `CONTEXTO ADICIONAL: ${context}` : ''}`;

    console.log(`Web search query: "${query}" using model: ${model}`);

    const response = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('AI gateway error:', response.status, errText);

      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Demasiadas consultas. Intenta en unos segundos.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'Créditos de IA agotados.' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Error consultando IA' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await response.json();
    const answer = result.choices?.[0]?.message?.content || 'No pude encontrar una respuesta.';
    const modelUsed = model.includes('gpt') ? 'ChatGPT' : 'Gemini';

    console.log(`Web search response (${modelUsed}): ${answer.substring(0, 100)}...`);

    return new Response(JSON.stringify({
      success: true,
      answer,
      model_used: modelUsed,
      query,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Web search error:', error);
    return new Response(JSON.stringify({ error: 'Error en búsqueda web' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
