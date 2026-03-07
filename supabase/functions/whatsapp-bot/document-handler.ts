/**
 * Document Handler for WhatsApp Bot
 * 
 * Handles file reception, classification, Google Drive upload,
 * AI analysis, and metadata persistence.
 */

import { AI_GATEWAY_URL } from "./constants.ts";

// ==================== DOCUMENT TYPES ====================

const DOCUMENT_TYPES = [
  'contrato', 'factura', 'identificacion', 'cotizacion', 'comprobante',
  'estado_de_cuenta', 'expediente_legal', 'documento_corporativo',
  'formato_interno', 'evidencia_fotografica', 'recibo', 'poliza',
  'acuerdo', 'poder_notarial', 'acta', 'reporte', 'manual', 'other',
] as const;

const FOLDER_MAP: Record<string, string> = {
  contrato: 'Contratos',
  factura: 'Facturas',
  identificacion: 'Identificaciones',
  cotizacion: 'Cotizaciones',
  comprobante: 'Comprobantes',
  estado_de_cuenta: 'Estados de Cuenta',
  expediente_legal: 'Legal',
  documento_corporativo: 'Corporativo',
  formato_interno: 'Formatos Internos',
  evidencia_fotografica: 'Evidencias',
  recibo: 'Comprobantes',
  poliza: 'Pólizas',
  acuerdo: 'Contratos',
  poder_notarial: 'Legal',
  acta: 'Legal',
  reporte: 'Reportes',
  manual: 'Manuales',
  other: 'Otros',
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

    // === Step 3: Classify document with AI ===
    const classification = await classifyDocument(apiKey, fileInfo, messageBody);

    // === Step 4: Create document record ===
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
        extracted_data: classification.extracted_data || {},
        entities: classification.entities || [],
        key_dates: classification.key_dates || [],
        key_amounts: classification.key_amounts || [],
        risks: classification.risks || [],
        recommended_actions: classification.recommended_actions || [],
        upload_status: 'pending',
        analysis_status: 'completed',
        source_channel: 'whatsapp',
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('[DOC] Insert error:', insertErr.message);
      return { reply: '❌ Error al registrar el documento. Intenta de nuevo.', documentId: null };
    }

    const documentId = doc.id;

    // === Step 5: Upload to Google Drive (async-safe) ===
    let driveResult: { success: boolean; driveUrl?: string; driveFileId?: string; folderId?: string } = { success: false };
    try {
      driveResult = await uploadDocumentToDrive(
        supabase, tenantId, mediaUrl, fileInfo,
        classification.document_type, documentId,
        SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
        twilioSid, twilioToken,
      );
    } catch (e) {
      console.error('[DOC] Drive upload error:', e);
    }

    // Update document with Drive info
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

    // === Step 6: Create alerts for risks ===
    if (classification.risks && classification.risks.length > 0) {
      const alerts = classification.risks.map((risk: any) => ({
        tenant_id: tenantId,
        document_id: documentId,
        alert_type: 'risk_detected',
        severity: risk.severity || 'warning',
        title: risk.title || 'Riesgo detectado',
        description: risk.description || '',
        metadata: risk,
      }));
      await supabase.from('document_alerts').insert(alerts);
    }

    // === Step 7: Build conversational reply ===
    const reply = buildDocumentReply(fileInfo, classification, driveResult);
    return { reply, documentId };

  } catch (err) {
    console.error('[DOC] Pipeline error:', err);
    return { reply: '❌ Error procesando el documento. Intenta de nuevo.', documentId: null };
  }
}

// ==================== DOWNLOAD & IDENTIFY ====================

interface FileInfo {
  filename: string;
  mimeType: string;
  extension: string;
  size: number;
  hash: string;
  buffer: ArrayBuffer;
  isImage: boolean;
  isPdf: boolean;
}

