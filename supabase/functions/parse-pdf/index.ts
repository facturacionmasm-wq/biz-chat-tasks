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

    // Extract text from PDF by finding text strings between parentheses in PDF streams
    // and BT/ET text blocks
    let extractedText = '';

    // Decode the buffer as latin1 to preserve bytes
    const raw = new TextDecoder('latin-1').decode(uint8);

    // Method 1: Extract text from Tj and TJ operators
    const tjMatches = raw.matchAll(/\(([^)]*)\)\s*Tj/g);
    for (const m of tjMatches) {
      extractedText += m[1] + ' ';
    }

    // Method 2: Extract from TJ arrays
    const tjArrayMatches = raw.matchAll(/\[(.*?)\]\s*TJ/g);
    for (const m of tjArrayMatches) {
      const inner = m[1];
      const parts = inner.matchAll(/\(([^)]*)\)/g);
      for (const p of parts) {
        extractedText += p[1];
      }
      extractedText += ' ';
    }

    // Clean up the text
    extractedText = extractedText
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, ' ')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\')
      .replace(/\s+/g, ' ')
      .trim();

    // If basic extraction got very little, try to get any readable strings
    if (extractedText.length < 50) {
      const readable = raw.match(/[\x20-\x7E]{10,}/g);
      if (readable) {
        extractedText = readable
          .filter(s => !s.includes('/') && !s.includes('<<') && !s.includes('stream'))
          .join(' ')
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

    // Use AI to clean and structure the extracted text
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
            content: 'Recibes texto extraído de un PDF que puede tener errores de formato. Limpia el texto, estructura el contenido en secciones con markdown, y devuelve un resultado legible. Mantén todo el contenido original, solo mejora el formato. Responde SOLO con el texto limpio en markdown, sin explicaciones.',
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
      rawLength: extractedText.length,
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
