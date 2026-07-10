// Shared SMS inbound persistence logic.
// Consumed by:
//   - supabase/functions/sms-inbound/index.ts (public endpoint, validates signature itself)
//   - supabase/functions/whatsapp-webhook/index.ts (router branch after signature already validated)
//
// This module does NOT validate the Twilio signature. That is the caller's
// responsibility, because the signature is bound to the exact public URL
// Twilio POSTed to.

const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001';

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

export interface HandleInboundSmsInput {
  supabase: SupabaseLike;
  paramsObj: Record<string, string>;
  sourceFunction: string;
}

export interface HandleInboundSmsResult {
  ok: boolean;
  status: 'stored' | 'duplicate' | 'skipped' | 'error';
  tenantId: string | null;
  messageSid: string | null;
  reason?: string;
}

async function logSmsWebhook(
  supabase: SupabaseLike,
  input: {
    tenantId?: string | null;
    stage: string;
    status: 'ok' | 'error' | 'skip';
    error?: string | null;
    messageId?: string | null;
    payload?: Record<string, unknown>;
  },
) {
  try {
    await supabase.from('webhook_logs').insert({
      tenant_id: input.tenantId ?? null,
      provider: 'sms',
      message_id: input.messageId ?? null,
      conversation_id: null,
      stage: input.stage,
      status: input.status,
      error: input.error ?? null,
      payload: input.payload ?? {},
    });
  } catch (e) {
    console.error('[sms-inbound-core] webhook_logs insert failed:', e);
  }
}

/**
 * Persist an inbound SMS coming from Twilio.
 * - Ignores WhatsApp (defensive; caller should route those separately).
 * - Resolves tenant via tenant_phone_numbers, with env TWILIO_PHONE_NUMBER -> master fallback.
 * - Skips (and logs) if tenant cannot be resolved.
 * - Upserts idempotently by message_sid.
 */
export async function handleInboundSms(
  { supabase, paramsObj, sourceFunction }: HandleInboundSmsInput,
): Promise<HandleInboundSmsResult> {
  const from = paramsObj['From'] || '';
  const to = paramsObj['To'] || '';
  const body = paramsObj['Body'] || '';
  const messageSid = paramsObj['MessageSid'] || paramsObj['SmsSid'] || '';
  const numMediaRaw = paramsObj['NumMedia'] || '0';
  const numMedia = parseInt(numMediaRaw, 10);

  // Defensive guard: if a WhatsApp payload sneaks in, do nothing here.
  if (from.startsWith('whatsapp:') || to.startsWith('whatsapp:')) {
    await logSmsWebhook(supabase, {
      stage: 'ignore_whatsapp',
      status: 'skip',
      messageId: messageSid || null,
      payload: { from, to, source: sourceFunction },
    });
    return { ok: true, status: 'skipped', tenantId: null, messageSid: messageSid || null, reason: 'whatsapp_payload' };
  }

  if (!messageSid) {
    await logSmsWebhook(supabase, {
      stage: 'parse',
      status: 'error',
      error: 'missing_message_sid',
      payload: { ...paramsObj, source: sourceFunction },
    });
    return { ok: false, status: 'error', tenantId: null, messageSid: null, reason: 'missing_message_sid' };
  }

  // Resolve tenant by destination number.
  const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER') || '';
  let tenantId: string | null = null;
  if (to) {
    const { data: mapping } = await supabase
      .from('tenant_phone_numbers')
      .select('tenant_id')
      .eq('phone_e164', to)
      .eq('active', true)
      .maybeSingle();
    if (mapping?.tenant_id) tenantId = mapping.tenant_id;
  }
  if (!tenantId && TWILIO_PHONE_NUMBER && to === TWILIO_PHONE_NUMBER) {
    tenantId = MASTER_TENANT_ID;
  }
  if (!tenantId) {
    await logSmsWebhook(supabase, {
      stage: 'tenant_resolution',
      status: 'skip',
      messageId: messageSid,
      payload: { to, reason: 'tenant_not_found', source: sourceFunction },
    });
    return { ok: true, status: 'skipped', tenantId: null, messageSid, reason: 'tenant_not_found' };
  }

  const { error: insertError } = await supabase
    .from('sms_inbound_messages')
    .upsert(
      {
        tenant_id: tenantId,
        message_sid: messageSid,
        from_e164: from,
        to_e164: to,
        body,
        num_media: isNaN(numMedia) ? 0 : numMedia,
        raw: paramsObj,
      },
      { onConflict: 'message_sid', ignoreDuplicates: true },
    );

  if (insertError) {
    await logSmsWebhook(supabase, {
      tenantId,
      stage: 'insert',
      status: 'error',
      error: insertError.message,
      messageId: messageSid,
      payload: { source: sourceFunction },
    });
    return { ok: false, status: 'error', tenantId, messageSid, reason: insertError.message };
  }

  await logSmsWebhook(supabase, {
    tenantId,
    stage: 'inbound_stored',
    status: 'ok',
    messageId: messageSid,
    payload: {
      from,
      to,
      has_body: body.length > 0,
      num_media: isNaN(numMedia) ? 0 : numMedia,
      source: sourceFunction,
    },
  });

  return { ok: true, status: 'stored', tenantId, messageSid };
}