async function downloadAndIdentify(
  url: string,
  contentType: string | null,
  twilioSid?: string,
  twilioToken?: string,
): Promise<FileInfo | null> {
  try {
    const headers: Record<string, string> = {};
    if (twilioSid && twilioToken) {
      headers['Authorization'] = `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error('[DOC] Download failed:', res.status);
      return null;
    }

    const buffer = await res.arrayBuffer();
    const mimeType = contentType || res.headers.get('content-type') || 'application/octet-stream';
    const extension = getExtFromMime(mimeType);
    const filename = extractFilename(url, extension);

    // Calculate SHA-256 hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    return {
      filename,
      mimeType,
      extension,
      size: buffer.byteLength,
      hash,
      buffer,
      isImage: mimeType.startsWith('image/'),
      isPdf: mimeType === 'application/pdf',
    };
  } catch (e) {
    console.error('[DOC] Download error:', e);
    return null;
  }
}

function getExtFromMime(mime: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/csv': 'csv',
    'text/plain': 'txt',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
  };
  return map[mime] || mime.split('/').pop() || 'bin';
}

function extractFilename(url: string, ext: string): string {
  try {
    const urlPath = new URL(url).pathname;
    const segments = urlPath.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && last.includes('.')) return decodeURIComponent(last);
  } catch { /* ignore */ }
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '').slice(0, 15);
  return `archivo_${ts}.${ext}`;
}

// ==================== AI CLASSIFICATION ====================

interface Classification {
  document_type: string;
  category: string;
  summary: string;
  confidence: number;
  extracted_data: Record<string, any>;
  entities: any[];
  key_dates: any[];
  key_amounts: any[];
  risks: any[];
  recommended_actions: any[];
}

async function classifyDocument(
  apiKey: string,
  fileInfo: FileInfo,
  userMessage: string,
): Promise<Classification> {
  const defaultResult: Classification = {
    document_type: 'other',
    category: 'General',
    summary: 'Documento recibido sin clasificación automática.',
    confidence: 0,
    extracted_data: {},
    entities: [],
    key_dates: [],
    key_amounts: [],
    risks: [],
    recommended_actions: [],
  };

  try {
    const messages: any[] = [
      {
        role: 'system',
        content: `Eres un clasificador documental empresarial experto. Analiza el archivo recibido y responde SOLO con JSON válido.

Tipos de documento válidos: ${DOCUMENT_TYPES.join(', ')}

Responde con este formato JSON exacto:
{
  "document_type": "tipo_del_documento",
  "category": "Categoría general (Legal, Financiero, Identificación, Operativo)",
  "summary": "Resumen ejecutivo de 1-2 oraciones",
  "confidence": 0.85,
  "extracted_data": {
    "title": "Título del documento si se detecta",
    "parties": ["Parte A", "Parte B"],
    "document_number": "Número o folio si aplica"
  },
  "entities": [{"type": "person|company|address|rfc", "value": "valor", "confidence": 0.9}],
  "key_dates": [{"type": "firma|vencimiento|vigencia", "date": "2026-12-31", "description": "Descripción"}],
  "key_amounts": [{"amount": 50000, "currency": "MXN", "description": "Monto total"}],
  "risks": [{"severity": "high|medium|low", "title": "Título del riesgo", "description": "Detalle"}],
  "recommended_actions": [{"action": "Acción sugerida", "priority": "high|medium|low"}]
}`,
      },
    ];

    // For images, use vision
    if (fileInfo.isImage) {
      const base64 = btoa(String.fromCharCode(...new Uint8Array(fileInfo.buffer)));
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: `Clasifica este documento. Contexto del usuario: "${userMessage || 'Sin contexto'}". Nombre del archivo: ${fileInfo.filename}` },
          { type: 'image_url', image_url: { url: `data:${fileInfo.mimeType};base64,${base64}` } },
        ],
      });
    } else {
      // For PDFs/docs, classify based on filename and user context
      messages.push({
        role: 'user',
        content: `Clasifica este documento basándote en la siguiente información:
- Nombre del archivo: ${fileInfo.filename}
- Tipo MIME: ${fileInfo.mimeType}
- Tamaño: ${(fileInfo.size / 1024).toFixed(1)} KB
- Contexto del usuario: "${userMessage || 'Sin contexto adicional'}"

Responde SOLO con JSON válido.`,
      });
    }

    const res = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      console.error('[DOC] Classification AI error:', res.status);
      return defaultResult;
    }

    const result = await res.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content) return defaultResult;

    const parsed = JSON.parse(content);
    return {
      document_type: parsed.document_type || 'other',
      category: parsed.category || 'General',
      summary: parsed.summary || 'Documento procesado.',
      confidence: parsed.confidence || 0.5,
      extracted_data: parsed.extracted_data || {},
      entities: parsed.entities || [],
      key_dates: parsed.key_dates || [],
      key_amounts: parsed.key_amounts || [],
      risks: parsed.risks || [],
      recommended_actions: parsed.recommended_actions || [],
    };
  } catch (e) {
    console.error('[DOC] Classification error:', e);
    return defaultResult;
  }
}

// ==================== DRIVE UPLOAD ====================

async function uploadDocumentToDrive(
  supabase: any,
  tenantId: string,
  fileUrl: string,
  fileInfo: FileInfo,
  documentType: string,
  documentId: string,
  supabaseUrl: string,
  serviceRoleKey: string,
  twilioSid?: string,
  twilioToken?: string,
): Promise<{ success: boolean; driveUrl?: string; driveFileId?: string; folderId?: string }> {

  // Check if Drive is configured
  const { data: driveSettings } = await supabase
    .from('tenant_drive_settings')
    .select('drive_root_folder_id')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!driveSettings?.drive_root_folder_id) {
    console.log('[DOC] Drive not configured for tenant:', tenantId);
    return { success: false };
  }

  // Determine subfolder name based on document type
  const folderName = FOLDER_MAP[documentType] || 'Otros';

  // First, ensure the subfolder exists via the google-drive function
  const ensureFolderRes = await fetch(`${supabaseUrl}/functions/v1/google-drive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      action: 'ensure_subfolder',
      tenant_id: tenantId,
      internal_caller: true,
      folder_name: folderName,
    }),
  });

  let targetFolderId: string | null = null;
  try {
    const folderResult = await ensureFolderRes.json();
    targetFolderId = folderResult.folder_id || null;
  } catch { /* will fall back to root */ }

  // Upload the file
  const uploadRes = await fetch(`${supabaseUrl}/functions/v1/google-drive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      action: 'upload_file_to_folder',
      tenant_id: tenantId,
      internal_caller: true,
      file_url: fileUrl,
      file_name: fileInfo.filename,
      target_folder_id: targetFolderId,
      document_id: documentId,
      twilio_sid: twilioSid || Deno.env.get('TWILIO_ACCOUNT_SID'),
      twilio_token: twilioToken || Deno.env.get('TWILIO_AUTH_TOKEN'),
    }),
  });

  const uploadResult = await uploadRes.json();
  if (uploadResult.success) {
    return {
      success: true,
      driveUrl: uploadResult.drive_file_url,
      driveFileId: uploadResult.drive_file_id,
      folderId: targetFolderId || driveSettings.drive_root_folder_id,
    };
  }

  console.log('[DOC] Drive upload result:', JSON.stringify(uploadResult));
  return { success: false };
}

// ==================== REPLY BUILDER ====================

function buildDocumentReply(
  fileInfo: FileInfo,
  classification: Classification,
  driveResult: { success: boolean; driveUrl?: string },
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

  if (driveResult.success) {
    reply += `✅ Guardado en Google Drive\n`;
  }

  reply += `\n💡 *Resumen:* ${classification.summary}\n`;

  // Key amounts
  if (classification.key_amounts.length > 0) {
    reply += '\n💰 *Montos detectados:*\n';
    for (const amt of classification.key_amounts.slice(0, 3)) {
      reply += `  • $${amt.amount?.toLocaleString() || '?'} ${amt.currency || 'MXN'} — ${amt.description || ''}\n`;
    }
  }

  // Key dates
  if (classification.key_dates.length > 0) {
    reply += '\n📅 *Fechas clave:*\n';
    for (const dt of classification.key_dates.slice(0, 3)) {
      reply += `  • ${dt.type || 'Fecha'}: ${dt.date || '?'} — ${dt.description || ''}\n`;
    }
  }

  // Entities
  if (classification.entities.length > 0) {
    reply += '\n👤 *Entidades:*\n';
    for (const ent of classification.entities.slice(0, 4)) {
      reply += `  • ${ent.type || '?'}: ${ent.value || '?'}\n`;
    }
  }

  // Risks
  if (classification.risks.length > 0) {
    reply += '\n⚠️ *Alertas:*\n';
    for (const risk of classification.risks.slice(0, 3)) {
      const sevEmoji = risk.severity === 'high' ? '🔴' : risk.severity === 'medium' ? '🟡' : '🟢';
      reply += `  ${sevEmoji} ${risk.title}: ${risk.description || ''}\n`;
    }
  }

  // Recommended actions
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
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const ext = original.split('.').pop() || 'bin';
  const baseName = original
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s_-]/g, '')
    .trim()
    .substring(0, 50);
  return `${docType}_${dateStr}_${baseName}.${ext}`;
}

// ==================== DOCUMENT SEARCH (for tools) ====================

export async function searchDocuments(
  supabase: any,
  tenantId: string,
  args: {
    query?: string;
    document_type?: string;
    contact_phone?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
  },
): Promise<string> {
  let dbQuery = supabase
    .from('documents')
    .select('id, original_filename, document_type, document_category, analysis_summary, google_drive_url, extracted_data, key_dates, key_amounts, entities, created_at, contact_phone')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(args.limit || 10);

  if (args.document_type) {
    dbQuery = dbQuery.eq('document_type', args.document_type);
  }
  if (args.contact_phone) {
    dbQuery = dbQuery.eq('contact_phone', args.contact_phone);
  }
  if (args.date_from) {
    dbQuery = dbQuery.gte('created_at', args.date_from);
  }
  if (args.date_to) {
    dbQuery = dbQuery.lte('created_at', args.date_to);
  }
  if (args.query) {
    dbQuery = dbQuery.or(
      `original_filename.ilike.%${args.query}%,analysis_summary.ilike.%${args.query}%,document_type.ilike.%${args.query}%`
    );
  }

  const { data, error } = await dbQuery;
  if (error) return JSON.stringify({ error: error.message });

  return JSON.stringify({
    documents: (data || []).map((d: any) => ({
      id: d.id,
      filename: d.original_filename,
      type: d.document_type,
      category: d.document_category,
      summary: d.analysis_summary,
      drive_url: d.google_drive_url,
      amounts: d.key_amounts,
      dates: d.key_dates,
      entities: d.entities,
      contact: d.contact_phone,
      uploaded: d.created_at,
    })),
    count: (data || []).length,
  });
}

export async function getDocumentDetail(
  supabase: any,
  tenantId: string,
  documentId: string,
): Promise<string> {
  const { data: doc, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .single();

  if (error || !doc) return JSON.stringify({ error: 'Documento no encontrado.' });

  return JSON.stringify({
    id: doc.id,
    filename: doc.original_filename,
    type: doc.document_type,
    category: doc.document_category,
    summary: doc.analysis_summary,
    drive_url: doc.google_drive_url,
    extracted_data: doc.extracted_data,
    entities: doc.entities,
    key_dates: doc.key_dates,
    key_amounts: doc.key_amounts,
    risks: doc.risks,
    recommended_actions: doc.recommended_actions,
    upload_status: doc.upload_status,
    analysis_status: doc.analysis_status,
    version: doc.version_number,
    created: doc.created_at,
  });
}
