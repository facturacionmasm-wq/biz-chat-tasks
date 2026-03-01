import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/search";

/**
 * Search the web using Firecrawl, then synthesize an answer with AI (Gemini or GPT).
 */
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

    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');

    // ─── STEP 1: Real-time web search with Firecrawl ───
    let webResults = '';
    let sources: string[] = [];

    if (FIRECRAWL_API_KEY) {
      try {
        console.log(`Firecrawl search: "${query}"`);
        const fcResponse = await fetch(FIRECRAWL_API_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query,
            limit: 5,
            lang: 'es',
            scrapeOptions: { formats: ['markdown'] },
          }),
        });

        if (fcResponse.ok) {
          const fcData = await fcResponse.json();
          const results = fcData.data || fcData.results || [];

          if (results.length > 0) {
            sources = results.map((r: any) => r.url).filter(Boolean);
            webResults = results.map((r: any, i: number) => {
              const title = r.title || r.metadata?.title || `Resultado ${i + 1}`;
              const content = r.markdown || r.description || r.extract || '';
              // Truncate each result to keep context manageable
              const truncated = content.substring(0, 800);
              return `[Fuente ${i + 1}: ${title}]\nURL: ${r.url || 'N/A'}\n${truncated}`;
            }).join('\n\n---\n\n');

            console.log(`Firecrawl returned ${results.length} results, ${sources.length} sources`);
          } else {
            console.log('Firecrawl returned no results');
          }
        } else {
          console.error('Firecrawl error:', fcResponse.status, await fcResponse.text());
        }
      } catch (fcErr) {
        console.error('Firecrawl fetch error:', fcErr);
        // Continue without web results - fall back to AI knowledge
      }
    } else {
      console.log('FIRECRAWL_API_KEY not configured, using AI knowledge only');
    }

    // ─── STEP 2: AI synthesis with web context ───
    const model = model_preference === 'gpt'
      ? 'openai/gpt-5-mini'
      : 'google/gemini-2.5-flash';

    const hasWebResults = webResults.length > 0;

    const systemPrompt = `Eres un asistente de búsqueda de información con acceso a resultados de internet en tiempo real.

${hasWebResults ? `RESULTADOS DE BÚSQUEDA WEB (información actualizada):
${webResults}

INSTRUCCIONES:
- BASA tu respuesta PRINCIPALMENTE en los resultados de búsqueda web proporcionados arriba
- Si los resultados contienen la información solicitada, úsala directamente
- Cita las fuentes relevantes cuando sea útil (ej: "Según [Fuente 1]...")
- Si los resultados no cubren completamente la pregunta, complementa con tu conocimiento general` 
: `No se encontraron resultados de búsqueda web. Responde con tu conocimiento general pero aclara que la información podría no estar actualizada.`}

REGLAS GENERALES:
- Responde de forma concisa y directa (máximo 400 palabras)
- Usa español mexicano natural
- Para direcciones, incluye la información de los resultados web si está disponible
- NO inventes datos específicos (teléfonos, precios exactos, direcciones) que no estén en los resultados
- Si la información es sensible al tiempo (precios, horarios, clima), menciona que conviene verificar

${context ? `CONTEXTO ADICIONAL: ${context}` : ''}`;

    console.log(`AI synthesis: "${query}" using ${model}, web_results: ${hasWebResults}`);

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

    console.log(`Web search response (${modelUsed}, sources: ${sources.length}): ${answer.substring(0, 100)}...`);

    return new Response(JSON.stringify({
      success: true,
      answer,
      model_used: modelUsed,
      sources: sources.slice(0, 3),
      has_web_results: hasWebResults,
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
