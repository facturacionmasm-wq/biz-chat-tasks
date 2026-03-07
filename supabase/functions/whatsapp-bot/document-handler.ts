/**
 * Document Handler for WhatsApp Bot
 * 
 * Handles file reception, classification, Google Drive upload,
 * AI analysis, chunking for RAG, agent analysis, memory, and workflows.
 */

import { AI_GATEWAY_URL } from "./constants.ts";
import { runDocumentAgents } from "./document-agents.ts";
import { learnFromDocument } from "./document-memory.ts";
import { evaluateDocumentWorkflows, ensureDefaultWorkflowRules } from "./document-workflows.ts";

// ==================== DOCUMENT TYPES ====================

const DOCUMENT_TYPES = [
  'contrato', 'factura', 'identificacion', 'cotizacion', 'comprobante',
  'estado_de_cuenta', 'expediente_legal', 'documento_corporativo',
  'formato_interno', 'evidencia_fotografica', 'recibo', 'poliza',
  'acuerdo', 'poder_notarial', 'acta', 'reporte', 'manual', 'other',
] as const;

const FOLDER_MAP: Record<string, string> = {
  contrato: 'Contratos', factura: 'Facturas', identificacion: 'Identificaciones',
  cotizacion: 'Cotizaciones', comprobante: 'Comprobantes', estado_de_cuenta: 'Estados de Cuenta',
  expediente_legal: 'Legal', documento_corporativo: 'Corporativo', formato_interno: 'Formatos Internos',
  evidencia_fotografica: 'Evidencias', recibo: 'Comprobantes', poliza: 'Pólizas',
  acuerdo: 'Contratos', poder_notarial: 'Legal', acta: 'Legal',
  reporte: 'Reportes', manual: 'Manuales', other: 'Otros',
};

// ==================== MAIN INGESTION PIPELINE ====================

