// Executes AI tool calls against the database and external services
import { searchDocuments, getDocumentDetail } from "./document-handler.ts";

export async function executeTool(
  toolName: string,
  args: any,
  tenantId: string,
  supabase: any,
  conversation: any,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<string> {
  const userId = conversation.bot_context?.user_id;
  const contactPhone = conversation.contact_phone;

  if (toolName === 'schedule_appointment') {
    return await executeScheduleAppointment(args, tenantId, supabase, userId, contactPhone, supabaseUrl, serviceRoleKey);
  }

  if (toolName === 'check_availability') {
    return await executeCheckAvailability(args, tenantId, supabase, supabaseUrl, serviceRoleKey);
  }

  if (toolName === 'create_reminder') {
    return await executeCreateReminder(args, tenantId, supabase, userId);
  }

  if (toolName === 'get_today_agenda') {
    return await executeGetTodayAgenda(tenantId, supabase, userId, args);
  }

  if (toolName === 'get_pending_expenses') {
    return await executeGetPendingExpenses(supabase, userId, args);
  }

  if (toolName === 'get_pending_approvals') {
    return await executeGetPendingApprovals(supabase, userId, tenantId);
  }

  if (toolName === 'save_bot_instruction') {
    return await executeSaveBotInstruction(args, tenantId, supabase, conversation);
  }

  if (toolName === 'list_bot_instructions') {
    return await executeListBotInstructions(tenantId, supabase);
  }

  if (toolName === 'delete_bot_instruction') {
    return await executeDeleteBotInstruction(args, tenantId, supabase, conversation);
  }

  if (toolName === 'cancel_appointment') {
    return await executeCancelAppointment(args, tenantId, supabase, userId, supabaseUrl, serviceRoleKey);
  }

  if (toolName === 'reschedule_appointment') {
    return await executeRescheduleAppointment(args, tenantId, supabase, userId, supabaseUrl, serviceRoleKey);
  }

  if (toolName === 'send_whatsapp_message') {
    return await executeSendWhatsAppMessage(args, tenantId, supabase, conversation, supabaseUrl, serviceRoleKey);
  }

  if (toolName === 'search_web') {
    return await executeSearchWeb(args, supabaseUrl, serviceRoleKey);
  }

  // ──── Google Calendar tools ────
  if (toolName === 'gcal_list_events' || toolName === 'gcal_create_event' || toolName === 'gcal_update_event' || toolName === 'gcal_delete_event') {
    return await executeGoogleCalendarTool(toolName, args, tenantId, supabase, userId, supabaseUrl, serviceRoleKey);
  }

  // ──── Platform data tools ────
  if (toolName === 'manage_contacts') {
    return await executeManageContacts(args, tenantId, supabase);
  }

  if (toolName === 'manage_knowledge') {
    return await executeManageKnowledge(args, tenantId, supabase, conversation);
  }

  if (toolName === 'manage_expenses') {
    return await executeManageExpenses(args, tenantId, supabase, userId);
  }

  if (toolName === 'get_team_members') {
    return await executeGetTeamMembers(args, tenantId, supabase);
  }

  if (toolName === 'get_dashboard_metrics') {
    return await executeGetDashboardMetrics(tenantId, supabase);
  }

  // ──── Document & Drive tools ────
  if (toolName === 'search_documents') {
    return await searchDocuments(supabase, tenantId, args);
  }

  if (toolName === 'get_document_detail') {
    return await getDocumentDetail(supabase, tenantId, args.document_id);
  }

  if (toolName === 'manage_drive_folders') {
    return await executeManageDriveFolders(args, tenantId, supabaseUrl, serviceRoleKey);
  }

  if (toolName === 'get_document_alerts') {
    return await executeGetDocumentAlerts(args, tenantId, supabase);
  }

  return JSON.stringify({ error: 'Unknown tool' });
}

// ==================== Individual tool implementations ====================

async function executeScheduleAppointment(
  args: any,
  tenantId: string,
  supabase: any,
  userId: string | null,
  contactPhone: string | null,
  supabaseUrl?: string,
  serviceRoleKey?: string,
): Promise<string> {
  const { contact_name, contact_phone: cPhone, contact_email, date, time, service_type, employee_name, notes } = args;

  // Get tenant timezone
  const { data: tenantData } = await supabase
    .from('tenants')
    .select('timezone')
    .eq('id', tenantId)
    .single();
  const tz = tenantData?.timezone || 'America/Mexico_City';

  // Find employee if specified
  let employeeId: string | null = null;
  if (employee_name) {
    const { data: emp } = await supabase
      .from('profiles')
      .select('user_id, name')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .ilike('name', `%${employee_name}%`)
      .limit(1)
      .maybeSingle();
    if (emp) employeeId = emp.user_id;
  }

  // Convert local time to UTC using tenant timezone
  const startAt = parseLocalToUTC(`${date}T${time}:00`, tz);
  const endAt = new Date(startAt);
  endAt.setMinutes(endAt.getMinutes() + 30);

  // Validate: no past dates
  if (startAt.getTime() < Date.now() - 60000) {
    return JSON.stringify({ error: 'No se puede agendar una cita en el pasado. Indica una fecha y hora futura.' });
  }

  // Validate: end > start
  if (endAt <= startAt) {
    return JSON.stringify({ error: 'La hora de fin debe ser posterior a la hora de inicio.' });
  }

  // Build idempotency key
  const assignedUser = employeeId || userId || 'unassigned';
  const idempotencyKey = `${tenantId}:${contact_name}:${startAt.toISOString()}:${service_type || 'General'}:${assignedUser}`;

  // Idempotency: check for duplicate by key or matching data
  const { data: existingByKey } = await supabase
    .from('appointments')
    .select('id, calendar_sync_status, calendar_event_id')
    .eq('idempotency_key', idempotencyKey)
    .neq('status', 'cancelled')
    .maybeSingle();

  if (existingByKey) {
    return JSON.stringify({
      success: true,
      appointment_id: existingByKey.id,
      duplicate: true,
      synced: existingByKey.calendar_sync_status === 'SYNCED',
      message: 'Ya existe una cita con los mismos datos.',
    });
  }

  const { data: existing } = await supabase
    .from('appointments')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('contact_name', contact_name)
    .eq('start_at', startAt.toISOString())
    .neq('status', 'cancelled')
    .maybeSingle();

  if (existing) {
    return JSON.stringify({
      success: true,
      appointment_id: existing.id,
      duplicate: true,
      message: 'Ya existe una cita con los mismos datos.',
    });
  }

  const { data: apt, error } = await supabase
    .from('appointments')
    .insert({
      tenant_id: tenantId,
      contact_name,
      contact_phone: cPhone || contactPhone || null,
      contact_email: contact_email || null,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      service_type: service_type || 'General',
      user_id: employeeId || userId || null,
      notes: notes || null,
      source: 'whatsapp',
      status: 'scheduled',
      calendar_sync_status: 'PENDING_SYNC',
      idempotency_key: idempotencyKey,
    })
    .select('id, start_at, end_at, contact_name, user_id')
    .single();

  if (error) return JSON.stringify({ error: error.message });

  // Trigger calendar sync asynchronously
  let calendarSynced = false;
  if (supabaseUrl && serviceRoleKey && apt.user_id) {
    try {
      const syncRes = await fetch(`${supabaseUrl}/functions/v1/calendar-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ action: 'sync_appointment', appointment_id: apt.id }),
      });
      const syncResult = await syncRes.json();
      calendarSynced = syncResult.success === true;
      if (!calendarSynced) {
        console.log(`Calendar sync pending for ${apt.id}: ${syncResult.error || 'unknown'}`);
      }
    } catch (syncErr) {
      console.error('Calendar sync trigger error:', syncErr);
    }
  }

  // === SEND CONFIRMATION TO CONTACT & SCHEDULE REMINDERS ===
  const finalContactPhone = cPhone || contactPhone || null;
  const { data: tenantInfo } = await supabase.from('tenants').select('name').eq('id', tenantId).single();
  const companyName = tenantInfo?.name || 'Nuestro negocio';
  const dateDisplay = startAt.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
  const timeDisplay = startAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: tz });

  // 1. Send immediate confirmation to the contact
  if (finalContactPhone && supabaseUrl && serviceRoleKey) {
    const confirmMsg = `📅 *Confirmación de cita — ${companyName}*\n\nHola *${contact_name}*, te confirmo tu cita:\n\n📆 ${dateDisplay}\n⏰ ${timeDisplay}\n${service_type ? `📋 ${service_type}\n` : ''}${employee_name ? `👤 Con: ${employee_name}\n` : ''}${notes ? `📝 ${notes}\n` : ''}\n¿Puedes confirmar tu asistencia? Responde:\n✅ *CONFIRMO* — Asistiré\n❌ *CANCELO* — No podré asistir\n\n_Mensaje automático de ${companyName}_`;

    try {
      const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!;
      const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')!;
      const { sendTwilioMessage } = await import('./helpers.ts');

      // Get tenant from number
      const { data: tData } = await supabase.from('tenants').select('whatsapp_config').eq('id', tenantId).single();
      const waConfig = tData?.whatsapp_config as Record<string, any> | null;
      const fromNum = waConfig?.phone_number ? String(waConfig.phone_number).replace(/^whatsapp:/i, '') : Deno.env.get('TWILIO_PHONE_NUMBER') || '';
      const msgSvcSid = waConfig?.messaging_service_sid ? String(waConfig.messaging_service_sid).trim() : Deno.env.get('TWILIO_MESSAGING_SERVICE_SID') || undefined;

      await sendTwilioMessage(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, fromNum, finalContactPhone, confirmMsg, msgSvcSid);
      console.log(`[APPT] Confirmation sent to ${finalContactPhone}`);

      // Store confirmation notification record
      await supabase.from('appointment_notifications').insert({
        appointment_id: apt.id,
        tenant_id: tenantId,
        target_phone: finalContactPhone,
        notification_type: 'confirmation',
        status: 'sent',
        scheduled_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
        message_body: confirmMsg,
      });
    } catch (confirmErr) {
      console.error('[APPT] Confirmation send error:', confirmErr);
    }
  }

  // 2. Schedule reminders: 1h and 15min before for BOTH parties
  const reminder1h = new Date(startAt.getTime() - 60 * 60 * 1000);
  const reminder15m = new Date(startAt.getTime() - 15 * 60 * 1000);
  const now = new Date();

  const notificationsToInsert: any[] = [];

  // Reminders for the contact (external)
  if (finalContactPhone) {
    if (reminder1h > now) {
      notificationsToInsert.push({
        appointment_id: apt.id, tenant_id: tenantId,
        target_phone: finalContactPhone,
        notification_type: 'reminder_1h', status: 'pending',
        scheduled_at: reminder1h.toISOString(),
        message_body: `⏰ *Recordatorio de cita — ${companyName}*\n\nHola *${contact_name}*, tu cita es en *1 hora*:\n\n📆 ${dateDisplay}\n⏰ ${timeDisplay}\n${service_type ? `📋 ${service_type}\n` : ''}\n¡Te esperamos! 😊`,
      });
    }
    if (reminder15m > now) {
      notificationsToInsert.push({
        appointment_id: apt.id, tenant_id: tenantId,
        target_phone: finalContactPhone,
        notification_type: 'reminder_15m', status: 'pending',
        scheduled_at: reminder15m.toISOString(),
        message_body: `⏰ *¡Tu cita es en 15 minutos!*\n\nHola *${contact_name}*, tu cita con *${companyName}* es en 15 minutos.\n\n⏰ ${timeDisplay}\n${employee_name ? `👤 Con: ${employee_name}\n` : ''}\n¡Ya casi! 🙌`,
      });
    }
  }

  // Reminders for the creator/employee (internal user)
  const creatorUserId = employeeId || userId || null;
  if (creatorUserId) {
    if (reminder1h > now) {
      notificationsToInsert.push({
        appointment_id: apt.id, tenant_id: tenantId,
        target_user_id: creatorUserId,
        notification_type: 'reminder_1h', status: 'pending',
        scheduled_at: reminder1h.toISOString(),
        message_body: `⏰ *Recordatorio*: Tu cita con *${contact_name}* es en *1 hora* (${timeDisplay}).${service_type ? `\n📋 ${service_type}` : ''}`,
      });
    }
    if (reminder15m > now) {
      notificationsToInsert.push({
        appointment_id: apt.id, tenant_id: tenantId,
        target_user_id: creatorUserId,
        notification_type: 'reminder_15m', status: 'pending',
        scheduled_at: reminder15m.toISOString(),
        message_body: `⏰ *¡15 minutos!* Tu cita con *${contact_name}* es a las ${timeDisplay}. ¡Prepárate! 💪`,
      });
    }
  }

  if (notificationsToInsert.length > 0) {
    await supabase.from('appointment_notifications').insert(notificationsToInsert);
    console.log(`[APPT] Scheduled ${notificationsToInsert.length} reminder notifications for appointment ${apt.id}`);
  }

  const response: any = {
    success: true,
    appointment_id: apt.id,
    contact_name: apt.contact_name,
    date: dateDisplay,
    time: timeDisplay,
    employee: employee_name || 'sin asignar',
    confirmation_sent: !!finalContactPhone,
    reminders_scheduled: notificationsToInsert.length,
  };

  if (calendarSynced) {
    response.calendar_synced = true;
    response.message = 'Cita agendada y sincronizada con Google Calendar.' + (finalContactPhone ? ' Se envió confirmación al contacto.' : '');
  } else {
    response.calendar_synced = false;
    response.message = 'Cita agendada correctamente.' + (finalContactPhone ? ' Se envió confirmación al contacto.' : '') + ' La sincronización con el calendario se completará en breve.';
  }

  return JSON.stringify(response);
}

async function executeCheckAvailability(
  args: any,
  tenantId: string,
  supabase: any,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<string> {
  const { date, employee_name } = args;
  let employeeId: string | null = null;
  if (employee_name) {
    const { data: emp } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .ilike('name', `%${employee_name}%`)
      .limit(1)
      .maybeSingle();
    if (emp) employeeId = emp.user_id;
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/voice-scheduling`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ action: 'check_availability', data: { tenant_id: tenantId, date, employee_id: employeeId } }),
    });
    const result = await res.json();
    return JSON.stringify(result);
  } catch {
    return JSON.stringify({ error: 'No se pudo verificar disponibilidad' });
  }
}

