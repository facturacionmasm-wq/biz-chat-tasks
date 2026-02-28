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
      const formData = await req.text();
      const params = new URLSearchParams(formData);

      const from = params.get('From') || '';       // e.g. "whatsapp:+5215512345678"
      const to = params.get('To') || '';           // e.g. "whatsapp:+12135132649"
      const body = params.get('Body') || '';
      const messageSid = params.get('MessageSid') || params.get('SmsSid') || '';
      const messageStatus = params.get('MessageStatus') || params.get('SmsStatus') || '';
      const errorCode = params.get('ErrorCode') || '';
      const errorMessage = params.get('ErrorMessage') || '';
      const numMedia = parseInt(params.get('NumMedia') || '0', 10);
      const profileName = params.get('ProfileName') || '';
      const mediaContentType = params.get('MediaContentType0') || '';

      // Clean phone numbers (remove "whatsapp:" prefix)
      const contactPhone = from.replace('whatsapp:', '');
      const businessPhone = to.replace('whatsapp:', '');
      const contactName = profileName || contactPhone;

      const isDeliveryCallback = Boolean(messageStatus) && !body && numMedia === 0;
      const isVoiceMessage = numMedia > 0 && mediaContentType.startsWith('audio/');
      console.log(`Twilio webhook from ${contactPhone} to ${businessPhone} status=${messageStatus || 'n/a'} body_len=${body.length} media=${numMedia} type=${mediaContentType}`);

      if (!body && numMedia === 0) {
        const payload = Object.fromEntries(params.entries());
        console.log(`Twilio empty-body callback keys=${Object.keys(payload).join(',')}`);
        console.log(`Twilio empty-body callback flags: SmsStatus=${params.get('SmsStatus') || ''} MessageStatus=${params.get('MessageStatus') || ''} EventType=${params.get('EventType') || ''} MessageSid=${params.get('MessageSid') || ''} SmsSid=${params.get('SmsSid') || ''}`);
      }

      // Get media URL if present
      let mediaUrl: string | null = null;
      if (numMedia > 0) {
        mediaUrl = params.get('MediaUrl0') || null;
      }

      // Delivery status callback for outbound messages (do not create inbound conversations)
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

        console.log(`Twilio delivery callback sid=${messageSid} status=${messageStatus} errorCode=${errorCode || 'none'}`);
        return new Response('<Response></Response>', {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
        });
      }

      // Resolve tenant by matching business phone in either direction
      let tenantId: string | null = null;
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

          // Normal inbound message: customer -> business
          if (configPhone === businessPhone) {
            tenantId = t.id;
            break;
          }

          // Outbound callback: business -> customer (empty body usually)
          if (configPhone === contactPhone) {
            tenantId = t.id;
            callbackFromBusinessNumber = true;
            break;
          }
        }
      }

      // Fallback to first tenant if none matched
      if (!tenantId) {
        const { data: firstTenant } = await supabase
          .from('tenants')
          .select('id')
          .limit(1)
          .single();
        tenantId = firstTenant?.id || null;
      }

      if (!tenantId) {
        console.error('No tenant found for this WhatsApp number');
        // Still return 200 to Twilio so it doesn't retry
        return new Response('<Response></Response>', {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
        });
      }

      // Twilio can send callbacks without MessageStatus; prevent false inbound inserts
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

        console.log(`Twilio callback without status sid=${messageSid} from business number`);
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

        console.log(`Message saved: conv=${conversation.id}`);

        // Trigger AI bot auto-reply
        try {
          const botUrl = `${SUPABASE_URL}/functions/v1/whatsapp-bot`;
          const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
          fetch(botUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${anonKey}`,
            },
            body: JSON.stringify({
              conversationId: conversation.id,
              messageBody: body || (isVoiceMessage ? '' : body),
              contactPhone: contactPhone,
              tenantId: tenantId,
              mediaUrl: mediaUrl,
              mediaContentType: mediaContentType || undefined,
            }),
          }).catch(err => console.error('Bot trigger error:', err));
        } catch (botErr) {
          console.error('Failed to trigger bot:', botErr);
        }
      }

      // Return TwiML empty response (Twilio expects XML)
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

            // Resolve tenant from phone_number_id
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
              const { data: firstTenant } = await supabase
                .from('tenants')
                .select('id')
                .limit(1)
                .single();
              tenantId = firstTenant?.id || null;
            }

            if (!tenantId) continue;

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

              // Trigger AI bot auto-reply
              try {
                const botUrl = `${SUPABASE_URL}/functions/v1/whatsapp-bot`;
                const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
                fetch(botUrl, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${anonKey}`,
                  },
                  body: JSON.stringify({
                    conversationId: conversation.id,
                    messageBody: messageBody,
                    contactPhone: contactPhone,
                    tenantId: tenantId,
                    mediaUrl: mediaUrl,
                  }),
                }).catch(err => console.error('Bot trigger error:', err));
              } catch (botErr) {
                console.error('Failed to trigger bot:', botErr);
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
    console.error('WhatsApp webhook error:', errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
