import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const cleanText = (text: string) =>
  text
    .replace(/\u0000/g, "")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const isMeaningfulText = (text: string) => {
  const normalized = cleanText(text);
  if (normalized.length < 80) return false;

  const alphaChars = (normalized.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  const totalChars = normalized.replace(/\s/g, "").length || 1;
  const alphaRatio = alphaChars / totalChars;

  const metadataHits = (normalized.match(/(rdf:|xmp|endobj|xref|obj\b|stream\b|xmlns:|Producer)/gi) || []).length;
  const longRepeats = /(.)\1{8,}/.test(normalized);

  return alphaRatio > 0.25 && metadataHits < 8 && !longRepeats;
};

async function extractWithPdfJs(uint8: Uint8Array): Promise<string> {
  try {
    const pdfjs = await import("https://esm.sh/pdfjs-dist@4.10.38/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: uint8 }).promise;

    let text = "";
    const pageCount = Math.min(doc.numPages, 50);

    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item: any) => item.str || "").join(" ") + "\n";
    }

    return cleanText(text);
  } catch (err) {
    console.error("PDF.js extraction failed:", err);
    return "";
  }
}

function extractWithRegexFallback(uint8: Uint8Array): string {
  const raw = new TextDecoder("iso-8859-1").decode(uint8);
  let extractedText = "";

  for (const m of raw.matchAll(/\(([^)]*)\)\s*Tj/g)) extractedText += m[1] + " ";
  for (const m of raw.matchAll(/\[(.*?)\]\s*TJ/g)) {
    for (const p of m[1].matchAll(/\(([^)]*)\)/g)) extractedText += p[1];
    extractedText += " ";
  }

  extractedText = cleanText(
    extractedText
      .replace(/\\n/g, "\n")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\")
  );

  return extractedText;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "AI not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    let extractedText = await extractWithPdfJs(uint8);
    if (!isMeaningfulText(extractedText)) {
      extractedText = extractWithRegexFallback(uint8);
    }

    if (!isMeaningfulText(extractedText)) {
      return new Response(
        JSON.stringify({
          error: "No se pudo extraer texto legible del PDF. Si es un PDF escaneado, intenta exportarlo con OCR o como PDF con capa de texto.",
        }),
        {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "Recibes texto extraído de un PDF. Limpia ruido técnico (metadatos XML/PDF, tokens binarios, repeticiones basura), estructura en markdown y conserva únicamente contenido humano legible.",
          },
          { role: "user", content: extractedText.substring(0, 25000) },
        ],
      }),
    });

    const aiResult = await aiResponse.json();
    const cleanedText = aiResult.choices?.[0]?.message?.content || extractedText;

    return new Response(
      JSON.stringify({
        success: true,
        content: cleanText(cleanedText),
        title: file.name.replace(/\.pdf$/i, ""),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("PDF parse error:", msg);

    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