async function executeCreateReminder(
  args: any,
  tenantId: string,
  supabase: any,
  userId: string | null,
): Promise<string> {
  const { message, remind_at } = args;
  if (!userId) return JSON.stringify({ error: 'No se pudo identificar al usuario' });

  const { data: tenantData } = await supabase
    .from('tenants')
    .select('timezone')
    .eq('id', tenantId)
    .single();
  const tz = tenantData?.timezone || 'America/Mexico_City';

  // Parse remind_at with timezone awareness
  let remindDate: Date;
  if (/[+-]\d{2}:\d{2}$/.test(remind_at) || remind_at.endsWith('Z')) {
    remindDate = new Date(remind_at);
  } else {
    remindDate = parseLocalToUTC(remind_at, tz);
  }

  if (isNaN(remindDate.getTime())) {
    return JSON.stringify({ error: `No pude interpretar la fecha/hora: ${remind_at}. Usa formato YYYY-MM-DDTHH:MM:SS` });
  }

  if (remindDate.getTime() < Date.now() - 60000) {
    return JSON.stringify({ error: 'La fecha/hora del recordatorio ya pasó. Indica una fecha futura.' });
  }

  const { data: inserted, error } = await supabase.from('reminders').insert({
    tenant_id: tenantId,
    user_id: userId,
    message,
    remind_at: remindDate.toISOString(),
    status: 'pending',
    source: 'whatsapp',
    timezone: tz,
  }).select('id').single();

  if (error) return JSON.stringify({ error: error.message });

  return JSON.stringify({
    success: true,
    reminder_id: inserted.id,
    message,
    remind_at: remindDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: tz }),
    date: remindDate.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }),
  });
}

