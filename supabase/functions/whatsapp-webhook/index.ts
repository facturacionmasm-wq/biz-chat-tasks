import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) data += key + params[key];
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === signature;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') || '';
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const logWebhook = async (input: {
    tenantId?: string | null;
    messageId?: string | null;
    conversationId?: string | null;
    stage: string;
    status: 'ok' | 'error' | 'skip';
    error?: string | null;
    payload?: Record<string, unknown>;
  }) => {
    try {
      await supabase.from('webhook_logs').insert({
        tenant_id: input.tenantId ?? null,
        provider: 'whatsapp',
        message_id: input.messageId ?? null,
        conversation_id: input.conversationId ?? null,
        stage: input.stage,
        status: input.status,
        error: input.error ?? null,
        payload: input.payload ?? {},
      });
    } catch (e) {
      console.error('webhook_logs insert failed:', e);
    }
  };

  try {
    // WhatsApp Cloud API webhook verification (GET with hub.verify_token)
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN') || 'lovable_wa_verify';

      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('Webhook verified successfully');
        return new Response(challenge, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
        });
      } else {
        console.error('Webhook verification failed', { mode, token });
        return new Response('Forbidden', { status: 403, headers: corsHeaders });
      }
    }

    // POST: Detect provider by content-type
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/x-www-form-urlencoded')) {
      // ========== TWILIO FORMAT ==========
      const rawFormData = await req.text();
      const params = new URLSearchParams(rawFormData);
      const paramsObj = Object.fromEntries(params.entries());

      if (TWILIO_AUTH_TOKEN) {
        const twilioSignature = req.headers.get('X-Twilio-Signature') || '';
        if (twilioSignature) {
          const webhookUrl = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;
          const isValid = await validateTwilioSignature(TWILIO_AUTH_TOKEN, twilioSignature, webhookUrl, paramsObj);
          if (!isValid) {
            await logWebhook({
              stage: 'twilio_signature_validation',
              status: 'error',
              error: 'invalid_signature',
              payload: { has_signature: true },
            });
            return new Response('<Response></Response>', {
              status: 403,
              headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
            });
          }
        }
      }

      const from = params.get('From') || '';
      const to = params.get('To') || '';
      const body = params.get('Body') || '';
      const messageSid = params.get('MessageSid') || params.get('SmsSid') || '';
      const messageStatus = params.get('MessageStatus') || params.get('SmsStatus') || '';
      const errorCode = params.get('ErrorCode') || '';
      const errorMessage = params.get('ErrorMessage') || '';
      const numMedia = parseInt(params.get('NumMedia') || '0', 10);
      const profileName = params.get('ProfileName') || '';
      const mediaContentType = params.get('MediaContentType0') || '';

      const contactPhone = from.replace('whatsapp:', '');
      const businessPhone = to.replace('whatsapp:', '');
      const contactName = profileName || contactPhone;

      const isDeliveryCallback = Boolean(messageStatus) && !body && numMedia === 0;
      const isVoiceMessage = numMedia > 0 && mediaContentType.startsWith('audio/');
      console.log(`[WH] from=${contactPhone} to=${businessPhone} status=${messageStatus || 'n/a'} body_len=${body.length} media=${numMedia}`);

      // Get media URL if present
      let mediaUrl: string | null = null;
      if (numMedia > 0) {
        mediaUrl = params.get('MediaUrl0') || null;
      }

      // Delivery status callback for outbound messages
      if (isDeliveryCallback && messageSid) {
        const normalizedStatus = (
          messageStatus === 'delivered' ? 'delivered' :
          messageStatus === 'read' ? 'read' :
          messageStatus === 'sent' ? 'sent' :
          messageStatus === 'queued' ? 'queued' :
          (messageStatus === 'failed' || messageStatus === 'undelivered') ? 'failed' :
          messageStatus || 'sent'
        );

        const { data: dbMessage } = await supabase
          .from('whatsapp_messages')
          .select('id, metadata')
          .contains('metadata', { message_sid: messageSid })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (dbMessage) {
          const currentMeta = (dbMessage.metadata as Record<string, unknown> | null) || {};
          await supabase
            .from('whatsapp_messages')
            .update({
              status: normalizedStatus,
              metadata: {
                ...currentMeta,
                twilio_status: messageStatus,
                twilio_error_code: errorCode || null,
                twilio_error_message: errorMessage || null,
                twilio_status_updated_at: new Date().toISOString(),
              },
            })
            .eq('id', dbMessage.id);
        }

        await logWebhook({
          stage: 'delivery_callback',
          status: 'ok',
          messageId: messageSid,
          payload: { message_status: messageStatus, normalized_status: normalizedStatus, error_code: errorCode || null },
        });
        return new Response('<Response></Response>', {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
        });
      }

      // Resolve tenant by matching business phone
      let tenantId: string | null = null;
      let tenantFromNumber: string | null = null;
      let callbackFromBusinessNumber = false;

      const { data: tenants } = await supabase
        .from('tenants')
        .select('id, whatsapp_config')
        .not('whatsapp_config', 'is', null);

      if (tenants) {
        for (const t of tenants) {
          const config = t.whatsapp_config as any;
          if (!config?.phone_number) continue;

          const configPhone = String(config.phone_number).replace('whatsapp:', '');

          if (configPhone === businessPhone) {
            tenantId = t.id;
            tenantFromNumber = configPhone;
            break;
          }

          if (configPhone === contactPhone) {
            tenantId = t.id;
            tenantFromNumber = configPhone;
            callbackFromBusinessNumber = true;
            break;
          }
        }
      }

      if (!tenantId) {
        await logWebhook({
          stage: 'tenant_resolution',
          status: 'skip',
          messageId: messageSid,
          payload: { from: contactPhone, to: businessPhone, reason: 'tenant_not_found' },
        });
        console.error('[WH] No tenant found for phone', businessPhone);
        return new Response('<Response></Response>', {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
        });
      }

      // Callback without body from business number
      if (callbackFromBusinessNumber && !body && messageSid) {
        const { data: dbMessage } = await supabase
          .from('whatsapp_messages')
          .select('id, metadata')
          .contains('metadata', { message_sid: messageSid })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (dbMessage) {
          const currentMeta = (dbMessage.metadata as Record<string, unknown> | null) || {};
          await supabase
            .from('whatsapp_messages')
            .update({
              metadata: {
                ...currentMeta,
                twilio_callback_detected: true,
                twilio_callback_at: new Date().toISOString(),
              },
            })
            .eq('id', dbMessage.id);
        }

        return new Response('<Response></Response>', {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
        });
      }

      // Find or create conversation
      let { data: conversation } = await supabase
        .from('whatsapp_conversations')
        .select('id')
        .eq('contact_phone', contactPhone)
        .eq('tenant_id', tenantId)
        .neq('status', 'closed')
        .limit(1)
        .single();

      if (!conversation) {
        const { data: newConv } = await supabase
          .from('whatsapp_conversations')
          .insert({
            tenant_id: tenantId,
            contact_phone: contactPhone,
            contact_name: contactName,
            status: 'open',
            last_message_at: new Date().toISOString(),
          })
          .select('id')
          .single();
        conversation = newConv;
      } else {
        await supabase
          .from('whatsapp_conversations')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', conversation.id);
      }

      if (conversation) {
        // Idempotency check
        if (messageSid) {
          const { data: existingInbound } = await supabase
            .from('whatsapp_messages')
            .select('id')
            .eq('conversation_id', conversation.id)
            .eq('direction', 'in')
            .contains('metadata', { message_sid: messageSid })
            .maybeSingle();

          if (existingInbound) {
            await logWebhook({
              tenantId,
              conversationId: conversation.id,
              messageId: messageSid,
              stage: 'inbound_dedup',
              status: 'skip',
            });
            return new Response('<Response></Response>', {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
            });
          }
        }

        await supabase.from('whatsapp_messages').insert({
          tenant_id: tenantId,
          conversation_id: conversation.id,
          direction: 'in',
          body: body || (isVoiceMessage ? '🎤 [Mensaje de voz]' : ''),
          media_url: mediaUrl,
          status: 'received',
          metadata: { message_sid: messageSid, provider: 'twilio', profile_name: profileName, is_voice: isVoiceMessage || undefined, media_content_type: mediaContentType || undefined },
        });

        await supabase.from('audit_events').insert({
          tenant_id: tenantId,
          event_type: 'whatsapp.message_received',
          resource_type: 'whatsapp_message',
          resource_id: messageSid,
          payload: { from: contactPhone, provider: 'twilio', preview: body ? body.substring(0, 100) : (isVoiceMessage ? '[Mensaje de voz]' : ''), is_voice: isVoiceMessage },
        });

        await logWebhook({
          tenantId,
          conversationId: conversation.id,
          messageId: messageSid,
          stage: 'inbound_saved',
          status: 'ok',
        });

        // Trigger AI bot using SERVICE_ROLE_KEY (not anon key) to bypass JWT verification
        try {
          const botUrl = `${SUPABASE_URL}/functions/v1/whatsapp-bot`;
          console.log(`[WH] Triggering bot for conv=${conversation.id} tenant=${tenantId}`);
          const botRes = await fetch(botUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
              conversationId: conversation.id,
              messageBody: body || (isVoiceMessage ? '' : body),
              contactPhone: contactPhone,
              tenantId: tenantId,
              mediaUrl: mediaUrl,
              mediaContentType: mediaContentType || undefined,
            }),
          });

          const botResponseText = await botRes.text();
          if (!botRes.ok) {
            console.error(`[WH] Bot error (${botRes.status}): ${botResponseText.substring(0, 300)}`);
            await logWebhook({
              tenantId,
              conversationId: conversation.id,
              messageId: messageSid,
              stage: 'bot_invocation',
              status: 'error',
              error: `HTTP ${botRes.status}: ${botResponseText.substring(0, 200)}`,
            });
          } else {
            console.log(`[WH] Bot OK: ${botResponseText.substring(0, 200)}`);
            await logWebhook({
              tenantId,
              conversationId: conversation.id,
              messageId: messageSid,
              stage: 'bot_invocation',
              status: 'ok',
              payload: { response_length: botResponseText.length },
            });
          }
        } catch (botErr) {
          console.error('[WH] Bot trigger exception:', botErr);
          await logWebhook({
            tenantId,
            conversationId: conversation.id,
            messageId: messageSid,
            stage: 'bot_invocation',
            status: 'error',
            error: botErr instanceof Error ? botErr.message : 'Unknown bot error',
          });
        }
      }

      return new Response('<Response></Response>', {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
      });

    } else {
      // ========== META CLOUD API FORMAT ==========
      const jsonBody = await req.json();
      const { entry } = jsonBody;

      if (!entry || !Array.isArray(entry)) {
        return new Response(JSON.stringify({ error: 'Invalid webhook payload' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      for (const e of entry) {
        const changes = e.changes || [];
        for (const change of changes) {
          if (change.field !== 'messages') continue;

          const value = change.value;
          const messages = value.messages || [];
          const contacts = value.contacts || [];

          for (const msg of messages) {
            const contactPhone = msg.from;
            const contactName = contacts.find((c: any) => c.wa_id === contactPhone)?.profile?.name || 'Desconocido';
            const messageBody = msg.text?.body || msg.caption || '';
            const mediaUrl = msg.image?.id || msg.document?.id || null;

            // Resolve tenant from phone_number_id (strict — NO fallback)
            const phoneNumberId = value.metadata?.phone_number_id;
            let tenantId: string | null = null;

            const { data: tenants } = await supabase
              .from('tenants')
              .select('id, whatsapp_config')
              .not('whatsapp_config', 'is', null);

            if (tenants) {
              for (const t of tenants) {
                const config = t.whatsapp_config as any;
                if (config?.phone_number_id === phoneNumberId) {
                  tenantId = t.id;
                  break;
                }
              }
            }

            if (!tenantId) {
              console.error(`[WH-Meta] No tenant for phone_number_id=${phoneNumberId}`);
              await logWebhook({
                stage: 'meta_tenant_resolution',
                status: 'skip',
                messageId: msg.id,
                payload: { phone_number_id: phoneNumberId, reason: 'tenant_not_found' },
              });
              continue;
            }

            let { data: conversation } = await supabase
              .from('whatsapp_conversations')
              .select('id')
              .eq('contact_phone', contactPhone)
              .eq('tenant_id', tenantId)
              .neq('status', 'closed')
              .limit(1)
              .single();

            if (!conversation) {
              const { data: newConv } = await supabase
                .from('whatsapp_conversations')
                .insert({
                  tenant_id: tenantId,
                  contact_phone: contactPhone,
                  contact_name: contactName,
                  status: 'open',
                  last_message_at: new Date().toISOString(),
                })
                .select('id')
                .single();
              conversation = newConv;
            } else {
              await supabase
                .from('whatsapp_conversations')
                .update({ last_message_at: new Date().toISOString() })
                .eq('id', conversation.id);
            }

            if (conversation) {
              await supabase.from('whatsapp_messages').insert({
                tenant_id: tenantId,
                conversation_id: conversation.id,
                direction: 'in',
                body: messageBody,
                media_url: mediaUrl,
                status: 'received',
                metadata: { wa_message_id: msg.id, type: msg.type, provider: 'meta' },
              });

              await supabase.from('audit_events').insert({
                tenant_id: tenantId,
                event_type: 'whatsapp.message_received',
                resource_type: 'whatsapp_message',
                resource_id: msg.id,
                payload: { from: contactPhone, provider: 'meta', preview: messageBody.substring(0, 100) },
              });

              // Trigger AI bot with SERVICE_ROLE_KEY
              try {
                const botUrl = `${SUPABASE_URL}/functions/v1/whatsapp-bot`;
                const botRes = await fetch(botUrl, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                  },
                  body: JSON.stringify({
                    conversationId: conversation.id,
                    messageBody: messageBody,
                    contactPhone: contactPhone,
                    tenantId: tenantId,
                    mediaUrl: mediaUrl,
                  }),
                });

                if (!botRes.ok) {
                  const botErr = await botRes.text();
                  console.error(`[WH-Meta] Bot error (${botRes.status}): ${botErr.substring(0, 200)}`);
                }
              } catch (botErr) {
                console.error('[WH-Meta] Bot trigger failed:', botErr);
              }
            }
          }
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WH] Fatal error:', errorMessage);
    // Always return 200 for webhooks to prevent retry storms
    return new Response('<Response></Response>', {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
    });
  }
});
