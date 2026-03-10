/**
 * Expense & Budget Handler for WhatsApp Bot
 * 
 * Classifies incoming expenses/documents as:
 * - GASTO YA PAGADO (default) → registers immediately as paid
 * - PRESUPUESTO → requires approval workflow
 */

import { AI_GATEWAY_URL } from "./constants.ts";
import { sendTwilioMessage } from "./helpers.ts";

// Helper to resolve tenant's WhatsApp sender config (avoids 63007 errors)
async function resolveTenantSender(
  supabase: any,
  tenantId: string,
): Promise<{ fromNum: string; msgSvcSid: string | undefined }> {
  const { data: tenantData } = await supabase
    .from('tenants')
    .select('whatsapp_config')
    .eq('id', tenantId)
    .single();

  const waConfig = tenantData?.whatsapp_config as Record<string, any> | null;
  let fromNum = '';
  let msgSvcSid: string | undefined = undefined;

  if (waConfig?.phone_number) {
    fromNum = String(waConfig.phone_number).replace(/^whatsapp:/i, '');
  }
  if (waConfig?.messaging_service_sid) {
    msgSvcSid = String(waConfig.messaging_service_sid).trim();
  }

  if (!fromNum) {
    fromNum = Deno.env.get('TWILIO_PHONE_NUMBER') || '';
  }
  if (!msgSvcSid) {
    msgSvcSid = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID') || undefined;
  }

  return { fromNum, msgSvcSid };
}

// ==================== DRIVE UPLOAD HELPER ====================