async function executeGetTodayAgenda(
  tenantId: string,
  supabase: any,
  userId: string | null,
  args?: any,
): Promise<string> {
  // Support querying any date, not just today
  const queryDate = args?.date || new Date().toISOString().split('T')[0];

  // Get tenant timezone for display
  const { data: tenantData } = await supabase
    .from('tenants')
    .select('timezone')
    .eq('id', tenantId)
    .single();
  const tz = tenantData?.timezone || 'America/Mexico_City';
  const { startIsoUtc, endIsoUtc } = getUtcDayRangeFromLocalDate(queryDate, tz);

  let query = supabase
    .from('appointments')
    .select('start_at, end_at, contact_name, service_type, status, calendar_sync_status, calendar_event_id')
    .eq('tenant_id', tenantId)
    .gte('start_at', startIsoUtc)
    .lte('start_at', endIsoUtc)
    .neq('status', 'cancelled')
    .is('deleted_at', null)
    .order('start_at');

  if (userId) query = query.eq('user_id', userId);
  const { data: apts } = await query;

  return JSON.stringify({
    date: queryDate,
    date_display: new Date(`${queryDate}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }),
    appointments: (apts || []).map((a: any) => ({
      time: new Date(a.start_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: tz }),
      end_time: new Date(a.end_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: tz }),
      contact: a.contact_name,
      service: a.service_type || 'General',
      status: a.status,
      calendar_synced: a.calendar_sync_status === 'SYNCED',
      has_calendar_event: !!a.calendar_event_id,
    })),
    count: (apts || []).length,
  });
}

async function executeGetPendingExpenses(
  supabase: any,
  userId: string | null,
  args?: any,
): Promise<string> {
  if (!userId) return JSON.stringify({ expenses: [], count: 0 });

  const filter = args?.filter || 'all';
  let query = supabase
    .from('expenses')
    .select('amount, description, category, expense_date, status, type, vendor_name, currency, approval_required, paid_at')
    .eq('user_id', userId)
    .order('expense_date', { ascending: false })
    .limit(15);

  if (filter === 'pending') {
    query = query.eq('status', 'pending_approval');
  } else if (filter === 'approved_no_receipt') {
    query = query.eq('status', 'approved').is('paid_at', null);
  } else if (filter === 'budgets') {
    query = query.eq('type', 'budget');
  } else {
    // 'all' - recent items
    query = query.in('status', ['pending', 'pending_approval', 'approved', 'paid']);
  }

  const { data: expenses } = await query;

  return JSON.stringify({
    expenses: (expenses || []).map((e: any) => ({
      amount: e.amount,
      currency: e.currency || 'MXN',
      description: e.description,
      vendor: e.vendor_name,
      category: e.category,
      date: e.expense_date,
      type: e.type || 'expense',
      status: e.status,
      paid: !!e.paid_at,
    })),
    count: (expenses || []).length,
    filter,
  });
}

async function executeGetPendingApprovals(
  supabase: any,
  userId: string | null,
  tenantId: string,
): Promise<string> {
  if (!userId) return JSON.stringify({ approvals: [], count: 0 });

  const { data: pending } = await supabase
    .from('expenses')
    .select('id, amount, currency, vendor_name, description, concept, user_id, created_at')
    .eq('tenant_id', tenantId)
    .eq('approver_user_id', userId)
    .eq('status', 'pending_approval')
    .eq('type', 'budget')
    .order('created_at', { ascending: false })
    .limit(10);

  // Get requester names
  const approvals = [];
  for (const p of (pending || [])) {
    const { data: requester } = await supabase
      .from('profiles')
      .select('name')
      .eq('user_id', p.user_id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    approvals.push({
      id: p.id,
      amount: p.amount,
      currency: p.currency || 'MXN',
      vendor: p.vendor_name,
      description: p.description || p.concept,
      requester: requester?.name || 'Desconocido',
      created: p.created_at,
    });
  }

  return JSON.stringify({
    approvals,
    count: approvals.length,
    message: approvals.length > 0
      ? `Tienes ${approvals.length} presupuesto(s) pendiente(s) de aprobación. Responde APROBAR o RECHAZAR para procesarlos.`
      : 'No tienes presupuestos pendientes de aprobación.',
  });
}

async function executeSaveBotInstruction(
  args: any,
  tenantId: string,
  supabase: any,
  conversation: any,
): Promise<string> {
  const { title, instruction, correction_type } = args;
  const userId = conversation.bot_context?.user_id;

  let isAuthorized = false;
  if (userId) {
    const { data: role } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .in('role', ['super_admin', 'owner', 'admin'])
      .maybeSingle();
    isAuthorized = !!role;
  }

  if (!isAuthorized) {
    return JSON.stringify({ error: 'No tienes permisos para reprogramar el bot. Solo administradores pueden hacerlo.' });
  }

  const tagMap: Record<string, string[]> = {
    correction: ['bot-correction', 'auto-training', 'whatsapp'],
    new_rule: ['bot-rule', 'auto-training', 'whatsapp'],
    knowledge: ['bot-knowledge', 'auto-training', 'whatsapp'],
    personality: ['bot-personality', 'auto-training', 'whatsapp'],
  };

  const { data: saved, error } = await supabase
    .from('knowledge_items')
    .insert({
      tenant_id: tenantId,
      title: `[Auto-entrenamiento] ${title}`,
      content: `TIPO: ${correction_type}\nINSTRUCCIÓN: ${instruction}\n\nRegistrado por: ${conversation.bot_context?.user_name || 'desconocido'}\nFecha: ${new Date().toISOString()}`,
      category: 'Entrenamiento IA',
      tags: tagMap[correction_type] || ['auto-training', 'whatsapp'],
      visibility: 'internal',
      author_id: userId,
      active: true,
    })
    .select('id, title')
    .single();

  if (error) return JSON.stringify({ error: error.message });

  await supabase.from('audit_events').insert({
    tenant_id: tenantId,
    event_type: 'bot_self_reprogram',
    actor_id: userId,
    resource_type: 'knowledge_items',
    resource_id: saved.id,
    payload: { title, correction_type, instruction: instruction.substring(0, 200) },
  });

  return JSON.stringify({
    success: true,
    id: saved.id,
    title: saved.title,
    type: correction_type,
    message: 'Instrucción guardada. El cambio se aplicará inmediatamente en futuras conversaciones.',
  });
}

async function executeListBotInstructions(
  tenantId: string,
  supabase: any,
): Promise<string> {
  const { data: instructions } = await supabase
    .from('knowledge_items')
    .select('id, title, content, tags, created_at')
    .eq('tenant_id', tenantId)
    .eq('category', 'Entrenamiento IA')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(20);

  return JSON.stringify({
    instructions: (instructions || []).map((i: any) => ({
      id: i.id,
      title: i.title,
      preview: i.content?.substring(0, 150),
      tags: i.tags,
      created: i.created_at,
    })),
    count: (instructions || []).length,
  });
}

async function executeDeleteBotInstruction(
  args: any,
  tenantId: string,
  supabase: any,
  conversation: any,
): Promise<string> {
  const { search_term } = args;
  const userId = conversation.bot_context?.user_id;

  let isAuthorized = false;
  if (userId) {
    const { data: role } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .in('role', ['super_admin', 'owner', 'admin'])
      .maybeSingle();
    isAuthorized = !!role;
  }

  if (!isAuthorized) {
    return JSON.stringify({ error: 'No tienes permisos para eliminar instrucciones del bot.' });
  }

  const { data: matches } = await supabase
    .from('knowledge_items')
    .select('id, title')
    .eq('tenant_id', tenantId)
    .eq('category', 'Entrenamiento IA')
    .eq('active', true)
    .or(`title.ilike.%${search_term}%,content.ilike.%${search_term}%`)
    .limit(5);

  if (!matches || matches.length === 0) {
    return JSON.stringify({ error: `No encontré instrucciones que coincidan con "${search_term}"` });
  }

  const ids = matches.map((m: any) => m.id);
  await supabase
    .from('knowledge_items')
    .update({ active: false, deleted_at: new Date().toISOString() })
    .in('id', ids);

  return JSON.stringify({
    success: true,
    deleted_count: matches.length,
    deleted: matches.map((m: any) => m.title),
    message: `Se eliminaron ${matches.length} instrucción(es) del bot.`,
  });
}

async function executeCancelAppointment(
  args: any,
  tenantId: string,
  supabase: any,
  userId: string | null,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<string> {
  const { contact_name, date, cancel_all } = args;

  if (!contact_name && !date) {
    return JSON.stringify({ error: 'Necesito al menos un nombre de contacto o una fecha para buscar las citas a cancelar.' });
  }

  // Get tenant timezone
  const { data: tenantData } = await supabase
    .from('tenants')
    .select('timezone')
    .eq('id', tenantId)
    .single();
  const tz = tenantData?.timezone || 'America/Mexico_City';

  // Build base query for matching appointments
  const buildAppointmentsQuery = () => {
    let query = supabase
      .from('appointments')
      .select('id, contact_name, start_at, end_at, service_type, status, user_id, calendar_event_id')
      .eq('tenant_id', tenantId)
      .neq('status', 'cancelled')
      .is('deleted_at', null)
      .order('start_at', { ascending: true });

    if (contact_name) {
      query = query.ilike('contact_name', `%${contact_name}%`);
    }

    if (date) {
      const { startIsoUtc, endIsoUtc } = getUtcDayRangeFromLocalDate(date, tz);
      query = query
        .gte('start_at', startIsoUtc)
        .lte('start_at', endIsoUtc);
    }

    // If filtering by user
    if (userId && !contact_name) {
      query = query.eq('user_id', userId);
    }

    return query;
  };

  let appointments: any[] = [];

  if (cancel_all) {
    // Fetch ALL matches in pages to avoid silent truncation from .limit()
    const pageSize = 200;
    let from = 0;

    while (true) {
      const { data: page, error: pageErr } = await buildAppointmentsQuery().range(from, from + pageSize - 1);
      if (pageErr) return JSON.stringify({ error: pageErr.message });

      const rows = page || [];
      appointments.push(...rows);

      if (rows.length < pageSize) break;
      from += pageSize;

      // Safety cap to prevent infinite loops in case of unexpected API behavior
      if (from > 5000) break;
    }
  } else {
    const { data, error: searchErr } = await buildAppointmentsQuery().limit(20);
    if (searchErr) return JSON.stringify({ error: searchErr.message });
    appointments = data || [];
  }

  if (!appointments || appointments.length === 0) {
    return JSON.stringify({
      error: `No encontré citas ${date ? `para el ${date} ` : ''}${contact_name ? `con "${contact_name}"` : ''}. Verifica los datos.`,
    });
  }

  // If multiple and not cancel_all, ask for confirmation
  if (appointments.length > 1 && !cancel_all) {
    return JSON.stringify({
      multiple: true,
      count: appointments.length,
      appointments: appointments.map((a: any) => ({
        id: a.id,
        contact: a.contact_name,
        date: new Date(a.start_at).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }),
        time: new Date(a.start_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: tz }),
        service: a.service_type || 'General',
      })),
      message: `Encontré ${appointments.length} citas. ¿Quieres cancelar todas? Dime "sí, cancela todas" o indica cuál específicamente.`,
    });
  }

  // Cancel all matching or the single one
  const toCancel = cancel_all ? appointments : [appointments[0]];
  const cancelled = [];

  for (const apt of toCancel) {
    const { error: updateErr } = await supabase
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', apt.id);

    if (updateErr) continue;

    // If synced to Google Calendar, delete the event
    if (apt.calendar_event_id && apt.user_id && supabaseUrl && serviceRoleKey) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/calendar-sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ action: 'cancel_event', appointment_id: apt.id }),
        });
      } catch (syncErr) {
        console.error('Calendar delete sync error:', syncErr);
      }
    }

    cancelled.push({
      contact_name: apt.contact_name,
      date: new Date(apt.start_at).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }),
      time: new Date(apt.start_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: tz }),
    });
  }

  if (cancelled.length === 1) {
    return JSON.stringify({
      success: true,
      appointment_id: toCancel[0].id,
      ...cancelled[0],
      message: `Cita con ${cancelled[0].contact_name} cancelada exitosamente.`,
    });
  }

  return JSON.stringify({
    success: true,
    cancelled_count: cancelled.length,
    cancelled,
    message: `Se cancelaron ${cancelled.length} cita(s) exitosamente.`,
  });
}

async function executeRescheduleAppointment(
  args: any,
  tenantId: string,
  supabase: any,
  userId: string | null,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<string> {
  const { contact_name, current_date, new_date, new_time } = args;

  // Get tenant timezone
  const { data: tenantData } = await supabase
    .from('tenants')
    .select('timezone')
    .eq('id', tenantId)
    .single();
  const tz = tenantData?.timezone || 'America/Mexico_City';

  // Search for matching appointments
  let query = supabase
    .from('appointments')
    .select('id, contact_name, start_at, end_at, service_type, status, user_id, calendar_event_id')
    .eq('tenant_id', tenantId)
    .neq('status', 'cancelled')
    .is('deleted_at', null)
    .ilike('contact_name', `%${contact_name}%`)
    .order('start_at', { ascending: true });

  if (current_date) {
    const { startIsoUtc, endIsoUtc } = getUtcDayRangeFromLocalDate(current_date, tz);
    query = query
      .gte('start_at', startIsoUtc)
      .lte('start_at', endIsoUtc);
  }

  const { data: appointments, error: searchErr } = await query.limit(5);

  if (searchErr) return JSON.stringify({ error: searchErr.message });

  if (!appointments || appointments.length === 0) {
    return JSON.stringify({
      error: `No encontré citas ${current_date ? `para el ${current_date} ` : ''}con "${contact_name}". Verifica el nombre o la fecha.`,
    });
  }

  if (appointments.length > 1 && !current_date) {
    return JSON.stringify({
      multiple: true,
      count: appointments.length,
      appointments: appointments.map((a: any) => ({
        id: a.id,
        contact: a.contact_name,
        date: new Date(a.start_at).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }),
        time: new Date(a.start_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: tz }),
        service: a.service_type || 'General',
      })),
      message: `Encontré ${appointments.length} citas con "${contact_name}". ¿Cuál quieres reprogramar? Indica la fecha actual para precisar.`,
    });
  }

  const apt = appointments[0];

  // Parse new date/time to UTC
  const newStartAt = parseLocalToUTC(`${new_date}T${new_time}:00`, tz);
  const newEndAt = new Date(newStartAt);
  newEndAt.setMinutes(newEndAt.getMinutes() + 30);

  // Validate: no past dates
  if (newStartAt.getTime() < Date.now() - 60000) {
    return JSON.stringify({ error: 'No se puede reprogramar a una fecha/hora en el pasado.' });
  }

  // Update the appointment - keep calendar_event_id for update
  const { error: updateErr } = await supabase
    .from('appointments')
    .update({
      start_at: newStartAt.toISOString(),
      end_at: newEndAt.toISOString(),
      status: 'scheduled',
    })
    .eq('id', apt.id);

  if (updateErr) return JSON.stringify({ error: updateErr.message });

  // Immediately sync to Google Calendar
  let calendarSynced = false;
  if (apt.calendar_event_id && apt.user_id && supabaseUrl && serviceRoleKey) {
    try {
      const syncRes = await fetch(`${supabaseUrl}/functions/v1/calendar-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ action: 'update_event', appointment_id: apt.id }),
      });
      const syncResult = await syncRes.json();
      calendarSynced = syncResult.success === true;
      if (calendarSynced) {
        await supabase
          .from('appointments')
          .update({ calendar_sync_status: 'SYNCED' })
          .eq('id', apt.id);
      } else {
        console.log(`Calendar update pending for ${apt.id}: ${syncResult.error || 'unknown'}`);
        await supabase
          .from('appointments')
          .update({ calendar_sync_status: 'PENDING_SYNC', calendar_sync_error: syncResult.error || null })
          .eq('id', apt.id);
      }
    } catch (syncErr) {
      console.error('Calendar update sync error:', syncErr);
      await supabase
        .from('appointments')
        .update({ calendar_sync_status: 'PENDING_SYNC' })
        .eq('id', apt.id);
    }
  } else if (!apt.calendar_event_id && apt.user_id && supabaseUrl && serviceRoleKey) {
    // No existing event — create one immediately
    try {
      const syncRes = await fetch(`${supabaseUrl}/functions/v1/calendar-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ action: 'sync_appointment', appointment_id: apt.id }),
      });
      const syncResult = await syncRes.json();
      calendarSynced = syncResult.success === true;
    } catch (syncErr) {
      console.error('Calendar sync trigger error:', syncErr);
    }
  }

  const response: any = {
    success: true,
    appointment_id: apt.id,
    contact_name: apt.contact_name,
    old_date: new Date(apt.start_at).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }),
    old_time: new Date(apt.start_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: tz }),
    new_date: newStartAt.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }),
    new_time: newStartAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: tz }),
    calendar_synced: calendarSynced,
    message: calendarSynced
      ? `Cita con ${apt.contact_name} reprogramada y calendario actualizado.`
      : `Cita con ${apt.contact_name} reprogramada. El calendario se actualizará en breve.`,
  };

  return JSON.stringify(response);
}

async function executeSendWhatsAppMessage(
  args: any,
  tenantId: string,
  supabase: any,
  conversation: any,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<string> {
  const userId = conversation.bot_context?.user_id;

  // Only authenticated employees can send messages
  if (!userId) {
    return JSON.stringify({ error: 'Debes estar autenticado como empleado para enviar mensajes.' });
  }

  const { recipient_name, recipient_phone, message } = args;
  if (!message) return JSON.stringify({ error: 'El mensaje no puede estar vacío.' });

  let targetPhone: string | null = recipient_phone || null;
  let targetName: string | null = recipient_name || null;

  // If no phone provided, search by name in profiles and contacts
  if (!targetPhone && targetName) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('name, whatsapp_number, phone')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .ilike('name', `%${targetName}%`)
      .limit(1)
      .maybeSingle();

    if (profile) {
      targetPhone = profile.whatsapp_number || profile.phone;
      targetName = profile.name;
    }

    if (!targetPhone) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('name, phone')
        .eq('tenant_id', tenantId)
        .ilike('name', `%${targetName}%`)
        .limit(1)
        .maybeSingle();

      if (contact) {
        targetPhone = contact.phone;
        targetName = contact.name;
      }
    }
  }

  if (!targetPhone) {
    return JSON.stringify({
      error: `No encontré el número de ${targetName || 'esa persona'}. Proporciona el número de teléfono directamente.`,
    });
  }

  // Resolve tenant WhatsApp sender config (same pattern as main bot flow)
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return JSON.stringify({ error: 'No se encontró configuración de WhatsApp/Twilio para enviar el mensaje.' });
  }

  // Use tenant's configured WhatsApp number to avoid 63007 sender-channel mismatch
  let fromNumber: string | null = null;
  let messagingServiceSid: string | undefined = undefined;

  const { data: tenantData } = await supabase
    .from('tenants')
    .select('whatsapp_config')
    .eq('id', tenantId)
    .single();

  const waConfig = tenantData?.whatsapp_config as Record<string, any> | null;
  if (waConfig?.phone_number) {
    fromNumber = String(waConfig.phone_number).replace(/^whatsapp:/i, '');
  }
  if (waConfig?.messaging_service_sid) {
    messagingServiceSid = String(waConfig.messaging_service_sid).trim();
  }

  // Fallback to global env vars
  if (!fromNumber) {
    fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER') || null;
  }
  if (!messagingServiceSid) {
    messagingServiceSid = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID') || undefined;
  }

  if (!fromNumber && !messagingServiceSid) {
    return JSON.stringify({ error: 'No se encontró número de WhatsApp configurado para enviar el mensaje.' });
  }

  try {
    const { sendTwilioMessage } = await import('./helpers.ts');
    const result = await sendTwilioMessage(
      TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN,
      fromNumber || '',
      targetPhone,
      message,
      messagingServiceSid,
    );

    if (result.sid) {
      // Log the outbound message
      const { data: recipientConv } = await supabase
        .from('whatsapp_conversations')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('contact_phone', targetPhone)
        .maybeSingle();

      if (recipientConv) {
        await supabase.from('whatsapp_messages').insert({
          tenant_id: tenantId,
          conversation_id: recipientConv.id,
          direction: 'out',
          body: message,
          status: 'sent',
          metadata: { sent_by: userId, sent_by_name: conversation.bot_context?.user_name || 'Empleado', via: 'bot_tool', message_sid: result.sid, from_number: fromNumber },
        });
      }

      return JSON.stringify({
        success: true,
        recipient: targetName || targetPhone,
        message_sid: result.sid,
        message: `Mensaje enviado exitosamente a ${targetName || targetPhone}.`,
      });
    }

    return JSON.stringify({ error: `Error al enviar: ${result.message || 'Error desconocido de Twilio'}` });
  } catch (err) {
    console.error('Send WhatsApp message error:', err);
    return JSON.stringify({ error: 'Error al enviar el mensaje. Intenta de nuevo.' });
  }
}

async function executeSearchWeb(
  args: any,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<string> {
  const { query, model_preference } = args;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/web-search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ query, model_preference: model_preference || 'gemini' }),
    });

    const result = await res.json();

    if (!res.ok || !result.success) {
      return JSON.stringify({ error: result.error || 'Error en la búsqueda' });
    }

    return JSON.stringify({
      success: true,
      answer: result.answer,
      model_used: result.model_used,
      note: 'Información proporcionada por IA. Puede no estar 100% actualizada.',
    });
  } catch (err) {
    console.error('Search web error:', err);
    return JSON.stringify({ error: 'No se pudo realizar la búsqueda.' });
  }
}

// ==================== GOOGLE CALENDAR ====================

async function executeGoogleCalendarTool(
  toolName: string,
  args: any,
  tenantId: string,
  supabase: any,
  userId: string | null,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<string> {
  if (!userId) {
    return JSON.stringify({ error: 'Debes estar autenticado para usar Google Calendar.' });
  }

  const actionMap: Record<string, string> = {
    gcal_list_events: 'list_events',
    gcal_create_event: 'create_event',
    gcal_update_event: 'update_event',
    gcal_delete_event: 'delete_event',
  };

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/calendar-tools`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        'X-Service-Call': 'true',
      },
      body: JSON.stringify({
        action: actionMap[toolName],
        user_id: userId,
        ...args,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      if (data.calendar_not_connected) {
        return JSON.stringify({ error: 'No tienes Google Calendar conectado. Ve a la app → Configuración → Google Calendar para conectarlo.' });
      }
      return JSON.stringify({ error: data.error || 'Error al interactuar con Google Calendar' });
    }
    return JSON.stringify(data);
  } catch (err) {
    console.error('Google Calendar tool error:', err);
    return JSON.stringify({ error: 'Error al conectar con Google Calendar.' });
  }
}

// ==================== MANAGE CONTACTS ====================

async function executeManageContacts(
  args: any,
  tenantId: string,
  supabase: any,
): Promise<string> {
  const { action, search_term, name, phone, email, company, notes, contact_id } = args;

  if (action === 'list' || action === 'search') {
    let query = supabase
      .from('contacts')
      .select('id, name, phone, email, company, notes, source, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (search_term) {
      query = query.or(`name.ilike.%${search_term}%,phone.ilike.%${search_term}%,email.ilike.%${search_term}%,company.ilike.%${search_term}%`);
    }

    const { data, error } = await query;
    if (error) return JSON.stringify({ error: error.message });
    return JSON.stringify({ contacts: data || [], count: (data || []).length });
  }

  if (action === 'create') {
    if (!name && !phone) return JSON.stringify({ error: 'Se necesita al menos nombre o teléfono para crear un contacto.' });
    const { data, error } = await supabase
      .from('contacts')
      .insert({ tenant_id: tenantId, name, phone: phone || '', email, company, notes, source: 'whatsapp-bot' })
      .select('id, name, phone')
      .single();
    if (error) return JSON.stringify({ error: error.message });
    return JSON.stringify({ success: true, contact: data, message: `Contacto ${data.name || data.phone} creado.` });
  }

  if (action === 'update') {
    if (!contact_id) {
      // Try to find by search_term
      if (search_term) {
        const { data: found } = await supabase
          .from('contacts')
          .select('id')
          .eq('tenant_id', tenantId)
          .or(`name.ilike.%${search_term}%,phone.ilike.%${search_term}%`)
          .limit(1)
          .maybeSingle();
        if (!found) return JSON.stringify({ error: `No encontré un contacto que coincida con "${search_term}".` });
        const updates: any = {};
        if (name) updates.name = name;
        if (phone) updates.phone = phone;
        if (email) updates.email = email;
        if (company) updates.company = company;
        if (notes) updates.notes = notes;
        const { error } = await supabase.from('contacts').update(updates).eq('id', found.id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, message: 'Contacto actualizado.' });
      }
      return JSON.stringify({ error: 'Se necesita contact_id o search_term para actualizar.' });
    }
    const updates: any = {};
    if (name) updates.name = name;
    if (phone) updates.phone = phone;
    if (email) updates.email = email;
    if (company) updates.company = company;
    if (notes) updates.notes = notes;
    const { error } = await supabase.from('contacts').update(updates).eq('id', contact_id).eq('tenant_id', tenantId);
    if (error) return JSON.stringify({ error: error.message });
    return JSON.stringify({ success: true, message: 'Contacto actualizado.' });
  }

  if (action === 'delete') {
    const deleteId = contact_id || null;
    if (!deleteId && search_term) {
      const { data: found } = await supabase
        .from('contacts')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .or(`name.ilike.%${search_term}%,phone.ilike.%${search_term}%`)
        .limit(1)
        .maybeSingle();
      if (!found) return JSON.stringify({ error: `No encontré contacto "${search_term}".` });
      const { error } = await supabase.from('contacts').delete().eq('id', found.id);
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify({ success: true, message: `Contacto "${found.name}" eliminado.` });
    }
    if (!deleteId) return JSON.stringify({ error: 'Se necesita contact_id o search_term.' });
    const { error } = await supabase.from('contacts').delete().eq('id', deleteId).eq('tenant_id', tenantId);
    if (error) return JSON.stringify({ error: error.message });
    return JSON.stringify({ success: true, message: 'Contacto eliminado.' });
  }

  return JSON.stringify({ error: 'Acción no reconocida.' });
}

