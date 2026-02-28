import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: 'AI not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    // Extract text from PDF manually by scanning for text operators
    // Use iso-8859-1 (the standard name) instead of latin-1
    const raw = new TextDecoder('iso-8859-1').decode(uint8);

    let extractedText = '';

    // Method 1: Tj operator
    const tjMatches = raw.matchAll(/\(([^)]*)\)\s*Tj/g);
    for (const m of tjMatches) {
      extractedText += m[1] + ' ';
    }

    // Method 2: TJ arrays
    const tjArrayMatches = raw.matchAll(/\[(.*?)\]\s*TJ/g);
    for (const m of tjArrayMatches) {
      const parts = m[1].matchAll(/\(([^)]*)\)/g);
      for (const p of parts) {
        extractedText += p[1];
      }
      extractedText += ' ';
    }

    // Clean up
    extractedText = extractedText
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, ' ')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\')
      .replace(/\s+/g, ' ')
      .trim();

    // Fallback: grab readable ASCII strings
    if (extractedText.length < 50) {
      const readable = raw.match(/[\x20-\x7E]{15,}/g);
      if (readable) {
        extractedText = readable
          .filter(s => !/^[%\/\[\]<>{}&]/.test(s) && !s.includes('stream') && !s.includes('endobj') && !s.includes('xref'))
          .join('\n')
          .substring(0, 10000);
      }
    }

    if (!extractedText || extractedText.length < 20) {
      return new Response(JSON.stringify({
        error: 'No se pudo extraer texto del PDF. Puede ser un PDF escaneado (imagen).',
      }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use AI to clean and structure
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: 'Recibes texto extraído de un PDF. Limpia el texto, estructura el contenido en secciones con markdown y devuelve un resultado legible. Mantén todo el contenido original, solo mejora el formato. Responde SOLO con el texto limpio en markdown.',
          },
          { role: 'user', content: extractedText.substring(0, 15000) },
        ],
      }),
    });

    const aiResult = await aiResponse.json();
    const cleanedText = aiResult.choices?.[0]?.message?.content || extractedText;

    return new Response(JSON.stringify({
      success: true,
      content: cleanedText,
      title: file.name.replace(/\.pdf$/i, ''),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('PDF parse error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