async function uploadToDrive(
  supabase: any,
  tenantId: string,
  fileUrl: string | null,
  folderType: 'budget' | 'receipt',
  expenseId: string,
  twilioSid?: string,
  twilioToken?: string,
): Promise<{ success: boolean; driveUrl?: string }> {
  if (!fileUrl) return { success: false };

  try {
    // Check if Drive is configured
    let driveSettings: any = null;
    const { data: existingSettings } = await supabase
      .from('tenant_drive_settings')
      .select('drive_root_folder_id')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    driveSettings = existingSettings;

    if (!driveSettings?.drive_root_folder_id) {
      // Auto-setup Drive if tenant has Google OAuth
      const { data: hasToken } = await supabase
        .from('google_calendar_tokens')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      if (hasToken) {
        console.log(`[EXPENSE] Auto-setting up Drive for tenant ${tenantId}`);
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const setupRes = await fetch(`${SUPABASE_URL}/functions/v1/google-drive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ action: 'setup_folder', tenant_id: tenantId, internal_caller: true }),
        });
        const setupResult = await setupRes.json();
        if (setupResult.drive_root_folder_id) {
          driveSettings = { drive_root_folder_id: setupResult.drive_root_folder_id };
        } else {
          console.log('Drive auto-setup failed:', setupResult.error || 'unknown');
          return { success: false };
        }
      } else {
        console.log('Drive not configured and no OAuth for tenant:', tenantId);
        return { success: false };
      }
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/google-drive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        action: 'upload_file',
        tenant_id: tenantId,
        internal_caller: true,
        file_url: fileUrl,
        folder_type: folderType,
        expense_id: expenseId,
        twilio_sid: twilioSid || Deno.env.get('TWILIO_ACCOUNT_SID'),
        twilio_token: twilioToken || Deno.env.get('TWILIO_AUTH_TOKEN'),
      }),
    });

    const result = await res.json();
    if (result.success) {
      return { success: true, driveUrl: result.drive_file_url };
    }
    console.log('Drive upload result:', JSON.stringify(result));
    return { success: false };
  } catch (e) {
    console.error('Drive upload error:', e);
    return { success: false };
  }
}

// ==================== CONSTANTS ====================

const BUDGET_KEYWORDS = /\b(presupuesto|cotizaci[oó]n|quote|propuesta|estimado|por\s*pagar|pendiente|a\s*autorizaci[oó]n|cotizar)\b/i;

interface ExpenseData {
  monto: number;
  descripcion: string;
  fecha: string;
  categoria: string;
  nombre_negocio: string;
  moneda: string;
  folio?: string;
  metodo_pago?: string;
}

interface ClassificationResult {
  type: 'expense' | 'budget' | 'ambiguous';
  data: ExpenseData[];
}

// ==================== CLASSIFICATION ====================

export function classifyExpenseType(userMessage: string): 'expense' | 'budget' | 'ambiguous' {
  const msg = userMessage.trim().toLowerCase();
  
  if (BUDGET_KEYWORDS.test(msg)) {
    return 'budget';
  }
  
  // Default: expense (paid)
  return 'expense';
}

// ==================== OCR + CLASSIFICATION ====================

export async function processExpenseDocument(
  mediaUrl: string | null,
  userMessage: string,
  apiKey: string,
  tenantId: string,
  context: Record<string, unknown>,
  supabase: any,
  twilioSid: string,
  twilioToken: string,
): Promise<{ reply: string; newState: string; newContext: Record<string, unknown> }> {
  const userId = context.user_id as string;
  const userName = context.user_name as string || 'Usuario';
  
  // Step 1: Determine type
  const classification = classifyExpenseType(userMessage);
  
  // Step 2: Extract data from image or text
  let expenses: ExpenseData[] = [];
  
  if (mediaUrl) {
    const extracted = await extractFromImage(mediaUrl, userMessage, apiKey, twilioSid, twilioToken);
    if (extracted.error) {
      return { reply: extracted.error, newState: 'employee_mode', newContext: context };
    }
    expenses = extracted.data;
  } else {
    // Try to parse from text
    const parsed = parseExpenseFromText(userMessage);
    if (!parsed) {
      return {
        reply: '📸 Envíame la *foto del comprobante* para extraer los datos automáticamente.\n\nO escríbelo así:\n_"$350 comida con cliente"_\n_"Presupuesto $5,000 diseño web para Juan"_',
        newState: 'employee_mode',
        newContext: context,
      };
    }
    expenses = [parsed];
  }
  
  if (expenses.length === 0) {
    return {
      reply: '❌ No pude detectar datos del gasto. Intenta con una imagen más clara o escríbelo manualmente.',
      newState: 'employee_mode',
      newContext: context,
    };
  }
  
  // Step 3: Route based on classification
  if (classification === 'budget') {
    return await handleBudgetCreation(expenses, tenantId, userId, userName, context, supabase, mediaUrl);
  }
  
  // Default: register as paid expense
  return await handlePaidExpense(expenses, tenantId, userId, context, supabase, mediaUrl);
}

// ==================== PAID EXPENSE (Flow A) ====================

async function handlePaidExpense(
  expenses: ExpenseData[],
  tenantId: string,
  userId: string,
  context: Record<string, unknown>,
  supabase: any,
  mediaUrl: string | null,
): Promise<{ reply: string; newState: string; newContext: Record<string, unknown> }> {
  const today = new Date().toISOString().split('T')[0];
  
  const rows = expenses.map(e => ({
    tenant_id: tenantId,
    user_id: userId,
    type: 'expense',
    amount: e.monto,
    description: e.descripcion || e.nombre_negocio || 'Gasto',
    vendor_name: e.nombre_negocio || null,
    concept: e.descripcion || null,
    category: e.categoria || 'Otro',
    expense_date: e.fecha || today,
    currency: e.moneda || 'MXN',
    status: 'paid',
    paid_at: new Date().toISOString(),
    approval_required: false,
    source: 'whatsapp',
    receipt_url: mediaUrl || null,
    folio: e.folio || null,
    payment_method: e.metodo_pago || null,
    ocr_data: e,
  }));
  
  const { error: insertError, data: insertedRows } = await supabase.from('expenses').insert(rows).select('id');
  
  if (insertError) {
    console.error('Expense insert error:', insertError);
    return {
      reply: `❌ No pude guardar el gasto. Intenta de nuevo.\n\n_Escribe *menu* para volver al inicio._`,
      newState: 'employee_mode',
      newContext: context,
    };
  }

  // Upload to Google Drive (async, non-blocking for UX)
  let driveMsg = '';
  if (mediaUrl && insertedRows?.length > 0) {
    const driveResult = await uploadToDrive(supabase, tenantId, mediaUrl, 'receipt', insertedRows[0].id);
    if (driveResult.success) {
      driveMsg = '\n📁 Documento guardado en Drive ✅';
    }
  }
  
  // Format reply
  if (expenses.length === 1) {
    const e = expenses[0];
    return {
      reply: `✅ *Gasto registrado como PAGADO:*\n\n• 🏪 ${e.nombre_negocio || 'Proveedor no identificado'}\n• 📝 ${e.descripcion || 'Sin descripción'}\n• 💰 *$${e.monto.toFixed(2)} ${e.moneda || 'MXN'}*\n• 📅 ${e.fecha || today}\n${e.folio ? `• 🔖 Folio: ${e.folio}` : ''}\n${e.metodo_pago ? `• 💳 ${e.metodo_pago}` : ''}\n• 📂 ${e.categoria || 'Otro'}${driveMsg}\n\n¿Deseas agregar categoría o notas? Si no, todo queda registrado ✅`,
      newState: 'employee_mode',
      newContext: context,
    };
  }

  const totalByCurrency: Record<string, number> = {};
  const lines = expenses.map((e, i) => {
    const cur = e.moneda || 'MXN';
    totalByCurrency[cur] = (totalByCurrency[cur] || 0) + e.monto;
    return `${i + 1}. $${e.monto.toFixed(2)} ${cur} — ${e.descripcion || e.nombre_negocio || 'Gasto'}`;
  });
  const totals = Object.entries(totalByCurrency).map(([cur, total]) => `$${total.toFixed(2)} ${cur}`).join(' + ');
  
  return {
    reply: `✅ *${expenses.length} gastos registrados como PAGADOS:*\n\n${lines.join('\n')}\n\n💰 *Total: ${totals}*${driveMsg}\n\n¿Todo correcto?`,
    newState: 'employee_mode',
    newContext: context,
  };
}

// ==================== BUDGET CREATION (Flow B) ====================

async function handleBudgetCreation(
  expenses: ExpenseData[],
  tenantId: string,
  userId: string,
  userName: string,
  context: Record<string, unknown>,
  supabase: any,
  mediaUrl: string | null,
): Promise<{ reply: string; newState: string; newContext: Record<string, unknown> }> {
  const today = new Date().toISOString().split('T')[0];
  
  // Insert as pending_approval
  const rows = expenses.map(e => ({
    tenant_id: tenantId,
    user_id: userId,
    type: 'budget',
    amount: e.monto,
    description: e.descripcion || e.nombre_negocio || 'Presupuesto',
    vendor_name: e.nombre_negocio || null,
    concept: e.descripcion || null,
    category: e.categoria || 'Otro',
    expense_date: e.fecha || today,
    currency: e.moneda || 'MXN',
    status: 'pending_approval',
    approval_required: true,
    source: 'whatsapp',
    receipt_url: mediaUrl || null,
    folio: e.folio || null,
    ocr_data: e,
  }));
  
  const { data: inserted, error: insertError } = await supabase
    .from('expenses')
    .insert(rows)
    .select('id, amount, currency, vendor_name, description');
  
  if (insertError) {
    console.error('Budget insert error:', insertError);
    return {
      reply: '❌ No pude registrar el presupuesto. Intenta de nuevo.',
      newState: 'employee_mode',
      newContext: context,
    };
  }
  
  // Upload budget document to Drive
  const budgetIds = inserted.map((r: any) => r.id);
  let driveMsg = '';
  if (mediaUrl && budgetIds.length > 0) {
    const driveResult = await uploadToDrive(supabase, tenantId, mediaUrl, 'budget', budgetIds[0]);
    if (driveResult.success) {
      driveMsg = '\n📁 Presupuesto guardado en Drive ✅';
    }
  }
  
  // Store pending budget IDs in context for approval flow
  const totalAmount = expenses.reduce((sum, e) => sum + e.monto, 0);
  const currency = expenses[0]?.moneda || 'MXN';
  const vendor = expenses[0]?.nombre_negocio || 'Proveedor';
  const concept = expenses[0]?.descripcion || 'Presupuesto';
  
  const summary = expenses.length === 1
    ? `• 🏪 ${vendor}\n• 📝 ${concept}\n• 💰 *$${totalAmount.toFixed(2)} ${currency}*`
    : expenses.map((e, i) => `${i+1}. $${e.monto.toFixed(2)} ${e.moneda || 'MXN'} — ${e.descripcion || e.nombre_negocio}`).join('\n');
  
  return {
    reply: `📋 *Presupuesto registrado por autorizar:*\n\n${summary}${driveMsg}\n\n¿Quién autoriza este pago? Puedes decirme:\n• El *nombre* del compañero\n• Su *número de WhatsApp*\n• O escribir *"yo"* si tú lo autorizas`,
    newState: 'budget_collect_approver',
    newContext: {
      ...context,
      pending_budget_ids: budgetIds,
      budget_total: totalAmount,
      budget_currency: currency,
      budget_vendor: vendor,
      budget_concept: concept,
    },
  };
}

// ==================== APPROVER COLLECTION ====================

export async function handleBudgetCollectApprover(
  msg: string,
  effectiveMessageBody: string,
  tenantId: string,
  context: Record<string, unknown>,
  supabase: any,
  conversationId: string,
): Promise<{ reply: string; newState: string; newContext: Record<string, unknown> }> {
  const budgetIds = (context.pending_budget_ids as string[]) || [];
  const userId = context.user_id as string;
  const userName = context.user_name as string || 'Un empleado';
  const budgetTotal = context.budget_total as number || 0;
  const budgetCurrency = context.budget_currency as string || 'MXN';
  const budgetVendor = context.budget_vendor as string || 'Proveedor';
  const budgetConcept = context.budget_concept as string || 'Presupuesto';
  
  if (budgetIds.length === 0) {
    return {
      reply: 'No encontré presupuestos pendientes de aprobación. ¿Deseas registrar uno nuevo?',
      newState: 'employee_mode',
      newContext: context,
    };
  }
  
  // Check if user says "yo" (self-approve)
  if (/^(yo|yo mismo|yo mism[oa]|auto|self)$/i.test(msg)) {
    // Self-approve: mark as approved immediately
    await supabase.from('expenses').update({
      status: 'approved',
      approver_user_id: userId,
      approved_at: new Date().toISOString(),
    }).in('id', budgetIds);
    
    const cleanContext = { ...context };
    delete cleanContext.pending_budget_ids;
    delete cleanContext.budget_total;
    delete cleanContext.budget_currency;
    delete cleanContext.budget_vendor;
    delete cleanContext.budget_concept;
    
    return {
      reply: `✅ *Presupuesto auto-aprobado.*\n\n• ${budgetVendor} — $${budgetTotal.toFixed(2)} ${budgetCurrency}\n\nAhora realiza el pago y envíame el *comprobante* para completar el registro 📸`,
      newState: 'employee_mode',
      newContext: cleanContext,
    };
  }
  
  // Search for approver by name in team
  const searchTerm = effectiveMessageBody.trim();
  let approver: { user_id: string; name: string; whatsapp_number: string | null; phone: string | null } | null = null;
  
  // Check if it's a phone number
  const phoneMatch = searchTerm.match(/\+?\d{10,15}/);
  if (phoneMatch) {
    const { data: profileByPhone } = await supabase
      .from('profiles')
      .select('user_id, name, whatsapp_number, phone')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .or(`whatsapp_number.eq.${phoneMatch[0]},phone.eq.${phoneMatch[0]}`)
      .maybeSingle();
    
    if (profileByPhone) {
      approver = profileByPhone;
    } else {
      // External approver (not in team) - store phone directly
      await supabase.from('expenses').update({
        status: 'pending_approval',
        approver_phone: phoneMatch[0],
      }).in('id', budgetIds);
      
      // Send approval request to external number — use tenant sender config
      const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
      const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

      if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
        const { fromNum, msgSvcSid } = await resolveTenantSender(supabase, tenantId);
        const approvalMsg = `📋 *Solicitud de autorización*\n\nDe: ${userName}\nProveedor: ${budgetVendor}\nConcepto: ${budgetConcept}\nMonto: *$${budgetTotal.toFixed(2)} ${budgetCurrency}*\n\nResponde:\n✅ *APROBAR*\n❌ *RECHAZAR* (opcional: motivo)`;
        await sendTwilioMessage(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, fromNum, phoneMatch[0], approvalMsg, msgSvcSid);
      }
      
      const cleanContext = { ...context };
      delete cleanContext.pending_budget_ids;
      delete cleanContext.budget_total;
      delete cleanContext.budget_currency;
      delete cleanContext.budget_vendor;
      delete cleanContext.budget_concept;
      
      return {
        reply: `📤 *Solicitud de aprobación enviada* al número ${phoneMatch[0]}.\n\nTe notificaré cuando responda. Mientras tanto, ¿te ayudo con algo más?`,
        newState: 'employee_mode',
        newContext: cleanContext,
      };
    }
  } else {
    // Search by name
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, name, whatsapp_number, phone')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .ilike('name', `%${searchTerm}%`)
      .limit(5);
    
    if (profiles && profiles.length === 1) {
      approver = profiles[0];
    } else if (profiles && profiles.length > 1) {
      const options = profiles.map((p: any, i: number) => `${i+1}. ${p.name}`).join('\n');
      return {
        reply: `Encontré varias coincidencias:\n\n${options}\n\n¿Cuál es el autorizador? Responde con el número.`,
        newState: 'budget_collect_approver',
        newContext: { ...context, approver_options: profiles },
      };
    } else {
      // Check if it's a number selection from previous options
      const optionIndex = parseInt(msg) - 1;
      const options = context.approver_options as any[];
      if (options && optionIndex >= 0 && optionIndex < options.length) {
        approver = options[optionIndex];
      } else {
        return {
          reply: `No encontré a "${searchTerm}" en el equipo. Intenta con otro nombre o proporciona el *número de WhatsApp* directamente.`,
          newState: 'budget_collect_approver',
          newContext: context,
        };
      }
    }
  }
  
  if (!approver) {
    return {
      reply: 'No pude identificar al autorizador. Escribe su *nombre* o *número de WhatsApp*.',
      newState: 'budget_collect_approver',
      newContext: context,
    };
  }
  
  // Update expenses with approver
  await supabase.from('expenses').update({
    approver_user_id: approver.user_id,
    approver_phone: approver.whatsapp_number || approver.phone || null,
  }).in('id', budgetIds);
  
  // Send approval request via WhatsApp — use tenant sender config
  const approverPhone = approver.whatsapp_number || approver.phone;
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  
  if (approverPhone && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    const { fromNum, msgSvcSid } = await resolveTenantSender(supabase, tenantId);
    const approvalMsg = `📋 *Solicitud de autorización*\n\nDe: ${userName}\nProveedor: ${budgetVendor}\nConcepto: ${budgetConcept}\nMonto: *$${budgetTotal.toFixed(2)} ${budgetCurrency}*\n\nResponde:\n✅ *APROBAR*\n❌ *RECHAZAR* (opcional: motivo)`;
    
    try {
      await sendTwilioMessage(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, fromNum, approverPhone, approvalMsg, msgSvcSid);
      
      // Log outbound message
      const { data: approverConv } = await supabase
        .from('whatsapp_conversations')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('contact_phone', approverPhone)
        .maybeSingle();
      
      if (approverConv) {
        await supabase.from('whatsapp_messages').insert({
          tenant_id: tenantId,
          conversation_id: approverConv.id,
          direction: 'out',
          body: `[Solicitud de aprobación] ${budgetVendor} - $${budgetTotal.toFixed(2)} ${budgetCurrency}`,
          status: 'sent',
          metadata: { type: 'approval_request', budget_ids: budgetIds },
        });
      }
    } catch (e) {
      console.error('Failed to send approval request:', e);
    }
  }
  
  // Clean up context
  const cleanContext = { ...context };
  delete cleanContext.pending_budget_ids;
  delete cleanContext.budget_total;
  delete cleanContext.budget_currency;
  delete cleanContext.budget_vendor;
  delete cleanContext.budget_concept;
  delete cleanContext.approver_options;
  
  return {
    reply: `📤 *Solicitud de aprobación enviada a ${approver.name}.*\n\n• ${budgetVendor} — $${budgetTotal.toFixed(2)} ${budgetCurrency}\n\nTe notificaré cuando ${approver.name} responda. ¿Te ayudo con algo más?`,
    newState: 'employee_mode',
    newContext: cleanContext,
  };
}

// ==================== APPROVAL RESPONSE HANDLER ====================

export async function checkAndHandleApprovalResponse(
  msg: string,
  userId: string,
  userName: string,
  tenantId: string,
  supabase: any,
): Promise<{ handled: boolean; reply: string }> {
  // Check if this message is an approval/rejection
  const isApproval = /^(aprobar|aprobado|si|sí|autorizo|autorizado|ok|va|dale|acepto|apruebo)/i.test(msg.trim());
  const isRejection = /^(rechazar|rechazado|no|negar|negado|denegar|denegado|rechazo)/i.test(msg.trim());
  
  if (!isApproval && !isRejection) {
    return { handled: false, reply: '' };
  }
  
  // Look for pending approvals assigned to this user
  const { data: pendingBudgets } = await supabase
    .from('expenses')
    .select('id, amount, currency, vendor_name, concept, description, user_id, tenant_id')
    .eq('tenant_id', tenantId)
    .eq('approver_user_id', userId)
    .eq('status', 'pending_approval')
    .eq('type', 'budget')
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (!pendingBudgets || pendingBudgets.length === 0) {
    return { handled: false, reply: '' };
  }
  
  // Process the most recent pending budget
  const budget = pendingBudgets[0];
  
  if (isApproval) {
    await supabase.from('expenses').update({
      status: 'approved',
      approved_at: new Date().toISOString(),
    }).eq('id', budget.id);
    
    // Notify requester
    const { data: requesterProfile } = await supabase
      .from('profiles')
      .select('name, whatsapp_number, phone')
      .eq('user_id', budget.user_id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    
    const requesterPhone = requesterProfile?.whatsapp_number || requesterProfile?.phone;
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
    const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');
    
    if (requesterPhone && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
      const notifyMsg = `✅ *Presupuesto aprobado por ${userName}*\n\n• ${budget.vendor_name || budget.description || 'Presupuesto'}\n• $${budget.amount} ${budget.currency || 'MXN'}\n\nRealiza el pago y envíame el *comprobante* para completar el registro 📸`;
      try {
        await sendTwilioMessage(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, requesterPhone, notifyMsg);
      } catch (e) {
        console.error('Failed to notify requester of approval:', e);
      }
    }
    
    return {
      handled: true,
      reply: `✅ *Presupuesto aprobado.*\n\n• ${budget.vendor_name || budget.description} — $${budget.amount} ${budget.currency || 'MXN'}\n\nSe notificó a ${requesterProfile?.name || 'el solicitante'} para que suba el comprobante de pago.${pendingBudgets.length > 1 ? `\n\n📌 Tienes ${pendingBudgets.length - 1} presupuesto(s) más pendiente(s) de aprobación.` : ''}`,
    };
  }
  
  if (isRejection) {
    // Extract rejection reason (anything after the rejection keyword)
    const reason = msg.replace(/^(rechazar|rechazado|no|negar|negado|denegar|denegado|rechazo)\s*/i, '').trim() || null;
    
    await supabase.from('expenses').update({
      status: 'rejected',
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
    }).eq('id', budget.id);
    
    // Notify requester
    const { data: requesterProfile } = await supabase
      .from('profiles')
      .select('name, whatsapp_number, phone')
      .eq('user_id', budget.user_id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    
    const requesterPhone = requesterProfile?.whatsapp_number || requesterProfile?.phone;
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
    const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');
    
    if (requesterPhone && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
      const notifyMsg = `❌ *Presupuesto rechazado por ${userName}*\n\n• ${budget.vendor_name || budget.description || 'Presupuesto'}\n• $${budget.amount} ${budget.currency || 'MXN'}${reason ? `\n\n💬 Motivo: ${reason}` : ''}\n\n¿Necesitas algo más?`;
      try {
        await sendTwilioMessage(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, requesterPhone, notifyMsg);
      } catch (e) {
        console.error('Failed to notify requester of rejection:', e);
      }
    }
    
    return {
      handled: true,
      reply: `❌ *Presupuesto rechazado.*\n\n• ${budget.vendor_name || budget.description} — $${budget.amount} ${budget.currency || 'MXN'}${reason ? `\n💬 Motivo: ${reason}` : ''}\n\nSe notificó a ${requesterProfile?.name || 'el solicitante'}.${pendingBudgets.length > 1 ? `\n\n📌 Tienes ${pendingBudgets.length - 1} presupuesto(s) más pendiente(s).` : ''}`,
    };
  }
  
  return { handled: false, reply: '' };
}

// ==================== RECEIPT UPLOAD FOR APPROVED BUDGETS ====================

export async function checkAndHandleReceiptUpload(
  mediaUrl: string,
  userId: string,
  tenantId: string,
  supabase: any,
  twilioSid: string,
  twilioToken: string,
  apiKey: string,
  userMessage: string,
): Promise<{ handled: boolean; reply: string }> {
  // Check if user has approved budgets waiting for a receipt
  const { data: approvedBudgets } = await supabase
    .from('expenses')
    .select('id, amount, currency, vendor_name, description, approver_user_id')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .eq('type', 'budget')
    .eq('status', 'approved')
    .is('paid_at', null)
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (!approvedBudgets || approvedBudgets.length === 0) {
    return { handled: false, reply: '' };
  }
  
  // User has approved budgets pending receipt — link this image as the receipt
  const budget = approvedBudgets[0];
  
  await supabase.from('expenses').update({
    status: 'paid',
    paid_at: new Date().toISOString(),
    receipt_url: mediaUrl,
  }).eq('id', budget.id);

  // Upload receipt to Google Drive
  let driveMsg = '';
  const driveResult = await uploadToDrive(supabase, tenantId, mediaUrl, 'receipt', budget.id);
  if (driveResult.success) {
    driveMsg = '\n📁 Comprobante guardado en Drive ✅';
  }
  
  // Notify approver (optional)
  if (budget.approver_user_id) {
    const { data: approverProfile } = await supabase
      .from('profiles')
      .select('name, whatsapp_number, phone')
      .eq('user_id', budget.approver_user_id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    
    const approverPhone = approverProfile?.whatsapp_number || approverProfile?.phone;
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
    const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');
    
    if (approverPhone && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
      try {
        await sendTwilioMessage(
          TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, approverPhone,
          `✅ *Comprobante recibido*\n\n${budget.vendor_name || budget.description} — $${budget.amount} ${budget.currency || 'MXN'}\n\nEl pago ha sido registrado como completado.`
        );
      } catch (e) {
        console.error('Failed to notify approver of receipt:', e);
      }
    }
  }
  
  return {
    handled: true,
    reply: `✅ *Comprobante vinculado al presupuesto aprobado:*\n\n• ${budget.vendor_name || budget.description}\n• $${budget.amount} ${budget.currency || 'MXN'}\n• Estado: *PAGADO* ✅${driveMsg}\n\n${approvedBudgets.length > 1 ? `📌 Tienes ${approvedBudgets.length - 1} presupuesto(s) más aprobado(s) pendiente(s) de comprobante.` : '¡Todo en orden! ¿Te ayudo con algo más?'}`,
  };
}

// ==================== IMAGE DATA EXTRACTION ====================

async function extractFromImage(
  mediaUrl: string,
  userMessage: string,
  apiKey: string,
  twilioSid: string,
  twilioToken: string,
): Promise<{ data: ExpenseData[]; error?: string }> {
  try {
    const basicAuth = btoa(`${twilioSid}:${twilioToken}`);
    const imgRes = await fetch(mediaUrl, {
      headers: { Authorization: `Basic ${basicAuth}` },
    });
    
    if (!imgRes.ok) {
      return { data: [], error: '❌ No pude descargar la imagen. Intenta enviarla de nuevo.' };
    }
    
    const imgBuffer = await imgRes.arrayBuffer();
    const bytes = new Uint8Array(imgBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64Image = btoa(binary);
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    
    const today = new Date().toISOString().split('T')[0];
    const userHint = userMessage ? `\nContexto adicional del usuario: "${userMessage}"` : '';
    
    const ocrResponse = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `Eres un sistema OCR inteligente que extrae datos financieros de imágenes. Puedes procesar comprobantes, tickets, facturas, recibos, cotizaciones, presupuestos y estados de cuenta.

REGLAS:
1. Si la imagen tiene UNA sola transacción, devuelve un objeto JSON directo.
2. Si tiene MÚLTIPLES transacciones, devuelve {"gastos":[...]}.
3. Ignora comisiones bancarias automáticas.
4. Si no puedes determinar la fecha, usa "${today}".

Campos por registro:
- monto: número decimal positivo
- descripcion: descripción clara
- fecha: formato YYYY-MM-DD
- categoria: Comida | Transporte | Hospedaje | Material | Servicio | Software | Combustible | Papelería | Suscripción | Otro
- nombre_negocio: nombre del proveedor/comercio
- moneda: "MXN" o "USD"
- folio: número de folio/referencia si existe (null si no)
- metodo_pago: método de pago si es visible (null si no)

Responde SOLO con JSON válido.`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Extrae los datos financieros de esta imagen.${userHint}` },
              { type: 'image_url', image_url: { url: `data:${contentType};base64,${base64Image}` } },
            ],
          },
        ],
      }),
    });
    
    if (!ocrResponse.ok) {
      console.error('OCR AI error:', ocrResponse.status);
      return { data: [], error: '❌ Error al procesar la imagen con IA. Intenta de nuevo.' };
    }
    
    const ocrResult = await ocrResponse.json();
    const rawText = ocrResult.choices?.[0]?.message?.content || '';
    
    let cleaned = rawText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }
    
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('OCR parse error:', rawText);
      return { data: [], error: '❌ No pude interpretar la imagen. Intenta con una foto más clara.' };
    }
    
    const expenses: any[] = parsed.gastos ? parsed.gastos : [parsed];
    const valid = expenses
      .filter(e => Number(e.monto) > 0)
      .map(e => ({
        monto: Number(e.monto),
        descripcion: e.descripcion || '',
        fecha: e.fecha || today,
        categoria: e.categoria || 'Otro',
        nombre_negocio: e.nombre_negocio || '',
        moneda: e.moneda || 'MXN',
        folio: e.folio || undefined,
        metodo_pago: e.metodo_pago || undefined,
      }));
    
    if (valid.length === 0) {
      return { data: [], error: '❌ No pude detectar montos válidos en la imagen.' };
    }
    
    return { data: valid };
  } catch (err) {
    console.error('Image extraction error:', err);
    return { data: [], error: '❌ Error al procesar la imagen. Intenta de nuevo.' };
  }
}

// ==================== TEXT PARSING ====================

function parseExpenseFromText(text: string): ExpenseData | null {
  const amountMatch = text.match(/\$?([\d,]+\.?\d*)/);
  if (!amountMatch) return null;
  
  const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  
  const description = text
    .replace(/\$?[\d,]+\.?\d*/, '')
    .replace(/\b(gasto|presupuesto|cotizaci[oó]n|pago|registr[ao]|agreg[ao])\b/gi, '')
    .trim() || 'Sin descripción';
  
  return {
    monto: amount,
    descripcion: description,
    fecha: new Date().toISOString().split('T')[0],
    categoria: 'Otro',
    nombre_negocio: '',
    moneda: /usd|d[oó]lar/i.test(text) ? 'USD' : 'MXN',
  };
}