// ==================== MANAGE KNOWLEDGE ====================

async function executeManageKnowledge(
  args: any,
  tenantId: string,
  supabase: any,
  conversation: any,
): Promise<string> {
  const { action, search_term, title, content, category, tags, item_id } = args;
  const userId = conversation.bot_context?.user_id;

  if (action === 'list' || action === 'search') {
    let query = supabase
      .from('knowledge_items')
      .select('id, title, category, tags, visibility, created_at')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(20);

    if (search_term) {
      query = query.or(`title.ilike.%${search_term}%,content.ilike.%${search_term}%,category.ilike.%${search_term}%`);
    }

    const { data, error } = await query;
    if (error) return JSON.stringify({ error: error.message });
    return JSON.stringify({ items: data || [], count: (data || []).length });
  }

  if (action === 'create') {
    if (!title || !content) return JSON.stringify({ error: 'Se necesita título y contenido.' });
    const { data, error } = await supabase
      .from('knowledge_items')
      .insert({
        tenant_id: tenantId, title, content,
        category: category || 'General',
        tags: tags || [],
        visibility: 'internal',
        author_id: userId,
        active: true,
      })
      .select('id, title')
      .single();
    if (error) return JSON.stringify({ error: error.message });
    return JSON.stringify({ success: true, item: data, message: `Artículo "${data.title}" creado en el Knowledge Hub.` });
  }

  if (action === 'delete') {
    const deleteId = item_id || null;
    if (!deleteId && search_term) {
      const { data: found } = await supabase
        .from('knowledge_items')
        .select('id, title')
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .or(`title.ilike.%${search_term}%,content.ilike.%${search_term}%`)
        .limit(1)
        .maybeSingle();
      if (!found) return JSON.stringify({ error: `No encontré artículo "${search_term}".` });
      await supabase.from('knowledge_items').update({ active: false, deleted_at: new Date().toISOString() }).eq('id', found.id);
      return JSON.stringify({ success: true, message: `Artículo "${found.title}" eliminado.` });
    }
    if (!deleteId) return JSON.stringify({ error: 'Se necesita item_id o search_term.' });
    await supabase.from('knowledge_items').update({ active: false, deleted_at: new Date().toISOString() }).eq('id', deleteId).eq('tenant_id', tenantId);
    return JSON.stringify({ success: true, message: 'Artículo eliminado.' });
  }

  return JSON.stringify({ error: 'Acción no reconocida.' });
}

