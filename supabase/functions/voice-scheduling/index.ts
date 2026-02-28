import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { action, data } = await req.json();

    // ─── CHECK AVAILABILITY ───
    if (action === 'check_availability') {
      const { tenant_id, date, employee_id } = data;
      if (!tenant_id || !date) {
        return jsonResp({ error: 'Missing tenant_id or date' }, 400);
      }

      const targetDate = new Date(date);
      const dayOfWeek = targetDate.getDay(); // 0=Sun ... 6=Sat

      // Get availability rules for that day
      let rulesQuery = supabase
        .from('availability_rules')
        .select('*')
        .eq('tenant_id', tenant_id)
        .eq('day_of_week', dayOfWeek)
        .eq('active', true);

      if (employee_id) {
        rulesQuery = rulesQuery.eq('user_id', employee_id);
      }

      const { data: rules, error: rulesErr } = await rulesQuery;
      if (rulesErr) throw rulesErr;

      if (!rules || rules.length === 0) {
        return jsonResp({ available: false, message: 'No hay horarios configurados para este día', slots: [] });
      }

      // Get existing appointments for that date
      const dayStart = new Date(targetDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(targetDate);
      dayEnd.setHours(23, 59, 59, 999);

      let aptsQuery = supabase
        .from('appointments')
        .select('*')
        .eq('tenant_id', tenant_id)
        .gte('start_at', dayStart.toISOString())
        .lte('start_at', dayEnd.toISOString())
        .is('deleted_at', null)
        .not('status', 'eq', 'cancelled');

      if (employee_id) {
        aptsQuery = aptsQuery.eq('user_id', employee_id);
      }

      const { data: existingApts } = await aptsQuery;

      // Generate available slots (30-min intervals)
      const slots: Array<{ start: string; end: string; employee_id: string | null; employee_name: string }> = [];

      for (const rule of rules) {
        const [startH, startM] = rule.start_time.split(':').map(Number);
        const [endH, endM] = rule.end_time.split(':').map(Number);
        const bufferBefore = rule.buffer_before || 0;
        const bufferAfter = rule.buffer_after || 0;
        const slotDuration = 30; // minutes

        let cursor = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        // Get employee name
        let employeeName = 'Sin asignar';
        if (rule.user_id) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('name')
            .eq('user_id', rule.user_id)
            .single();
          if (profile) employeeName = profile.name;
        }

        while (cursor + slotDuration <= endMinutes) {
          const slotStart = new Date(targetDate);
          slotStart.setHours(Math.floor(cursor / 60), cursor % 60, 0, 0);
          const slotEnd = new Date(slotStart);
          slotEnd.setMinutes(slotEnd.getMinutes() + slotDuration);

          // Check conflicts with buffer
          const slotStartWithBuffer = new Date(slotStart);
          slotStartWithBuffer.setMinutes(slotStartWithBuffer.getMinutes() - bufferBefore);
          const slotEndWithBuffer = new Date(slotEnd);
          slotEndWithBuffer.setMinutes(slotEndWithBuffer.getMinutes() + bufferAfter);

          const hasConflict = (existingApts || []).some(apt => {
            const aptStart = new Date(apt.start_at);
            const aptEnd = new Date(apt.end_at);
            return slotStartWithBuffer < aptEnd && slotEndWithBuffer > aptStart;
          });

          if (!hasConflict) {
            // Check max_appointments
            const aptsInSlot = (existingApts || []).filter(apt => {
              const aptStart = new Date(apt.start_at);
              return aptStart.getHours() === slotStart.getHours() && aptStart.getMinutes() === slotStart.getMinutes();
            }).length;

            if (aptsInSlot < (rule.max_appointments || 10)) {
              slots.push({
                start: slotStart.toISOString(),
                end: slotEnd.toISOString(),
                employee_id: rule.user_id,
                employee_name: employeeName,
              });
            }
          }

          cursor += slotDuration;
        }
      }

      return jsonResp({
        available: slots.length > 0,
        slots,
        date: targetDate.toISOString().split('T')[0],
        message: slots.length > 0
          ? `Hay ${slots.length} horarios disponibles para ${targetDate.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}`
          : 'No hay horarios disponibles para esta fecha',
      });
    }

    // ─── BOOK APPOINTMENT ───
    if (action === 'book_appointment') {
      const { tenant_id, contact_name, contact_phone, contact_email, start_at, service_type, employee_id, notes, source, call_record_id } = data;

      if (!tenant_id || !contact_name || !start_at) {
        return jsonResp({ error: 'Missing required fields' }, 400);
      }

      const startDate = new Date(start_at);
      const endDate = new Date(startDate);
      endDate.setMinutes(endDate.getMinutes() + 30);

      const { data: appointment, error: insertErr } = await supabase
        .from('appointments')
        .insert({
          tenant_id,
          contact_name,
          contact_phone: contact_phone || null,
          contact_email: contact_email || null,
          start_at: startDate.toISOString(),
          end_at: endDate.toISOString(),
          service_type: service_type || 'general',
          user_id: employee_id || null,
          notes: notes || null,
          source: source || 'call',
          call_record_id: call_record_id || null,
          status: 'scheduled',
        })
        .select('id, start_at, end_at, contact_name, service_type, status')
        .single();

      if (insertErr) throw insertErr;

      return jsonResp({
        success: true,
        appointment,
        message: `Cita agendada para ${contact_name} el ${startDate.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })} a las ${startDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`,
      });
    }

    // ─── RESCHEDULE ───
    if (action === 'reschedule_appointment') {
      const { appointment_id, new_start_at } = data;
      if (!appointment_id || !new_start_at) {
        return jsonResp({ error: 'Missing appointment_id or new_start_at' }, 400);
      }

      const newStart = new Date(new_start_at);
      const newEnd = new Date(newStart);
      newEnd.setMinutes(newEnd.getMinutes() + 30);

      const { data: updated, error: updateErr } = await supabase
        .from('appointments')
        .update({
          start_at: newStart.toISOString(),
          end_at: newEnd.toISOString(),
          status: 'scheduled',
        })
        .eq('id', appointment_id)
        .select('id, start_at, end_at, contact_name')
        .single();

      if (updateErr) throw updateErr;

      return jsonResp({
        success: true,
        appointment: updated,
        message: `Cita de ${updated.contact_name} reprogramada para ${newStart.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })} a las ${newStart.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`,
      });
    }

    // ─── CANCEL ───
    if (action === 'cancel_appointment') {
      const { appointment_id } = data;
      if (!appointment_id) {
        return jsonResp({ error: 'Missing appointment_id' }, 400);
      }

      const { data: cancelled, error: cancelErr } = await supabase
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('id', appointment_id)
        .select('id, contact_name')
        .single();

      if (cancelErr) throw cancelErr;

      return jsonResp({
        success: true,
        message: `Cita de ${cancelled.contact_name} cancelada exitosamente`,
      });
    }

    // ─── LIST EMPLOYEES ───
    if (action === 'list_employees') {
      const { tenant_id } = data;
      const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('user_id, name, email, phone')
        .eq('tenant_id', tenant_id)
        .eq('status', 'active');

      if (profErr) throw profErr;

      return jsonResp({
        employees: (profiles || []).map(p => ({
          id: p.user_id,
          name: p.name,
          email: p.email,
          phone: p.phone,
        })),
      });
    }

    return jsonResp({ error: 'Unknown action' }, 400);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('voice-scheduling error:', msg);
    return jsonResp({ error: msg }, 500);
  }
});

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
      'Content-Type': 'application/json',
    },
  });
}