export async function processDocumentUpload(
  mediaUrl: string,
  mediaContentType: string | null,
  messageBody: string,
  apiKey: string,
  tenantId: string,
  userId: string | null,
  contactPhone: string | null,
  conversationId: string | null,
  supabase: any,
  twilioSid?: string,
  twilioToken?: string,
): Promise<{ reply: string; documentId: string | null }> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  try {
    // === Step 1: Download and identify file ===
    const fileInfo = await downloadAndIdentify(mediaUrl, mediaContentType, twilioSid, twilioToken);
    if (!fileInfo) {
      return { reply: '❌ No pude descargar el archivo. Intenta enviarlo de nuevo.', documentId: null };
    }

    // === Step 2: Check for duplicates by hash ===
    const { data: existingDoc } = await supabase
      .from('documents')
      .select('id, original_filename, document_type, google_drive_url')
      .eq('tenant_id', tenantId)
      .eq('file_hash', fileInfo.hash)
      .is('deleted_at', null)
      .maybeSingle();

    if (existingDoc) {
      return {
        reply: `⚠️ Este archivo ya existe en el sistema.\n\n📄 *${existingDoc.original_filename}*\nTipo: ${existingDoc.document_type || 'Sin clasificar'}\n${existingDoc.google_drive_url ? `📁 ${existingDoc.google_drive_url}` : ''}\n\n¿Quieres que lo suba como una nueva versión?`,
        documentId: existingDoc.id,
      };
    }

    // === Step 3: Extract text (OCR for images, AI for PDFs) ===
    let extractedText = '';
    if (fileInfo.isImage || fileInfo.isPdf) {
      extractedText = await extractTextFromFile(apiKey, fileInfo);
    }

    // === Step 4: Classify document with AI ===
    const classification = await classifyDocument(apiKey, fileInfo, messageBody, extractedText);

    // === Step 5: Create document record ===
    const { data: doc, error: insertErr } = await supabase
      .from('documents')
      .insert({
        tenant_id: tenantId,
        conversation_id: conversationId,
        user_id: userId,
        contact_phone: contactPhone,
        original_filename: fileInfo.filename,
        normalized_filename: normalizeFilename(fileInfo.filename, classification.document_type),
        mime_type: fileInfo.mimeType,
        extension: fileInfo.extension,
        file_size: fileInfo.size,
        file_hash: fileInfo.hash,
        document_type: classification.document_type,
        document_category: classification.category,
        classification_confidence: classification.confidence,
        analysis_summary: classification.summary,
        extracted_text: extractedText || null,
        extracted_data: classification.extracted_data || {},
        entities: classification.entities || [],
        key_dates: classification.key_dates || [],
        key_amounts: classification.key_amounts || [],
        risks: classification.risks || [],
        recommended_actions: classification.recommended_actions || [],
        upload_status: 'pending',
        analysis_status: 'processing',
        ocr_status: extractedText ? 'completed' : 'not_required',
        source_channel: 'whatsapp',
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('[DOC] Insert error:', insertErr.message);
      return { reply: '❌ Error al registrar el documento. Intenta de nuevo.', documentId: null };
    }

    const documentId = doc.id;

    // === Step 6: Run specialized agents (async but awaited) ===
    let agentResults: any[] = [];
    try {
      agentResults = await runDocumentAgents(
        apiKey, classification.document_type, extractedText || classification.summary,
        classification, fileInfo.filename,
      );

      // Merge agent results into document
      if (agentResults.length > 0) {
        const agentData: Record<string, any> = {};
        const mergedEntities = [...(classification.entities || [])];
        const mergedRisks = [...(classification.risks || [])];
        const mergedDates = [...(classification.key_dates || [])];
        const mergedAmounts = [...(classification.key_amounts || [])];

        for (const ar of agentResults) {
          agentData[ar.agent] = { confidence: ar.confidence, summary: ar.summary, output: ar.output };

          // Merge entities from entity agent
          if (ar.agent === 'entity_extraction' && ar.output) {
            for (const category of ['persons', 'companies', 'phones', 'emails', 'identifiers']) {
              for (const ent of (ar.output[category] || [])) {
                mergedEntities.push({ type: category.replace(/s$/, ''), value: ent.name || ent.value || ent.number || ent.email, confidence: ent.confidence });
              }
            }
            for (const d of (ar.output.dates || [])) mergedDates.push(d);
            for (const a of (ar.output.amounts || [])) mergedAmounts.push(a);
          }

          // Merge risks from risk agent
          if (ar.agent === 'risk_detection' && ar.output?.risks) {
            for (const r of ar.output.risks) mergedRisks.push(r);
          }
        }

        await supabase.from('documents').update({
          extracted_data: { ...(classification.extracted_data || {}), agent_analysis: agentData },
          entities: deduplicateArray(mergedEntities, 'value'),
          risks: mergedRisks,
          key_dates: deduplicateArray(mergedDates, 'date'),
          key_amounts: deduplicateArray(mergedAmounts, 'amount'),
          analysis_status: 'completed',
        }).eq('id', documentId);
      } else {
        await supabase.from('documents').update({ analysis_status: 'completed' }).eq('id', documentId);
      }
    } catch (agentErr) {
      console.error('[DOC] Agent error:', agentErr);
      await supabase.from('documents').update({ analysis_status: 'completed' }).eq('id', documentId);
    }

    // === Step 7: Upload to Google Drive ===
    let driveResult: { success: boolean; driveUrl?: string; driveFileId?: string; folderId?: string } = { success: false };
    try {
      driveResult = await uploadDocumentToDrive(
        supabase, tenantId, mediaUrl, fileInfo,
        classification.document_type, documentId,
        SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, twilioSid, twilioToken,
      );
    } catch (e) {
      console.error('[DOC] Drive upload error:', e);
    }

    if (driveResult.success) {
      await supabase.from('documents').update({
        google_drive_file_id: driveResult.driveFileId,
        google_drive_folder_id: driveResult.folderId,
        google_drive_url: driveResult.driveUrl,
        upload_status: 'uploaded',
      }).eq('id', documentId);
    } else {
      await supabase.from('documents').update({ upload_status: 'drive_not_configured' }).eq('id', documentId);
    }

    // === Step 8: Create alerts for risks ===
    const allRisks = classification.risks || [];
    if (allRisks.length > 0) {
      const alerts = allRisks.map((risk: any) => ({
        tenant_id: tenantId, document_id: documentId,
        alert_type: 'risk_detected', severity: risk.severity || 'warning',
        title: risk.title || 'Riesgo detectado', description: risk.description || '',
        metadata: risk,
      }));
      await supabase.from('document_alerts').insert(alerts);
    }

    // === Step 9: Chunk for RAG (fire-and-forget) ===
    chunkDocumentAsync(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, tenantId, documentId)
      .catch(e => console.error('[DOC] Chunking error:', e));

    // === Step 10: Execute workflows (fire-and-forget) ===
    ensureDefaultWorkflowRules(supabase, tenantId).catch(() => {});
    evaluateDocumentWorkflows(supabase, tenantId, documentId, {
      type: classification.document_type,
      category: classification.category,
      filename: fileInfo.filename,
      summary: classification.summary,
      entities: classification.entities || [],
      key_dates: classification.key_dates || [],
      key_amounts: classification.key_amounts || [],
      risks: classification.risks || [],
      extracted_data: classification.extracted_data || {},
      classification_confidence: classification.confidence,
      contact_phone: contactPhone || undefined,
    }, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).catch(e => console.error('[DOC] Workflow error:', e));

    // === Step 11: Store in memory (fire-and-forget) ===
    learnFromDocument(supabase, tenantId, contactPhone, conversationId, {
      id: documentId, type: classification.document_type, filename: fileInfo.filename,
      summary: classification.summary, entities: classification.entities || [],
      key_dates: classification.key_dates || [], key_amounts: classification.key_amounts || [],
      agentResults,
    }).catch(e => console.error('[DOC] Memory error:', e));

    // === Step 12: Build reply ===
    const reply = buildDocumentReply(fileInfo, classification, driveResult, agentResults);
    return { reply, documentId };

  } catch (err) {
    console.error('[DOC] Pipeline error:', err);
    return { reply: '❌ Error procesando el documento. Intenta de nuevo.', documentId: null };
  }
}