// ==================== MANAGE EXPENSES ====================

async function executeManageExpenses(
  args: any,
  tenantId: string,
  supabase: any,
  userId: string | null,
): Promise<string> {
  const { action, expense_id, amount, description, category, vendor_name, type, rejection_reason } = args;

  if (!userId) return JSON.stringify({ error: 'Debes estar autenticado.' });

  if (action === 'create') {
    if (!amount) return JSON.stringify({ error: 'Se necesita el monto.' });
    const { data, error } = await supabase
      .from('expenses')
      .insert({
        tenant_id: tenantId, user_id: userId,
        amount, description, category,
        vendor_name, type: type || 'expense',
        source: 'whatsapp-bot',
        status: type === 'budget' ? 'pending_approval' : 'paid',
      })
      .select('id, amount, status')
      .single();
    if (error) return JSON.stringify({ error: error.message });
    return JSON.stringify({ success: true, expense: data, message: `${type === 'budget' ? 'Presupuesto' : 'Gasto'} por $${amount} registrado.` });
  }

  if (action === 'approve' || action === 'reject' || action === 'mark_paid') {
    if (!expense_id) return JSON.stringify({ error: 'Se necesita el expense_id.' });
    const updates: any = {};
    if (action === 'approve') {
      updates.status = 'approved';
      updates.approved_at = new Date().toISOString();
      updates.approver_user_id = userId;
    } else if (action === 'reject') {
      updates.status = 'rejected';
      updates.rejected_at = new Date().toISOString();
      updates.rejection_reason = rejection_reason || '';
      updates.approver_user_id = userId;
    } else {
      updates.status = 'paid';
      updates.paid_at = new Date().toISOString();
    }
    const { error } = await supabase.from('expenses').update(updates).eq('id', expense_id).eq('tenant_id', tenantId);
    if (error) return JSON.stringify({ error: error.message });
    return JSON.stringify({ success: true, message: `Gasto ${action === 'approve' ? 'aprobado' : action === 'reject' ? 'rechazado' : 'marcado como pagado'}.` });
  }

  return JSON.stringify({ error: 'Acción no reconocida.' });
}

