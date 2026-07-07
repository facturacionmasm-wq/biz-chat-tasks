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

  // ═══════════ SHARED-SECRET GUARD ═══════════
  const expectedSecret = Deno.env.get('ELEVENLABS_WEBHOOK_SECRET');
  if (expectedSecret && expectedSecret.length > 0) {
    const providedSecret = req.headers.get('x-elevenlabs-secret');
    if (providedSecret !== expectedSecret) {
      console.warn('[el-actions] Unauthorized: invalid or missing x-elevenlabs-secret header');
      return new Response(
        JSON.stringify({ success: false, message: 'No autorizado (secreto invalido)' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
  } else {
    console.warn('[el-actions] ELEVENLABS_WEBHOOK_SECRET not configured — webhook is UNPROTECTED');
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

    // Extract context from dynamic_variables (passed via register-call) and
    // from system-provided fields mapped into the ElevenLabs tool body.
    const dynamicVars = body.dynamic_variables || body.conversation_initiation_client_data?.dynamic_variables || {};
    const tenantId = firstString(
      toolParams.tenant_id,
      toolParams.system__tenant_id,
      dynamicVars.tenant_id,
    );
    let callRecordId = firstString(
      toolParams.call_record_id,
      toolParams.system__call_record_id,
      dynamicVars.call_record_id,
    );
    let callSid = firstString(
      toolParams.call_sid,
      toolParams.system__call_sid,
      dynamicVars.call_sid,
      dynamicVars.system__call_sid,
      body.metadata?.phone_call?.call_sid,
    );
    const callerPhoneFromContext = firstString(
      toolParams.caller_phone,
      toolParams.system__caller_id,
      dynamicVars.caller_phone,
      dynamicVars.system__caller_id,
      body.metadata?.phone_call?.external_number,
    );

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

    // Last-resort lookup for legacy ElevenLabs tool schemas that did not send
    // call_sid in the webhook body. Keep it tenant-scoped and recent so we do
    // not accidentally transfer another tenant's live call.
    if (toolName === 'transfer_call' || toolName === 'transferir_llamada') {
      const fallback = await resolveRecentCallContext(supabase, resolvedTenantId, callSid, callRecordId);
      callSid = fallback.callSid;
      callRecordId = fallback.callRecordId;
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
        // Transfer is executed by redirecting the LIVE Twilio call (call_sid)
        // to the target phone via call-transfer's internal server-to-server mode.
        const targetPhone = normalizePhoneForDial(toolParams.target_phone || toolParams.telefono_destino || '');
        const targetName = toolParams.target_name || toolParams.nombre_destino || toolParams.employee_name || 'Agente';

        if (!targetPhone) {
          return jsonResp({ success: false, message: 'Necesito el número de teléfono de destino para transferir la llamada.' });
        }
        if (!callSid) {
          return jsonResp({ success: false, message: 'No se pudo identificar la llamada en curso (call_sid ausente).' });
        }

        // Fetch caller_phone and transcript from the call record (for whisper context)
        let callerPhone: string | null = callerPhoneFromContext;
        let callTranscript: string | null = null;
        if (callRecordId) {
          const { data: cr } = await supabase
            .from('call_records')
            .select('from_number, transcript')
            .eq('id', callRecordId)
            .maybeSingle();
          callerPhone = callerPhone || cr?.from_number || null;
          callTranscript = cr?.transcript ?? null;
        }

        try {
          const transferRes = await fetch(`${SUPABASE_URL}/functions/v1/call-transfer`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
              tenant_id: resolvedTenantId,
              call_sid: callSid,
              target_phone: targetPhone,
              target_name: targetName,
              caller_phone: callerPhone,
              transcript: callTranscript,
              call_record_id: callRecordId,
            }),
          });
          const transferData = await transferRes.json();
          if (!transferRes.ok) {
            console.error('[el-actions] call-transfer error:', transferData);
            return jsonResp({
              success: false,
              message: transferData?.error || 'Error al transferir la llamada.',
            }, transferRes.status);
          }
          return jsonResp(transferData);
        } catch (e) {
          console.error('[el-actions] transfer_call exception:', e);
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

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function normalizePhoneForDial(phone: string): string {
  return phone.trim().replace(/[\s().-]/g, '');
}

async function resolveRecentCallContext(
  supabase: any,
  tenantId: string,
  callSid: string | null,
  callRecordId: string | null,
): Promise<{ callSid: string | null; callRecordId: string | null }> {
  if (callSid && callRecordId) return { callSid, callRecordId };

  if (callSid && !callRecordId) {
    const { data } = await supabase
      .from('call_records')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('external_call_id', callSid)
      .maybeSingle();
    return { callSid, callRecordId: data?.id || null };
  }

  if (callRecordId && !callSid) {
    const { data } = await supabase
      .from('call_records')
      .select('external_call_id')
      .eq('tenant_id', tenantId)
      .eq('id', callRecordId)
      .maybeSingle();
    return { callSid: data?.external_call_id || null, callRecordId };
  }

  const recentSince = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: sessions, error } = await supabase
    .from('call_sessions')
    .select('call_sid, call_record_id, state, created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', recentSince)
    .order('created_at', { ascending: false })
    .limit(2);

  if (error) {
    console.warn('[el-actions] recent call fallback failed:', error.message);
    return { callSid, callRecordId };
  }
  if (!sessions || sessions.length !== 1) {
    console.warn('[el-actions] recent call fallback skipped:', {
      tenantId,
      candidates: sessions?.length || 0,
    });
    return { callSid, callRecordId };
  }

  console.warn('[el-actions] call_sid recovered from recent tenant call_session fallback');
  return {
    callSid: sessions[0].call_sid || null,
    callRecordId: sessions[0].call_record_id || null,
  };
}