// ==================== TEXT EXTRACTION ====================

async function extractTextFromFile(apiKey: string, fileInfo: FileInfo): Promise<string> {
  try {
    const base64 = btoa(String.fromCharCode(...new Uint8Array(fileInfo.buffer)));
    const mimeForAI = fileInfo.isPdf ? 'application/pdf' : fileInfo.mimeType;

    const res = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Extrae TODO el texto de este documento. Mantén la estructura original. Devuelve SOLO el texto extraído, sin explicaciones.' },
            { type: 'image_url', image_url: { url: `data:${mimeForAI};base64,${base64}` } },
          ],
        }],
      }),
    });

    if (!res.ok) return '';
    const result = await res.json();
    return result.choices?.[0]?.message?.content || '';
  } catch (e) {
    console.error('[DOC] Text extraction error:', e);
    return '';
  }
}

// ==================== ASYNC CHUNKING ====================

async function chunkDocumentAsync(supabaseUrl: string, serviceRoleKey: string, tenantId: string, documentId: string): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/functions/v1/document-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ action: 'chunk_document', tenant_id: tenantId, document_id: documentId }),
    });
  } catch (e) {
    console.error('[DOC] Async chunk error:', e);
  }
}

// ==================== DOWNLOAD & IDENTIFY ====================

interface FileInfo {
  filename: string; mimeType: string; extension: string;
  size: number; hash: string; buffer: ArrayBuffer;
  isImage: boolean; isPdf: boolean;
}

async function downloadAndIdentify(url: string, contentType: string | null, twilioSid?: string, twilioToken?: string): Promise<FileInfo | null> {
  try {
    const headers: Record<string, string> = {};
    if (twilioSid && twilioToken) headers['Authorization'] = `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`;

    const res = await fetch(url, { headers });
    if (!res.ok) return null;

    const buffer = await res.arrayBuffer();
    const mimeType = contentType || res.headers.get('content-type') || 'application/octet-stream';
    const extension = getExtFromMime(mimeType);
    const filename = extractFilename(url, extension);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    return { filename, mimeType, extension, size: buffer.byteLength, hash, buffer, isImage: mimeType.startsWith('image/'), isPdf: mimeType === 'application/pdf' };
  } catch (e) {
    console.error('[DOC] Download error:', e);
    return null;
  }
}

