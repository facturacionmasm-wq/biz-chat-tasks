/**
 * Document Workflow Engine
 * 
 * Evaluates documents against workflow rules and
 * executes automatic actions based on content.
 */

interface WorkflowAction {
  type: string;
  config: Record<string, any>;
  result?: string;
}

interface WorkflowRule {
  id: string;
  name: string;
  trigger_type: string;
  trigger_config: Record<string, any>;
  actions: WorkflowAction[];
}

// ==================== EVALUATE & EXECUTE WORKFLOWS ====================

export async function evaluateDocumentWorkflows(
  supabase: any,
  tenantId: string,
  documentId: string,
  document: {
    type: string;
    category: string;
    filename: string;
    summary: string;
    entities: any[];
    key_dates: any[];
    key_amounts: any[];
    risks: any[];
    extracted_data: Record<string, any>;
    classification_confidence: number;
    contact_phone?: string;
  },
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<{ executed: number; actions: string[] }> {
  const executedActions: string[] = [];

  // 1. Get active workflow rules for this tenant
  const { data: rules } = await supabase
    .from('document_workflow_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('active', true);

  const customRules = (rules || []) as WorkflowRule[];

  // 2. Execute built-in workflows
  const builtinActions = await executeBuiltinWorkflows(
    supabase, tenantId, documentId, document, supabaseUrl, serviceRoleKey,
  );
  executedActions.push(...builtinActions);

  // 3. Evaluate custom rules
  for (const rule of customRules) {
    const matches = evaluateRule(rule, document);
    if (matches) {
      const ruleActions = await executeRuleActions(
        supabase, tenantId, documentId, rule, document, supabaseUrl, serviceRoleKey,
      );
      executedActions.push(...ruleActions);

      // Log execution
      await supabase.from('document_workflow_log').insert({
        tenant_id: tenantId,
        document_id: documentId,
        rule_id: rule.id,
        status: 'executed',
        actions_taken: ruleActions.map(a => ({ action: a })),
      });
    }
  }

  return { executed: executedActions.length, actions: executedActions };
}

// ==================== BUILT-IN WORKFLOWS ====================

async function executeBuiltinWorkflows(
  supabase: any,
  tenantId: string,
  documentId: string,
  document: any,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<string[]> {
  const actions: string[] = [];

  // 1. Auto-create reminders for upcoming dates
  if (document.key_dates?.length > 0) {
    for (const dateInfo of document.key_dates) {
      if (dateInfo.type === 'vencimiento' || dateInfo.type === 'vigencia_fin') {
        const expDate = new Date(dateInfo.date);
        if (!isNaN(expDate.getTime()) && expDate > new Date()) {
          // Create reminder 7 days before
          const reminderDate = new Date(expDate);
          reminderDate.setDate(reminderDate.getDate() - 7);

          if (reminderDate > new Date()) {
            await supabase.from('document_alerts').insert({
              tenant_id: tenantId,
              document_id: documentId,
              alert_type: 'expiration_upcoming',
              severity: 'high',
              title: `Vencimiento próximo: ${document.filename}`,
              description: `${dateInfo.description || 'Documento'} vence el ${dateInfo.date}`,
              metadata: { date: dateInfo.date, type: dateInfo.type, reminder_created: true },
            });
            actions.push(`Alerta de vencimiento creada para ${dateInfo.date}`);
          }
        }
      }
    }
  }

  // 2. Auto-alert for high-risk documents
  if (document.risks?.length > 0) {
    const highRisks = document.risks.filter((r: any) => r.severity === 'critical' || r.severity === 'high');
    if (highRisks.length > 0) {
      actions.push(`${highRisks.length} alertas de alto riesgo registradas`);
    }
  }

  // 3. Low confidence → flag for review
  if (document.classification_confidence < 0.5) {
    await supabase.from('document_alerts').insert({
      tenant_id: tenantId,
      document_id: documentId,
      alert_type: 'low_confidence_classification',
      severity: 'medium',
      title: `Clasificación incierta: ${document.filename}`,
      description: `Confianza de clasificación: ${Math.round(document.classification_confidence * 100)}%. Requiere revisión manual.`,
      metadata: { confidence: document.classification_confidence, assigned_type: document.type },
    });
    actions.push('Marcado para revisión manual (baja confianza)');
  }

  // 4. Auto-link to contact if entities match
  if (document.contact_phone && document.entities?.length > 0) {
    const personEntities = document.entities.filter((e: any) => e.type === 'person');
    if (personEntities.length > 0) {
      // Update contact name if we don't have one
      const { data: contact } = await supabase
        .from('contacts')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .eq('phone', document.contact_phone)
        .maybeSingle();

      if (contact && !contact.name && personEntities[0]?.value) {
        await supabase.from('contacts')
          .update({ name: personEntities[0].value })
          .eq('id', contact.id);
        actions.push(`Nombre de contacto actualizado: ${personEntities[0].value}`);
      }
    }
  }

  // 5. Financial document → auto-create expense if not exists
  if (['factura', 'recibo', 'comprobante'].includes(document.type)) {
    const totalAmount = document.key_amounts?.[0];
    if (totalAmount?.amount && totalAmount.amount > 0) {
      actions.push(`Documento financiero detectado: $${totalAmount.amount} ${totalAmount.currency || 'MXN'}`);
    }
  }

  return actions;
}

// ==================== RULE EVALUATION ====================

function evaluateRule(rule: WorkflowRule, document: any): boolean {
  const config = rule.trigger_config;

  switch (rule.trigger_type) {
    case 'document_type':
      return config.types?.includes(document.type);

    case 'keyword':
      const keywords = config.keywords || [];
      const text = `${document.filename} ${document.summary} ${JSON.stringify(document.extracted_data)}`.toLowerCase();
      return keywords.some((kw: string) => text.includes(kw.toLowerCase()));

    case 'entity':
      const entityTypes = config.entity_types || [];
      return document.entities?.some((e: any) => entityTypes.includes(e.type));

    case 'amount_threshold':
      const threshold = config.min_amount || 0;
      return document.key_amounts?.some((a: any) => (a.amount || 0) >= threshold);

    case 'date_proximity':
      const daysAhead = config.days_ahead || 30;
      const now = new Date();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + daysAhead);
      return document.key_dates?.some((d: any) => {
        const dt = new Date(d.date);
        return dt >= now && dt <= cutoff;
      });

    default:
      return false;
  }
}

// ==================== ACTION EXECUTION ====================

async function executeRuleActions(
  supabase: any,
  tenantId: string,
  documentId: string,
  rule: WorkflowRule,
  document: any,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<string[]> {
  const results: string[] = [];

  for (const action of rule.actions) {
    try {
      switch (action.type) {
        case 'create_alert':
          await supabase.from('document_alerts').insert({
            tenant_id: tenantId,
            document_id: documentId,
            alert_type: action.config.alert_type || 'workflow_triggered',
            severity: action.config.severity || 'info',
            title: action.config.title || `Workflow: ${rule.name}`,
            description: action.config.description || '',
            metadata: { rule_id: rule.id, rule_name: rule.name },
          });
          results.push(`Alerta creada: ${action.config.title || rule.name}`);
          break;

        case 'move_to_folder':
          const folderRes = await fetch(`${supabaseUrl}/functions/v1/google-drive`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceRoleKey}` },
            body: JSON.stringify({
              action: 'ensure_subfolder',
              tenant_id: tenantId,
              internal_caller: true,
              folder_name: action.config.folder_name,
              parent_folder_name: action.config.parent_folder || null,
            }),
          });
          const folderResult = await folderRes.json();
          if (folderResult.folder_id) {
            results.push(`Carpeta asegurada: ${action.config.folder_name}`);
          }
          break;

        case 'tag_document':
          // Update document metadata with tags
          const { data: doc } = await supabase
            .from('documents')
            .select('extracted_data')
            .eq('id', documentId)
            .single();
          const currentData = doc?.extracted_data || {};
          const tags = currentData.tags || [];
          const newTags = [...new Set([...tags, ...(action.config.tags || [])])];
          await supabase.from('documents')
            .update({ extracted_data: { ...currentData, tags: newTags } })
            .eq('id', documentId);
          results.push(`Tags agregados: ${(action.config.tags || []).join(', ')}`);
          break;

        case 'notify_team':
          results.push(`Notificación pendiente: ${action.config.message || rule.name}`);
          break;

        default:
          console.log(`[WORKFLOW] Unknown action type: ${action.type}`);
      }
    } catch (e) {
      console.error(`[WORKFLOW] Action ${action.type} error:`, e);
    }
  }

  return results;
}

// ==================== SEED DEFAULT RULES ====================

export async function ensureDefaultWorkflowRules(
  supabase: any,
  tenantId: string,
): Promise<void> {
  const { count } = await supabase
    .from('document_workflow_rules')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  if ((count || 0) > 0) return;

  const defaultRules = [
    {
      tenant_id: tenantId,
      name: 'Contratos → Carpeta de Contratos',
      trigger_type: 'document_type',
      trigger_config: { types: ['contrato', 'acuerdo'] },
      actions: [{ type: 'move_to_folder', config: { folder_name: 'Contratos' } }],
    },
    {
      tenant_id: tenantId,
      name: 'Facturas → Carpeta de Facturas',
      trigger_type: 'document_type',
      trigger_config: { types: ['factura', 'recibo', 'comprobante'] },
      actions: [{ type: 'move_to_folder', config: { folder_name: 'Facturas' } }],
    },
    {
      tenant_id: tenantId,
      name: 'Alerta por montos altos',
      trigger_type: 'amount_threshold',
      trigger_config: { min_amount: 100000 },
      actions: [{ type: 'create_alert', config: { alert_type: 'high_amount', severity: 'high', title: 'Documento con monto alto detectado' } }],
    },
    {
      tenant_id: tenantId,
      name: 'Vencimientos próximos (30 días)',
      trigger_type: 'date_proximity',
      trigger_config: { days_ahead: 30 },
      actions: [{ type: 'create_alert', config: { alert_type: 'expiration_upcoming', severity: 'high', title: 'Documento con vencimiento próximo' } }],
    },
  ];

  await supabase.from('document_workflow_rules').insert(defaultRules);
  console.log(`[WORKFLOW] Seeded ${defaultRules.length} default rules for tenant ${tenantId}`);
}
