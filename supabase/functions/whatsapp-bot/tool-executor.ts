// Executes AI tool calls against the database and external services

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
    return await executeScheduleAppointment(args, tenantId, supabase, userId, contactPhone);
  }

  if (toolName === 'check_availability') {
    return await executeCheckAvailability(args, tenantId, supabase, supabaseUrl, serviceRoleKey);
  }

  if (toolName === 'create_reminder') {
    return await executeCreateReminder(args, tenantId, supabase, userId);
  }

  if (toolName === 'get_today_agenda') {
    return await executeGetTodayAgenda(tenantId, supabase, userId);
  }

  if (toolName === 'get_pending_expenses') {
    return await executeGetPendingExpenses(supabase, userId);
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

  return JSON.stringify({ error: 'Unknown tool' });
}

// ==================== Individual tool implementations ====================

async function executeScheduleAppointment(
  args: any,
  tenantId: string,
  supabase: any,
  userId: string | null,
  contactPhone: string | null,
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

  // Idempotency: check for duplicate
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
    })
    .select('id, start_at, end_at, contact_name')
    .single();

  if (error) return JSON.stringify({ error: error.message });

  return JSON.stringify({
    success: true,
    appointment_id: apt.id,
    contact_name: apt.contact_name,
    date: startAt.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }),
    time: startAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: tz }),
    employee: employee_name || 'sin asignar',
  });
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
): Promise<string> {
  const today = new Date().toISOString().split('T')[0];

  let query = supabase
    .from('appointments')
    .select('start_at, end_at, contact_name, service_type, status')
    .eq('tenant_id', tenantId)
    .gte('start_at', `${today}T00:00:00`)
    .lte('start_at', `${today}T23:59:59`)
    .neq('status', 'cancelled')
    .order('start_at');

  if (userId) query = query.eq('user_id', userId);
  const { data: apts } = await query;

  return JSON.stringify({
    date: today,
    appointments: (apts || []).map((a: any) => ({
      time: new Date(a.start_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      end_time: new Date(a.end_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      contact: a.contact_name,
      service: a.service_type || 'General',
      status: a.status,
    })),
    count: (apts || []).length,
  });
}

async function executeGetPendingExpenses(
  supabase: any,
  userId: string | null,
): Promise<string> {
  if (!userId) return JSON.stringify({ expenses: [], count: 0 });

  const { data: expenses } = await supabase
    .from('expenses')
    .select('amount, description, category, expense_date, status')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('expense_date', { ascending: false })
    .limit(10);

  return JSON.stringify({
    expenses: (expenses || []).map((e: any) => ({
      amount: e.amount,
      description: e.description,
      category: e.category,
      date: e.expense_date,
    })),
    count: (expenses || []).length,
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

// ==================== Shared utility ====================

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
