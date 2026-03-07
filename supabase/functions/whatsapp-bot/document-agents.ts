/**
 * Specialized Document Analysis Agents
 * 
 * Each agent has a focused prompt and produces structured output.
 * The orchestrator coordinates agents based on document type.
 */

import { AI_GATEWAY_URL } from "./constants.ts";

interface AgentResult {
  agent: string;
  confidence: number;
  output: Record<string, any>;
  summary: string;
}

// ==================== ORCHESTRATOR ====================

export async function runDocumentAgents(
  apiKey: string,
  documentType: string,
  extractedText: string,
  classification: Record<string, any>,
  filename: string,
): Promise<AgentResult[]> {
  const results: AgentResult[] = [];
  const textForAnalysis = extractedText?.substring(0, 8000) || '';

  if (!textForAnalysis || textForAnalysis.length < 20) return results;

  // Select agents based on document type
  const agentsToRun: Array<() => Promise<AgentResult | null>> = [];

  // Always run entity extraction
  agentsToRun.push(() => runEntityAgent(apiKey, textForAnalysis, filename));

  // Type-specific agents
  const legalTypes = ['contrato', 'acuerdo', 'poder_notarial', 'acta', 'expediente_legal'];
  const financialTypes = ['factura', 'cotizacion', 'comprobante', 'recibo', 'estado_de_cuenta', 'poliza'];

  if (legalTypes.includes(documentType)) {
    agentsToRun.push(() => runLegalAgent(apiKey, textForAnalysis, filename));
  }
  if (financialTypes.includes(documentType)) {
    agentsToRun.push(() => runFinancialAgent(apiKey, textForAnalysis, filename));
  }

  // Always run risk detection
  agentsToRun.push(() => runRiskAgent(apiKey, textForAnalysis, documentType, filename));

  // Run all selected agents in parallel
  const agentResults = await Promise.allSettled(agentsToRun.map(fn => fn()));

  for (const r of agentResults) {
    if (r.status === 'fulfilled' && r.value) {
      results.push(r.value);
    }
  }

  return results;
}

// ==================== ENTITY EXTRACTION AGENT ====================

async function runEntityAgent(apiKey: string, text: string, filename: string): Promise<AgentResult | null> {
  try {
    const res = await callAI(apiKey, `Eres un agente especializado en extracción de entidades de documentos empresariales mexicanos.

Analiza este documento y extrae TODAS las entidades relevantes.

Responde SOLO con JSON:
{
  "persons": [{"name": "...", "role": "...", "confidence": 0.9}],
  "companies": [{"name": "...", "type": "...", "rfc": "...", "confidence": 0.9}],
  "addresses": [{"full": "...", "city": "...", "state": "...", "confidence": 0.8}],
  "phones": [{"number": "...", "owner": "...", "confidence": 0.9}],
  "emails": [{"email": "...", "owner": "...", "confidence": 0.9}],
  "identifiers": [{"type": "RFC|CURP|INE|passport|folio|contract_number", "value": "...", "confidence": 0.9}],
  "dates": [{"type": "firma|vencimiento|vigencia_inicio|vigencia_fin|nacimiento|emision", "date": "YYYY-MM-DD", "description": "...", "confidence": 0.9}],
  "amounts": [{"amount": 50000, "currency": "MXN", "description": "...", "confidence": 0.9}]
}`, `Documento: ${filename}\n\n${text}`);

    if (!res) return null;
    const parsed = JSON.parse(res);
    const totalEntities = Object.values(parsed).flat().length;

    return {
      agent: 'entity_extraction',
      confidence: totalEntities > 0 ? 0.85 : 0.3,
      output: parsed,
      summary: `${totalEntities} entidades extraídas: ${(parsed.persons || []).length} personas, ${(parsed.companies || []).length} empresas, ${(parsed.dates || []).length} fechas, ${(parsed.amounts || []).length} montos.`,
    };
  } catch (e) {
    console.error('[AGENT:entity] Error:', e);
    return null;
  }
}

