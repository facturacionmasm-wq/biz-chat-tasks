import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * ElevenLabs Server-Side Tool Actions Webhook
 *
 * Receives tool calls from ElevenLabs agent configured as "Server URL / Webhook" tools.
 * Routes to voice-scheduling for appointment management.
 *
 * Configure in ElevenLabs Dashboard → Agent → Tools → Server-side Webhook:
 *   URL: https://<project-ref>.supabase.co/functions/v1/elevenlabs-actions-webhook
 *   Method: POST
 *
 * Tools to configure in ElevenLabs:
 *   - check_availability: { date: string, tenant_id?: string }
 *   - book_appointment: { contact_name, date, time, service_type?, contact_phone? }
 *   - cancel_appointment: { appointment_id }
 *   - reschedule_appointment: { appointment_id, new_date, new_time }
 *   - transfer_call: { target_phone }
 */

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    console.log('[el-actions] Received:', JSON.stringify(body).substring(0, 500));

    // ElevenLabs sends tool calls in various formats. Normalize.
    const toolName = body.tool_name || body.name || body.action || body.function_name || '';
    const toolParams = body.parameters || body.params || body.arguments || body.data || body;

    // Extract context from dynamic_variables (passed via register-call)
    const dynamicVars = body.dynamic_variables || body.conversation_initiation_client_data?.dynamic_variables || {};
    const tenantId = toolParams.tenant_id || dynamicVars.tenant_id || null;
    const callRecordId = toolParams.call_record_id || dynamicVars.call_record_id || null;
    const callSid = toolParams.call_sid || dynamicVars.call_sid || null;

    // Resolve tenant if not provided
    let resolvedTenantId = tenantId;
    if (!resolvedTenantId) {
      // Try to find from call record
      if (callSid) {
        const { data: cr } = await supabase
          .from('call_records').select('tenant_id').eq('external_call_id', callSid).maybeSingle();
        if (cr) resolvedTenantId = cr.tenant_id;
      }
      if (!resolvedTenantId) {
        const { data: fallback } = await supabase.from('tenants').select('id').limit(1).single();
        resolvedTenantId = fallback?.id;
      }
    }

    if (!resolvedTenantId) {
      return jsonResp({ error: 'Could not resolve tenant', success: false }, 400);
    }

    console.log(`[el-actions] tool=${toolName} tenant=${resolvedTenantId} callSid=${callSid}`);

    // ═══════════ ROUTE TO VOICE-SCHEDULING ═══════════
    let schedulingAction = '';
    let schedulingData: Record<string, any> = { tenant_id: resolvedTenantId };

    switch (toolName) {
      case 'check_availability': {
        schedulingAction = 'check_availability';
        schedulingData.date = toolParams.date || toolParams.fecha || new Date().toISOString().split('T')[0];
        schedulingData.employee_id = toolParams.employee_id || null;
        break;
      }

      case 'book_appointment':
      case 'agendar_cita':
      case 'schedule_appointment': {
        schedulingAction = 'book_appointment';
        const date = toolParams.date || toolParams.fecha || '';
        const time = toolParams.time || toolParams.hora || '';
        schedulingData.contact_name = toolParams.contact_name || toolParams.nombre || toolParams.patient_name || 'Cliente';
        schedulingData.contact_phone = toolParams.contact_phone || toolParams.telefono || null;
        schedulingData.contact_email = toolParams.contact_email || toolParams.email || null;
        schedulingData.start_at = date && time ? `${date}T${time}:00` : toolParams.start_at || '';
        schedulingData.service_type = toolParams.service_type || toolParams.servicio || 'general';
        schedulingData.employee_id = toolParams.employee_id || null;
        schedulingData.notes = toolParams.notes || toolParams.notas || null;
        schedulingData.source = 'call';
        schedulingData.call_record_id = callRecordId || null;

        if (!schedulingData.start_at) {
          return jsonResp({
            success: false,
            message: 'Necesito la fecha y hora para agendar la cita. ¿Qué día y hora le conviene?',
          });
        }
        break;
      }

      case 'reschedule_appointment':
      case 'reagendar_cita': {
        schedulingAction = 'reschedule_appointment';
        const newDate = toolParams.new_date || toolParams.nueva_fecha || '';
        const newTime = toolParams.new_time || toolParams.nueva_hora || '';
        schedulingData.appointment_id = toolParams.appointment_id || '';
        schedulingData.new_start_at = newDate && newTime ? `${newDate}T${newTime}:00` : toolParams.new_start_at || '';

        if (!schedulingData.appointment_id || !schedulingData.new_start_at) {
          return jsonResp({
            success: false,
            message: 'Necesito el ID de la cita y la nueva fecha/hora para reprogramar.',
          });
        }
        break;
      }

      case 'cancel_appointment':
      case 'cancelar_cita': {
        schedulingAction = 'cancel_appointment';
        schedulingData.appointment_id = toolParams.appointment_id || '';

        if (!schedulingData.appointment_id) {
          return jsonResp({
            success: false,
            message: 'Necesito el ID de la cita para cancelarla.',
          });
        }
        break;
      }

      case 'transfer_call':
      case 'transferir_llamada': {
        // Transfer is handled differently — via Twilio API
        const targetPhone = toolParams.target_phone || toolParams.telefono_destino || '';
        if (!targetPhone) {
          return jsonResp({ success: false, message: 'Necesito el número de teléfono de destino.' });
        }
        // Invoke the call-transfer function
        try {
          const transferRes = await fetch(`${SUPABASE_URL}/functions/v1/call-transfer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({ call_sid: callSid, target_phone: targetPhone, tenant_id: resolvedTenantId }),
          });
          const transferData = await transferRes.json();
          return jsonResp(transferData);
        } catch (e) {
          return jsonResp({ success: false, message: 'Error al transferir la llamada.' }, 500);
        }
      }

      default:
        console.warn(`[el-actions] Unknown tool: ${toolName}`);
        return jsonResp({ success: false, message: `Acción no reconocida: ${toolName}` }, 400);
    }

    // Call voice-scheduling
    const schedRes = await fetch(`${SUPABASE_URL}/functions/v1/voice-scheduling`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ action: schedulingAction, data: schedulingData }),
    });

    const schedData = await schedRes.json();
    console.log(`[el-actions] voice-scheduling response:`, JSON.stringify(schedData).substring(0, 300));

    // Update appointment status on call record if booking succeeded
    if (schedulingAction === 'book_appointment' && schedData.success && callRecordId) {
      await supabase.from('call_records').update({
        appointment_status: 'created',
      }).eq('id', callRecordId);
    }

    // Audit event
    await supabase.from('audit_events').insert({
      tenant_id: resolvedTenantId,
      event_type: `call.agent_action.${schedulingAction}`,
      resource_type: 'call_record',
      resource_id: callRecordId || null,
      payload: { tool_name: toolName, action: schedulingAction, result: schedData, call_sid: callSid },
    });

    return jsonResp(schedData);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[el-actions] Error:', msg);
    return jsonResp({ success: false, error: msg, message: 'Ha ocurrido un error procesando la solicitud.' }, 500);
  }
});

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