function getExtFromMime(mime: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'text/csv': 'csv', 'text/plain': 'txt',
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
  };
  return map[mime] || mime.split('/').pop() || 'bin';
}

function extractFilename(url: string, ext: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (last?.includes('.')) return decodeURIComponent(last);
  } catch { /* ignore */ }
  return `archivo_${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}.${ext}`;
}

// ==================== AI CLASSIFICATION ====================

interface Classification {
  document_type: string; category: string; summary: string; confidence: number;
  extracted_data: Record<string, any>; entities: any[]; key_dates: any[];
  key_amounts: any[]; risks: any[]; recommended_actions: any[];
}

async function classifyDocument(apiKey: string, fileInfo: FileInfo, userMessage: string, extractedText: string): Promise<Classification> {
  const defaultResult: Classification = {
    document_type: 'other', category: 'General', summary: 'Documento recibido sin clasificación automática.',
    confidence: 0, extracted_data: {}, entities: [], key_dates: [], key_amounts: [], risks: [], recommended_actions: [],
  };

  try {
    const systemPrompt = `Eres un clasificador documental empresarial experto. Analiza el archivo recibido y responde SOLO con JSON válido.

Tipos de documento válidos: ${DOCUMENT_TYPES.join(', ')}

Responde con este formato JSON exacto:
{
  "document_type": "tipo_del_documento",
  "category": "Categoría general (Legal, Financiero, Identificación, Operativo)",
  "summary": "Resumen ejecutivo de 2-3 oraciones",
  "confidence": 0.85,
  "extracted_data": {"title": "...", "parties": ["..."], "document_number": "..."},
  "entities": [{"type": "person|company|address|rfc", "value": "valor", "confidence": 0.9}],
  "key_dates": [{"type": "firma|vencimiento|vigencia", "date": "2026-12-31", "description": "Descripción"}],
  "key_amounts": [{"amount": 50000, "currency": "MXN", "description": "Monto total"}],
  "risks": [{"severity": "high|medium|low", "title": "Título", "description": "Detalle"}],
  "recommended_actions": [{"action": "Acción sugerida", "priority": "high|medium|low"}]
}`;

    const messages: any[] = [{ role: 'system', content: systemPrompt }];

    if (fileInfo.isImage) {
      const base64 = btoa(String.fromCharCode(...new Uint8Array(fileInfo.buffer)));
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: `Clasifica este documento. Contexto: "${userMessage || 'Sin contexto'}". Archivo: ${fileInfo.filename}${extractedText ? `\n\nTexto extraído:\n${extractedText.substring(0, 3000)}` : ''}` },
          { type: 'image_url', image_url: { url: `data:${fileInfo.mimeType};base64,${base64}` } },
        ],
      });
    } else {
      messages.push({
        role: 'user',
        content: `Clasifica este documento:
- Archivo: ${fileInfo.filename} (${fileInfo.mimeType}, ${(fileInfo.size / 1024).toFixed(1)} KB)
- Contexto: "${userMessage || 'Sin contexto'}"
${extractedText ? `\nTexto extraído:\n${extractedText.substring(0, 4000)}` : ''}

Responde SOLO con JSON válido.`,
      });
    }

    const res = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'google/gemini-2.5-flash', messages, response_format: { type: 'json_object' } }),
    });

    if (!res.ok) return defaultResult;
    const result = await res.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content) return defaultResult;

    const parsed = JSON.parse(content);
    return {
      document_type: parsed.document_type || 'other', category: parsed.category || 'General',
      summary: parsed.summary || 'Documento procesado.', confidence: parsed.confidence || 0.5,
      extracted_data: parsed.extracted_data || {}, entities: parsed.entities || [],
      key_dates: parsed.key_dates || [], key_amounts: parsed.key_amounts || [],
      risks: parsed.risks || [], recommended_actions: parsed.recommended_actions || [],
    };
  } catch (e) {
    console.error('[DOC] Classification error:', e);
    return defaultResult;
  }
}

// ==================== DRIVE UPLOAD ====================