// ==================== LEGAL ANALYSIS AGENT ====================

async function runLegalAgent(apiKey: string, text: string, filename: string): Promise<AgentResult | null> {
  try {
    const res = await callAI(apiKey, `Eres un agente especializado en análisis legal de documentos mexicanos.

Analiza este documento legal y proporciona un análisis estructurado.

Responde SOLO con JSON:
{
  "document_nature": "contrato|acuerdo|poder|acta|otro",
  "executive_summary": "Resumen ejecutivo de 2-3 oraciones",
  "parties": [{"name": "...", "role": "parte_a|parte_b|testigo|notario|representante", "obligations": ["..."]}],
  "key_clauses": [{"number": "...", "title": "...", "summary": "...", "risk_level": "high|medium|low"}],
  "obligations": [{"party": "...", "obligation": "...", "deadline": "...", "penalty": "..."}],
  "penalties": [{"condition": "...", "amount": "...", "description": "..."}],
  "renewal_terms": {"auto_renewal": true, "notice_period": "30 días", "conditions": "..."},
  "termination_clauses": [{"condition": "...", "notice_required": "...", "penalties": "..."}],
  "jurisdiction": "...",
  "governing_law": "...",
  "missing_elements": ["firma faltante", "fecha incompleta"],
  "overall_risk": "high|medium|low",
  "recommendations": ["..."]
}`, `Documento legal: ${filename}\n\n${text}`);

    if (!res) return null;
    const parsed = JSON.parse(res);

    return {
      agent: 'legal_analysis',
      confidence: 0.82,
      output: parsed,
      summary: `Análisis legal: ${parsed.document_nature || 'documento'}. Riesgo: ${parsed.overall_risk || 'no determinado'}. ${(parsed.key_clauses || []).length} cláusulas, ${(parsed.obligations || []).length} obligaciones, ${(parsed.penalties || []).length} penalizaciones.`,
    };
  } catch (e) {
    console.error('[AGENT:legal] Error:', e);
    return null;
  }
}

// ==================== FINANCIAL ANALYSIS AGENT ====================

async function runFinancialAgent(apiKey: string, text: string, filename: string): Promise<AgentResult | null> {
  try {
    const res = await callAI(apiKey, `Eres un agente especializado en análisis financiero de documentos mexicanos.

Analiza este documento financiero y extrae información estructurada.

Responde SOLO con JSON:
{
  "document_subtype": "factura_cfdi|factura_pos|cotizacion|recibo|estado_cuenta|poliza|comprobante",
  "executive_summary": "Resumen de 1-2 oraciones",
  "issuer": {"name": "...", "rfc": "...", "address": "..."},
  "recipient": {"name": "...", "rfc": "...", "address": "..."},
  "amounts": {
    "subtotal": 0, "iva": 0, "isr_retenido": 0, "iva_retenido": 0,
    "total": 0, "currency": "MXN", "payment_method": "...",
    "line_items": [{"description": "...", "quantity": 1, "unit_price": 0, "total": 0}]
  },
  "fiscal_data": {"folio": "...", "serie": "...", "uuid_cfdi": "...", "fecha_emision": "...", "regimen_fiscal": "..."},
  "payment_terms": {"due_date": "...", "payment_conditions": "...", "bank_account": "..."},
  "discrepancies": [{"type": "...", "description": "...", "severity": "high|medium|low"}],
  "recommendations": ["..."]
}`, `Documento financiero: ${filename}\n\n${text}`);

    if (!res) return null;
    const parsed = JSON.parse(res);

    return {
      agent: 'financial_analysis',
      confidence: 0.85,
      output: parsed,
      summary: `Análisis financiero: ${parsed.document_subtype || 'documento'}. Total: $${parsed.amounts?.total || '?'} ${parsed.amounts?.currency || 'MXN'}. ${(parsed.discrepancies || []).length} discrepancias.`,
    };
  } catch (e) {
    console.error('[AGENT:financial] Error:', e);
    return null;
  }
}

// ==================== RISK DETECTION AGENT ====================

