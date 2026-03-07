/**
 * Document Search Edge Function
 * 
 * Provides RAG (Retrieval Augmented Generation) search over document chunks.
 * Uses PostgreSQL full-text search + AI reranking.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { action, tenant_id, query, document_type, limit: resultLimit, document_id } = await req.json();

    if (!tenant_id) {
      return jsonRes({ error: 'tenant_id required' }, 400);
    }

    // ─── CHUNK A DOCUMENT ───
    if (action === 'chunk_document') {
      if (!document_id) return jsonRes({ error: 'document_id required' }, 400);

      const { data: doc } = await supabase
        .from('documents')
        .select('id, tenant_id, extracted_text, analysis_summary, original_filename, document_type, extracted_data, entities, key_dates, key_amounts')
        .eq('id', document_id)
        .eq('tenant_id', tenant_id)
        .single();

      if (!doc) return jsonRes({ error: 'Document not found' }, 404);

      const text = doc.extracted_text || doc.analysis_summary || '';
      if (text.length < 20) return jsonRes({ error: 'No text to chunk', chunks: 0 });

      // Delete existing chunks
      await supabase.from('document_chunks').delete().eq('document_id', document_id);

      // Create chunks
      const chunks = createChunks(text, 500, 50);
      const chunkRows = chunks.map((chunk, i) => ({
        document_id: doc.id,
        tenant_id: doc.tenant_id,
        chunk_index: i,
        content: chunk,
        metadata: {
          filename: doc.original_filename,
          doc_type: doc.document_type,
          total_chunks: chunks.length,
        },
        tokens: Math.ceil(chunk.length / 4),
      }));

      // Also add a metadata chunk with structured data
      const metaContent = buildMetadataChunk(doc);
      if (metaContent) {
        chunkRows.push({
          document_id: doc.id,
          tenant_id: doc.tenant_id,
          chunk_index: chunks.length,
          content: metaContent,
          metadata: { type: 'metadata_summary', filename: doc.original_filename, doc_type: doc.document_type, total_chunks: chunks.length + 1 },
          tokens: Math.ceil(metaContent.length / 4),
        });
      }

      const { error } = await supabase.from('document_chunks').insert(chunkRows);
      if (error) return jsonRes({ error: error.message }, 500);

      return jsonRes({ success: true, chunks: chunkRows.length, document_id });
    }

    // ─── RAG SEARCH ───
    if (action === 'search' || !action) {
      if (!query) return jsonRes({ error: 'query required' }, 400);

      // 1. Full-text search via the database function
      const { data: ftsResults, error: ftsErr } = await supabase.rpc('search_document_chunks', {
        _tenant_id: tenant_id,
        _query: query,
        _limit: (resultLimit || 10) * 2, // over-fetch for reranking
        _document_type: document_type || null,
      });

      if (ftsErr) {
        console.error('[RAG] FTS error:', ftsErr.message);
        return jsonRes({ error: ftsErr.message }, 500);
      }

      // 2. Also do direct ilike search on documents for fallback
      let directResults: any[] = [];
      if (!ftsResults || ftsResults.length < 3) {
        let dQuery = supabase
          .from('documents')
          .select('id, original_filename, document_type, analysis_summary, extracted_text, extracted_data, key_dates, key_amounts, entities')
          .eq('tenant_id', tenant_id)
          .is('deleted_at', null)
          .or(`original_filename.ilike.%${query}%,analysis_summary.ilike.%${query}%,extracted_text.ilike.%${query}%`)
          .limit(5);

        if (document_type) dQuery = dQuery.eq('document_type', document_type);
        const { data: docs } = await dQuery;
        directResults = (docs || []).map((d: any) => ({
          document_id: d.id,
          content: d.extracted_text?.substring(0, 500) || d.analysis_summary || '',
          doc_filename: d.original_filename,
          doc_type: d.document_type,
          doc_summary: d.analysis_summary,
          rank: 0.5,
          source: 'direct',
        }));
      }

      const allResults = [...(ftsResults || []), ...directResults];

      if (allResults.length === 0) {
        return jsonRes({ results: [], answer: null, query });
      }

      // 3. AI Reranking + Answer Generation
      let answer: string | null = null;
      if (LOVABLE_API_KEY && allResults.length > 0) {
        const contextChunks = allResults
          .slice(0, 8)
          .map((r: any, i: number) => `[Doc ${i + 1}: ${r.doc_filename} (${r.doc_type})]\\n${r.content}`)
          .join('\\n\\n---\\n\\n');

        try {
          const aiRes = await fetch(AI_GATEWAY_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                {
                  role: 'system',
                  content: `Eres un asistente documental experto. Responde la pregunta del usuario basándote EXCLUSIVAMENTE en los documentos proporcionados.

REGLAS:
- Responde de forma clara, concisa y precisa.
- Cita el documento fuente cuando sea posible (nombre del archivo).
- Si la respuesta no está en los documentos, di "No encontré esa información en los documentos disponibles."
- NO inventes información que no esté en el contexto.
- Usa español mexicano profesional.`,
                },
                {
                  role: 'user',
                  content: `Documentos disponibles:\\n\\n${contextChunks}\\n\\n---\\n\\nPregunta del usuario: ${query}`,
                },
              ],
            }),
          });

          if (aiRes.ok) {
            const aiResult = await aiRes.json();
            answer = aiResult.choices?.[0]?.message?.content || null;
          }
        } catch (e) {
          console.error('[RAG] AI answer error:', e);
        }
      }

      return jsonRes({
        results: allResults.slice(0, resultLimit || 10).map((r: any) => ({
          document_id: r.document_id,
          chunk_id: r.chunk_id,
          content: r.content?.substring(0, 300),
          filename: r.doc_filename,
          type: r.doc_type,
          summary: r.doc_summary,
          rank: r.rank,
        })),
        answer,
        query,
        total_results: allResults.length,
      });
    }

    return jsonRes({ error: 'Unknown action' }, 400);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[DOC-SEARCH] Error:', msg);
    return jsonRes({ error: msg }, 500);
  }
});

// ==================== CHUNKING ====================

function createChunks(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?\n])\s+/);
  let currentChunk = '';

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      // Keep overlap from end of current chunk
      const words = currentChunk.split(' ');
      const overlapWords = words.slice(-Math.ceil(overlap / 5));
      currentChunk = overlapWords.join(' ') + ' ' + sentence;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
    }
  }

  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  return chunks.length > 0 ? chunks : [text.substring(0, chunkSize)];
}

function buildMetadataChunk(doc: any): string | null {
  const parts: string[] = [];

  parts.push(`Documento: ${doc.original_filename}`);
  parts.push(`Tipo: ${doc.document_type}`);
  if (doc.analysis_summary) parts.push(`Resumen: ${doc.analysis_summary}`);

  if (doc.entities?.length > 0) {
    parts.push('Entidades: ' + doc.entities.slice(0, 10).map((e: any) => `${e.type}: ${e.value}`).join(', '));
  }
  if (doc.key_dates?.length > 0) {
    parts.push('Fechas: ' + doc.key_dates.map((d: any) => `${d.type}: ${d.date}`).join(', '));
  }
  if (doc.key_amounts?.length > 0) {
    parts.push('Montos: ' + doc.key_amounts.map((a: any) => `$${a.amount} ${a.currency || 'MXN'}`).join(', '));
  }

  return parts.length > 2 ? parts.join('\\n') : null;
}

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
