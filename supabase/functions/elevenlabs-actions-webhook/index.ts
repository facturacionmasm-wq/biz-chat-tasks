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
        // Transfer via Twilio API — find employee by phone or user_id
        const targetPhone = toolParams.target_phone || toolParams.telefono_destino || '';
        const targetUserId = toolParams.target_user_id || toolParams.employee_id || '';
        const targetName = toolParams.target_name || toolParams.nombre_destino || '';

        if (!targetPhone && !targetUserId && !targetName) {
          return jsonResp({ success: false, message: 'Necesito el nombre o número de teléfono del empleado para transferir.' });
        }

        // Resolve employee
        let employeePhone = targetPhone;
        let employeeName = targetName || 'Empleado';
        let resolvedUserId = targetUserId;

        if (!employeePhone) {
          // Try to find by name or user_id
          let query = supabase.from('profiles').select('user_id, name, phone, whatsapp_number')
            .eq('tenant_id', resolvedTenantId).eq('status', 'active');
          
          if (targetUserId) {
            query = query.eq('user_id', targetUserId);
          } else if (targetName) {
            query = query.ilike('name', `%${targetName}%`);
          }
          
          const { data: profiles } = await query.limit(1).maybeSingle();
          if (profiles) {
            employeePhone = profiles.phone || profiles.whatsapp_number || '';
            employeeName = profiles.name;
            resolvedUserId = profiles.user_id;
          }
        }

        if (!employeePhone) {
          return jsonResp({ success: false, message: `No encontré número de teléfono para ${employeeName}. No se puede transferir.` });
        }

        // Get caller phone from call record
        let callerPhone = toolParams.caller_phone || '';
        if (!callerPhone && callSid) {
          const { data: cr } = await supabase.from('call_records').select('from_number').eq('external_call_id', callSid).maybeSingle();
          if (cr) callerPhone = cr.from_number || '';
        }

        // Get transcript for whisper
        let transcript = toolParams.transcript || '';
        if (!transcript && callRecordId) {
          const { data: cr } = await supabase.from('call_records').select('transcript').eq('id', callRecordId).maybeSingle();
          if (cr) transcript = cr.transcript || '';
        }

        // Direct Twilio call to employee (bypassing call-transfer auth)
        const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
        const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
        const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');
        const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

        if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
          return jsonResp({ success: false, message: 'Credenciales de Twilio no configuradas para transferencia.' });
        }

        // Generate whisper summary
        let whisperText = `Llamada transferida. Cliente al teléfono: ${callerPhone || 'desconocido'}.`;
        if (transcript && LOVABLE_API_KEY) {
          try {
            const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
              method: 'POST',
              headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'google/gemini-2.5-flash',
                messages: [
                  { role: 'system', content: 'Genera un resumen en español de máximo 3 oraciones de esta llamada para el empleado que la recibirá. Solo el resumen.' },
                  { role: 'user', content: `Transcripción:\n${transcript}` },
                ],
              }),
            });
            if (aiRes.ok) {
              const aiData = await aiRes.json();
              const summary = aiData.choices?.[0]?.message?.content;
              if (summary) whisperText = `Resumen: ${summary}. El cliente está en la línea.`;
            }
          } catch (_) { /* use default whisper */ }
        }

        const conferenceName = `transfer_${callRecordId || Date.now()}`;
        const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

        // Call employee with whisper
        const twimlUrl = `${SUPABASE_URL}/functions/v1/call-transfer-twiml?` +
          `action=whisper&whisper=${encodeURIComponent(whisperText)}&conference=${encodeURIComponent(conferenceName)}&caller_phone=${encodeURIComponent(callerPhone)}`;

        const empCallRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`,
          {
            method: 'POST',
            headers: { Authorization: `Basic ${twilioAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ To: employeePhone, From: TWILIO_PHONE_NUMBER, Url: twimlUrl }).toString(),
          }
        );
        const empCallData = await empCallRes.json();

        if (!empCallRes.ok) {
          console.error('[el-actions] Twilio transfer error:', empCallData);
          return jsonResp({ success: false, message: `Error al llamar a ${employeeName}: ${empCallData.message || 'Error de Twilio'}` });
        }

        // Call the original caller to join conference (only if not already on an active call via Twilio)
        let callerCallSid: string | null = null;
        if (callerPhone) {
          const callerTwimlUrl = `${SUPABASE_URL}/functions/v1/call-transfer-twiml?action=join&conference=${encodeURIComponent(conferenceName)}`;
          const callerRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`,
            {
              method: 'POST',
              headers: { Authorization: `Basic ${twilioAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ To: callerPhone, From: TWILIO_PHONE_NUMBER, Url: callerTwimlUrl }).toString(),
            }
          );
          const callerData = await callerRes.json();
          callerCallSid = callerData?.sid || null;
        }

        // Log transfer event
        if (callRecordId) {
          await supabase.from('call_events').insert({
            call_record_id: callRecordId,
            tenant_id: resolvedTenantId,
            event_type: 'transferred',
            event_data: {
              target_user_id: resolvedUserId, target_name: employeeName, target_phone: employeePhone,
              caller_phone: callerPhone, conference: conferenceName,
              employee_call_sid: empCallData.sid, caller_call_sid: callerCallSid,
              whisper_summary: whisperText, source: 'voice_agent',
            },
          });
        }

        // Notify employee (fire and forget)
        fetch(`${SUPABASE_URL}/functions/v1/notify-transfer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({
            tenant_id: resolvedTenantId, target_user_id: resolvedUserId,
            target_name: employeeName, caller_phone: callerPhone,
            summary: whisperText, call_record_id: callRecordId,
          }),
        }).catch(e => console.error('[el-actions] notify error:', e));

        return jsonResp({
          success: true,
          message: `Transfiriendo la llamada a ${employeeName}. Se le está llamando ahora.`,
          conference: conferenceName,
          employee_call_sid: empCallData.sid,
        });
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