async function runRiskAgent(apiKey: string, text: string, docType: string, filename: string): Promise<AgentResult | null> {
  try {
    const res = await callAI(apiKey, `Eres un agente especializado en detección de riesgos en documentos empresariales.

Analiza este documento buscando cualquier riesgo, señal de alerta o elemento que requiera atención.

Responde SOLO con JSON:
{
  "overall_risk_score": 0.7,
  "risk_level": "high|medium|low|none",
  "risks": [
    {
      "category": "legal|financial|compliance|operational|data_quality",
      "severity": "critical|high|medium|low",
      "title": "Título del riesgo",
      "description": "Detalle del riesgo",
      "evidence": "Texto del documento que evidencia el riesgo",
      "recommendation": "Acción recomendada",
      "deadline": "YYYY-MM-DD si aplica"
    }
  ],
  "expiration_alerts": [
    {"type": "contrato|licencia|poliza|certificado", "date": "YYYY-MM-DD", "days_remaining": 30, "description": "..."}
  ],
  "missing_elements": [
    {"element": "firma|fecha|sello|RFC|domicilio", "severity": "high|medium|low", "description": "..."}
  ],
  "data_quality_score": 0.8,
  "completeness_score": 0.9
}`, `Tipo de documento: ${docType}\nArchivo: ${filename}\n\n${text}`);

    if (!res) return null;
    const parsed = JSON.parse(res);

    return {
      agent: 'risk_detection',
      confidence: parsed.data_quality_score || 0.7,
      output: parsed,
      summary: `Riesgo: ${parsed.risk_level || 'no determinado'} (score: ${parsed.overall_risk_score || '?'}). ${(parsed.risks || []).length} riesgos, ${(parsed.expiration_alerts || []).length} alertas de vencimiento, ${(parsed.missing_elements || []).length} elementos faltantes.`,
    };
  } catch (e) {
    console.error('[AGENT:risk] Error:', e);
    return null;
  }
}

// ==================== DOCUMENT COMPARISON AGENT ====================

export async function compareDocuments(
  apiKey: string,
  doc1Text: string,
  doc1Name: string,
  doc2Text: string,
  doc2Name: string,
): Promise<AgentResult | null> {
  try {
    const res = await callAI(apiKey, `Eres un agente especializado en comparación de documentos.

Compara estos dos documentos e identifica todas las diferencias significativas.

Responde SOLO con JSON:
{
  "similarity_score": 0.75,
  "comparison_summary": "Resumen de 2-3 oraciones",
  "differences": [
    {
      "category": "monto|fecha|cláusula|parte|condición|otro",
      "severity": "critical|high|medium|low",
      "doc1_value": "valor en documento 1",
      "doc2_value": "valor en documento 2",
      "description": "Explicación de la diferencia"
    }
  ],
  "new_in_doc2": ["Elementos nuevos en el segundo documento"],
  "removed_from_doc1": ["Elementos eliminados del primer documento"],
  "recommendations": ["Acciones sugeridas basadas en las diferencias"]
}`, `DOCUMENTO 1 (${doc1Name}):\n${doc1Text.substring(0, 4000)}\n\n---\n\nDOCUMENTO 2 (${doc2Name}):\n${doc2Text.substring(0, 4000)}`);

    if (!res) return null;
    const parsed = JSON.parse(res);

    return {
      agent: 'document_comparison',
      confidence: 0.8,
      output: parsed,
      summary: `Similitud: ${Math.round((parsed.similarity_score || 0) * 100)}%. ${(parsed.differences || []).length} diferencias encontradas.`,
    };
  } catch (e) {
    console.error('[AGENT:comparison] Error:', e);
    return null;
  }
}

// ==================== AI HELPER ====================

async function callAI(apiKey: string, systemPrompt: string, userMessage: string): Promise<string | null> {
  try {
    const res = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      console.error('[AGENT] AI error:', res.status);
      return null;
    }

    const result = await res.json();
    return result.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error('[AGENT] Call error:', e);
    return null;
  }
}
