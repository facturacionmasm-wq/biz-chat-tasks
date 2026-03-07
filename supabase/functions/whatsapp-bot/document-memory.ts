/**
 * Document Memory System
 * 
 * Provides persistent semantic memory across conversations,
 * clients, and tenants for the document system.
 */

// ==================== MEMORY TYPES ====================
// - conversation: tied to a specific conversation
// - client: tied to a contact_phone (cross-conversation)
// - tenant: tenant-wide patterns and preferences

export interface MemoryEntry {
  memory_type: 'conversation' | 'client' | 'tenant';
  scope_key: string;
  content: string;
  metadata: Record<string, any>;
  relevance_score?: number;
}

// ==================== STORE MEMORY ====================

export async function storeMemory(
  supabase: any,
  tenantId: string,
  entries: MemoryEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  const rows = entries.map(e => ({
    tenant_id: tenantId,
    memory_type: e.memory_type,
    scope_key: e.scope_key,
    content: e.content,
    metadata: e.metadata,
    relevance_score: e.relevance_score || 1.0,
  }));

  const { error } = await supabase.from('document_memory').insert(rows);
  if (error) console.error('[MEMORY] Store error:', error.message);
}

// ==================== RETRIEVE MEMORY ====================

export async function retrieveMemory(
  supabase: any,
  tenantId: string,
  opts: {
    memoryType?: string;
    scopeKey?: string;
    limit?: number;
    query?: string;
  },
): Promise<MemoryEntry[]> {
  let dbQuery = supabase
    .from('document_memory')
    .select('memory_type, scope_key, content, metadata, relevance_score')
    .eq('tenant_id', tenantId)
    .order('relevance_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(opts.limit || 20);

  if (opts.memoryType) dbQuery = dbQuery.eq('memory_type', opts.memoryType);
  if (opts.scopeKey) dbQuery = dbQuery.eq('scope_key', opts.scopeKey);
  if (opts.query) {
    dbQuery = dbQuery.ilike('content', `%${opts.query}%`);
  }

  // Filter expired
  dbQuery = dbQuery.or('expires_at.is.null,expires_at.gt.now()');

  const { data, error } = await dbQuery;
  if (error) {
    console.error('[MEMORY] Retrieve error:', error.message);
    return [];
  }

  return (data || []) as MemoryEntry[];
}

// ==================== BUILD MEMORY CONTEXT ====================

export async function buildDocumentMemoryContext(
  supabase: any,
  tenantId: string,
  contactPhone: string | null,
  conversationId: string | null,
): Promise<string> {
  const memories: string[] = [];

  // 1. Tenant-level memory (document patterns, preferences)
  const tenantMemories = await retrieveMemory(supabase, tenantId, {
    memoryType: 'tenant',
    scopeKey: tenantId,
    limit: 5,
  });
  if (tenantMemories.length > 0) {
    memories.push('📋 Patrones del negocio:');
    for (const m of tenantMemories) {
      memories.push(`  • ${m.content}`);
    }
  }

  // 2. Client-level memory
  if (contactPhone) {
    const clientMemories = await retrieveMemory(supabase, tenantId, {
      memoryType: 'client',
      scopeKey: contactPhone,
      limit: 8,
    });
    if (clientMemories.length > 0) {
      memories.push('👤 Historial del contacto:');
      for (const m of clientMemories) {
        memories.push(`  • ${m.content}`);
      }
    }
  }

  // 3. Conversation-level memory
  if (conversationId) {
    const convMemories = await retrieveMemory(supabase, tenantId, {
      memoryType: 'conversation',
      scopeKey: conversationId,
      limit: 5,
    });
    if (convMemories.length > 0) {
      memories.push('💬 Contexto de esta conversación:');
      for (const m of convMemories) {
        memories.push(`  • ${m.content}`);
      }
    }
  }

  if (memories.length === 0) return '';
  return '\n\n=== MEMORIA DOCUMENTAL ===\n' + memories.join('\n');
}

// ==================== LEARN FROM DOCUMENT ====================

export async function learnFromDocument(
  supabase: any,
  tenantId: string,
  contactPhone: string | null,
  conversationId: string | null,
  document: {
    id: string;
    type: string;
    filename: string;
    summary: string;
    entities: any[];
    key_dates: any[];
    key_amounts: any[];
    agentResults?: any[];
  },
): Promise<void> {
  const entries: MemoryEntry[] = [];

  // Client memory: what documents this contact has sent
  if (contactPhone) {
    entries.push({
      memory_type: 'client',
      scope_key: contactPhone,
      content: `Envió documento "${document.filename}" (tipo: ${document.type}). ${document.summary}`,
      metadata: { document_id: document.id, document_type: document.type, action: 'document_received' },
    });

    // Track key entities found in client docs
    if (document.entities?.length > 0) {
      const entitySummary = document.entities
        .slice(0, 5)
        .map((e: any) => `${e.type}: ${e.value}`)
        .join(', ');
      entries.push({
        memory_type: 'client',
        scope_key: contactPhone,
        content: `Entidades detectadas en ${document.type}: ${entitySummary}`,
        metadata: { document_id: document.id, entities: document.entities.slice(0, 10) },
        relevance_score: 0.8,
      });
    }

    // Track upcoming dates
    if (document.key_dates?.length > 0) {
      for (const d of document.key_dates.slice(0, 3)) {
        entries.push({
          memory_type: 'client',
          scope_key: contactPhone,
          content: `Fecha importante: ${d.type} - ${d.date} (${d.description || document.filename})`,
          metadata: { document_id: document.id, date_info: d },
          relevance_score: 1.2,
        });
      }
    }
  }

  // Conversation memory
  if (conversationId) {
    entries.push({
      memory_type: 'conversation',
      scope_key: conversationId,
      content: `Documento procesado: ${document.filename} (${document.type}). ${document.summary}`,
      metadata: { document_id: document.id },
    });
  }

  // Tenant memory: document type patterns
  entries.push({
    memory_type: 'tenant',
    scope_key: tenantId,
    content: `Documento ${document.type} procesado: ${document.filename}`,
    metadata: { document_id: document.id, document_type: document.type },
    relevance_score: 0.5,
  });

  // Store agent analysis results in memory
  if (document.agentResults) {
    for (const result of document.agentResults) {
      if (contactPhone && result.summary) {
        entries.push({
          memory_type: 'client',
          scope_key: contactPhone,
          content: `Análisis ${result.agent}: ${result.summary}`,
          metadata: { document_id: document.id, agent: result.agent, confidence: result.confidence },
          relevance_score: result.confidence,
        });
      }
    }
  }

  await storeMemory(supabase, tenantId, entries);
}

// ==================== LEARN FROM CORRECTION ====================

export async function learnFromCorrection(
  supabase: any,
  tenantId: string,
  correction: {
    documentId: string;
    field: string;
    oldValue: string;
    newValue: string;
    contactPhone?: string;
  },
): Promise<void> {
  const entries: MemoryEntry[] = [
    {
      memory_type: 'tenant',
      scope_key: tenantId,
      content: `Corrección: "${correction.field}" cambiado de "${correction.oldValue}" a "${correction.newValue}" en documento ${correction.documentId}`,
      metadata: { ...correction, action: 'human_correction' },
      relevance_score: 1.5,
    },
  ];

  if (correction.contactPhone) {
    entries.push({
      memory_type: 'client',
      scope_key: correction.contactPhone,
      content: `Usuario corrigió ${correction.field}: "${correction.newValue}"`,
      metadata: { document_id: correction.documentId, field: correction.field },
      relevance_score: 1.3,
    });
  }

  await storeMemory(supabase, tenantId, entries);
}