// ==================== GET TEAM MEMBERS ====================

async function executeGetTeamMembers(
  args: any,
  tenantId: string,
  supabase: any,
): Promise<string> {
  let query = supabase
    .from('profiles')
    .select('user_id, name, email, phone, whatsapp_number, status, position')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('name');

  if (args?.search_name) {
    query = query.ilike('name', `%${args.search_name}%`);
  }

  const { data: profiles, error } = await query.limit(30);
  if (error) return JSON.stringify({ error: error.message });

  // Get roles for each member
  const members = [];
  for (const p of (profiles || [])) {
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', p.user_id)
      .eq('tenant_id', tenantId);

    members.push({
      name: p.name,
      email: p.email,
      phone: p.phone || p.whatsapp_number,
      position: p.position,
      roles: (roles || []).map((r: any) => r.role),
    });
  }

  return JSON.stringify({ members, count: members.length });
}

// ==================== GET DASHBOARD METRICS ====================

async function executeGetDashboardMetrics(
  tenantId: string,
  supabase: any,
): Promise<string> {
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Parallel queries
  const [callsRes, appointmentsRes, expensesRes, contactsRes] = await Promise.all([
    supabase.from('call_records').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('created_at', thirtyDaysAgo).is('deleted_at', null),
    supabase.from('appointments').select('id, status', { count: 'exact' }).eq('tenant_id', tenantId).gte('start_at', today).neq('status', 'cancelled').is('deleted_at', null),
    supabase.from('expenses').select('id, amount, status').eq('tenant_id', tenantId).gte('created_at', thirtyDaysAgo),
    supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
  ]);

  const pendingExpenses = (expensesRes.data || []).filter((e: any) => e.status === 'pending_approval' || e.status === 'pending');
  const totalExpenseAmount = (expensesRes.data || []).reduce((sum: number, e: any) => sum + (e.amount || 0), 0);

  return JSON.stringify({
    period: 'Últimos 30 días',
    calls_total: callsRes.count || 0,
    appointments_upcoming: appointmentsRes.count || 0,
    contacts_total: contactsRes.count || 0,
    expenses: {
      total_count: (expensesRes.data || []).length,
      pending_count: pendingExpenses.length,
      total_amount: totalExpenseAmount,
    },
  });
}