async function uploadDocumentToDrive(
  supabase: any, tenantId: string, fileUrl: string, fileInfo: FileInfo,
  documentType: string, documentId: string, supabaseUrl: string, serviceRoleKey: string,
  twilioSid?: string, twilioToken?: string,
): Promise<{ success: boolean; driveUrl?: string; driveFileId?: string; folderId?: string }> {
  const { data: driveSettings } = await supabase
    .from('tenant_drive_settings').select('drive_root_folder_id')
    .eq('tenant_id', tenantId).maybeSingle();

  if (!driveSettings?.drive_root_folder_id) return { success: false };

  const folderName = FOLDER_MAP[documentType] || 'Otros';

  const ensureFolderRes = await fetch(`${supabaseUrl}/functions/v1/google-drive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceRoleKey}` },
    body: JSON.stringify({ action: 'ensure_subfolder', tenant_id: tenantId, internal_caller: true, folder_name: folderName }),
  });

  let targetFolderId: string | null = null;
  try { targetFolderId = (await ensureFolderRes.json()).folder_id || null; } catch { /* fallback to root */ }

  const uploadRes = await fetch(`${supabaseUrl}/functions/v1/google-drive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceRoleKey}` },
    body: JSON.stringify({
      action: 'upload_file_to_folder', tenant_id: tenantId, internal_caller: true,
      file_url: fileUrl, file_name: fileInfo.filename, target_folder_id: targetFolderId,
      document_id: documentId,
      twilio_sid: twilioSid || Deno.env.get('TWILIO_ACCOUNT_SID'),
      twilio_token: twilioToken || Deno.env.get('TWILIO_AUTH_TOKEN'),
    }),
  });

  const uploadResult = await uploadRes.json();
  if (uploadResult.success) {
    return { success: true, driveUrl: uploadResult.drive_file_url, driveFileId: uploadResult.drive_file_id, folderId: targetFolderId || driveSettings.drive_root_folder_id };
  }
  return { success: false };
}

// ==================== REPLY BUILDER ====================

function buildDocumentReply(
  fileInfo: FileInfo, classification: Classification,
  driveResult: { success: boolean; driveUrl?: string },
  agentResults: any[] = [],
): string {
  const typeEmoji: Record<string, string> = {
    contrato: '📜', factura: '🧾', identificacion: '🪪', cotizacion: '💰',
    comprobante: '🧾', estado_de_cuenta: '🏦', expediente_legal: '⚖️',
    documento_corporativo: '🏢', formato_interno: '📋', evidencia_fotografica: '📸',
    recibo: '🧾', poliza: '📋', acuerdo: '🤝', poder_notarial: '⚖️',
    acta: '📜', reporte: '📊', manual: '📖', other: '📄',
  };

  const emoji = typeEmoji[classification.document_type] || '📄';
  const confidence = Math.round(classification.confidence * 100);

  let reply = `${emoji} *Documento procesado*\n\n`;
  reply += `📄 *${fileInfo.filename}*\n`;
  reply += `📂 Tipo: *${classification.document_type.replace(/_/g, ' ')}* (${confidence}% confianza)\n`;
  reply += `📁 Categoría: ${classification.category}\n`;
  if (driveResult.success) reply += `✅ Guardado en Google Drive\n`;
  reply += `\n💡 *Resumen:* ${classification.summary}\n`;

  if (classification.key_amounts.length > 0) {
    reply += '\n💰 *Montos:*\n';
    for (const amt of classification.key_amounts.slice(0, 3)) {
      reply += `  • $${amt.amount?.toLocaleString() || '?'} ${amt.currency || 'MXN'} — ${amt.description || ''}\n`;
    }
  }

  if (classification.key_dates.length > 0) {
    reply += '\n📅 *Fechas clave:*\n';
    for (const dt of classification.key_dates.slice(0, 3)) {
      reply += `  • ${dt.type || 'Fecha'}: ${dt.date || '?'} — ${dt.description || ''}\n`;
    }
  }

  if (classification.entities.length > 0) {
    reply += '\n👤 *Entidades:*\n';
    for (const ent of classification.entities.slice(0, 4)) {
      reply += `  • ${ent.type || '?'}: ${ent.value || '?'}\n`;
    }
  }

  if (classification.risks.length > 0) {
    reply += '\n⚠️ *Alertas:*\n';
    for (const risk of classification.risks.slice(0, 3)) {
      const sevEmoji = risk.severity === 'high' ? '🔴' : risk.severity === 'medium' ? '🟡' : '🟢';
      reply += `  ${sevEmoji} ${risk.title}: ${risk.description || ''}\n`;
    }
  }

  // Agent analysis summaries
  if (agentResults.length > 0) {
    reply += '\n🤖 *Análisis especializado:*\n';
    for (const ar of agentResults) {
      const agentNames: Record<string, string> = {
        entity_extraction: '🔍 Entidades', legal_analysis: '⚖️ Legal',
        financial_analysis: '💰 Financiero', risk_detection: '🛡️ Riesgos',
      };
      reply += `  ${agentNames[ar.agent] || ar.agent}: ${ar.summary}\n`;
    }
  }

  if (classification.recommended_actions.length > 0) {
    reply += '\n📋 *Acciones sugeridas:*\n';
    for (const action of classification.recommended_actions.slice(0, 3)) {
      reply += `  • ${action.action}\n`;
    }
  }

  reply += '\n_Puedes preguntarme sobre el contenido de este documento._ 💬';
  return reply;
}

