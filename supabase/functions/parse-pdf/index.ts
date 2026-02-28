import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDocument } from "https://esm.sh/pdfjs-serverless@0.6.0";

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

    const doc = await getDocument(uint8).promise;
    let extractedText = '';
    for (let i = 1; i <= Math.min(doc.numPages, 50); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      extractedText += content.items.map((item: any) => item.str).join(' ') + '\n';
    }

    extractedText = extractedText.trim();

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