// ==================== Shared utility ====================

function getUtcDayRangeFromLocalDate(localDate: string, tz: string): { startIsoUtc: string; endIsoUtc: string } {
  const start = parseLocalToUTC(`${localDate}T00:00:00`, tz);
  const end = parseLocalToUTC(`${localDate}T23:59:59`, tz);
  return {
    startIsoUtc: start.toISOString(),
    endIsoUtc: end.toISOString(),
  };
}

function parseLocalToUTC(rawDateStr: string, tz: string): Date {
  const tempDate = new Date(rawDateStr);
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
  const parts = formatter.formatToParts(tempDate);
  const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
  const offsetMatch = offsetPart.match(/GMT([+-]?\d+)/);
  if (offsetMatch) {
    const offsetHours = parseInt(offsetMatch[1]);
    const sign = offsetHours >= 0 ? '+' : '-';
    const absHours = Math.abs(offsetHours).toString().padStart(2, '0');
    return new Date(`${rawDateStr}${sign}${absHours}:00`);
  }
  return tempDate;
}

// ==================== MANAGE DRIVE FOLDERS ====================

async function executeManageDriveFolders(
  args: any,
  tenantId: string,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<string> {
  const { action, folder_name, parent_folder_name } = args;

  try {
    if (action === 'create') {
      if (!folder_name) return JSON.stringify({ error: 'Se necesita el nombre de la carpeta.' });
      const res = await fetch(`${supabaseUrl}/functions/v1/google-drive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({
          action: 'ensure_subfolder',
          tenant_id: tenantId,
          internal_caller: true,
          folder_name,
          parent_folder_name: parent_folder_name || null,
        }),
      });
      const result = await res.json();
      if (result.folder_id) {
        return JSON.stringify({ success: true, folder_id: result.folder_id, folder_name, message: `Carpeta "${folder_name}" creada/verificada en Google Drive.` });
      }
      return JSON.stringify({ error: result.error || 'No se pudo crear la carpeta.' });
    }

    if (action === 'list') {
      const res = await fetch(`${supabaseUrl}/functions/v1/google-drive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ action: 'list_folders', tenant_id: tenantId, internal_caller: true }),
      });
      const result = await res.json();
      return JSON.stringify(result);
    }

    if (action === 'search') {
      if (!folder_name) return JSON.stringify({ error: 'Se necesita el nombre a buscar.' });
      const res = await fetch(`${supabaseUrl}/functions/v1/google-drive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ action: 'search_folder', tenant_id: tenantId, internal_caller: true, folder_name }),
      });
      const result = await res.json();
      return JSON.stringify(result);
    }

    return JSON.stringify({ error: 'Acción no reconocida.' });
  } catch (err) {
    console.error('Drive folders error:', err);
    return JSON.stringify({ error: 'Error al gestionar carpetas de Drive.' });
  }
}

// ==================== GET DOCUMENT ALERTS ====================

async function executeGetDocumentAlerts(
  args: any,
  tenantId: string,
  supabase: any,
): Promise<string> {
  let query = supabase
    .from('document_alerts')
    .select('id, alert_type, severity, title, description, metadata, resolved, created_at, document_id')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (args?.severity) {
    query = query.eq('severity', args.severity);
  }
  if (!args?.resolved) {
    query = query.eq('resolved', false);
  }

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });

  return JSON.stringify({
    alerts: (data || []).map((a: any) => ({
      id: a.id,
      type: a.alert_type,
      severity: a.severity,
      title: a.title,
      description: a.description,
      document_id: a.document_id,
      resolved: a.resolved,
      created: a.created_at,
    })),
    count: (data || []).length,
  });
}