// ==================== HELPERS ====================

function normalizeFilename(original: string, docType: string): string {
  const dateStr = new Date().toISOString().split('T')[0];
  const ext = original.split('.').pop() || 'bin';
  const baseName = original.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s_-]/g, '').trim().substring(0, 50);
  return `${docType}_${dateStr}_${baseName}.${ext}`;
}

function deduplicateArray(arr: any[], key: string): any[] {
  const seen = new Set();
  return arr.filter(item => {
    const val = item[key];
    if (val && seen.has(val)) return false;
    if (val) seen.add(val);
    return true;
  });
}

// ==================== DOCUMENT SEARCH (for tools) ====================

export async function searchDocuments(supabase: any, tenantId: string, args: any): Promise<string> {
  let dbQuery = supabase
    .from('documents')
    .select('id, original_filename, document_type, document_category, analysis_summary, google_drive_url, extracted_data, key_dates, key_amounts, entities, created_at, contact_phone')
    .eq('tenant_id', tenantId).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(args.limit || 10);

  if (args.document_type) dbQuery = dbQuery.eq('document_type', args.document_type);
  if (args.contact_phone) dbQuery = dbQuery.eq('contact_phone', args.contact_phone);
  if (args.date_from) dbQuery = dbQuery.gte('created_at', args.date_from);
  if (args.date_to) dbQuery = dbQuery.lte('created_at', args.date_to);
  if (args.query) dbQuery = dbQuery.or(`original_filename.ilike.%${args.query}%,analysis_summary.ilike.%${args.query}%,document_type.ilike.%${args.query}%`);

  const { data, error } = await dbQuery;
  if (error) return JSON.stringify({ error: error.message });

  return JSON.stringify({
    documents: (data || []).map((d: any) => ({
      id: d.id, filename: d.original_filename, type: d.document_type,
      category: d.document_category, summary: d.analysis_summary,
      drive_url: d.google_drive_url, amounts: d.key_amounts, dates: d.key_dates,
      entities: d.entities, contact: d.contact_phone, uploaded: d.created_at,
    })),
    count: (data || []).length,
  });
}

export async function getDocumentDetail(supabase: any, tenantId: string, documentId: string): Promise<string> {
  const { data: doc, error } = await supabase
    .from('documents').select('*')
    .eq('id', documentId).eq('tenant_id', tenantId).is('deleted_at', null).single();

  if (error || !doc) return JSON.stringify({ error: 'Documento no encontrado.' });

  return JSON.stringify({
    id: doc.id, filename: doc.original_filename, type: doc.document_type,
    category: doc.document_category, summary: doc.analysis_summary,
    drive_url: doc.google_drive_url, extracted_data: doc.extracted_data,
    entities: doc.entities, key_dates: doc.key_dates, key_amounts: doc.key_amounts,
    risks: doc.risks, recommended_actions: doc.recommended_actions,
    upload_status: doc.upload_status, analysis_status: doc.analysis_status,
    version: doc.version_number, created: doc.created_at,
    has_text: !!(doc.extracted_text?.length > 20),
  });
}
