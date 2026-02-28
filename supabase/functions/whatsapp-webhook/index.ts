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

      // Retrieve verify token from tenant config or use env
      const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN') || 'lovable_wa_verify';

      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('Webhook verified successfully');
        return new Response(challenge, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
        });
      } else {
        console.error('Webhook verification failed', { mode, token });
        return new Response('Forbidden', {
          status: 403,
          headers: corsHeaders,
        });
      }
    }

    // POST: incoming message
    const body = await req.json();
    const { entry } = body;

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

          // TODO: resolve tenant_id from the WhatsApp business number
          // For now, we use a placeholder approach
          const tenantId = value.metadata?.phone_number_id; // This would be mapped to tenant

          // Find or create conversation
          let { data: conversation } = await supabase
            .from('whatsapp_conversations')
            .select('id')
            .eq('contact_phone', contactPhone)
            .eq('status', 'open')
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
            // Save message
            await supabase.from('whatsapp_messages').insert({
              tenant_id: tenantId,
              conversation_id: conversation.id,
              direction: 'in',
              body: messageBody,
              media_url: mediaUrl,
              status: 'received',
              metadata: { wa_message_id: msg.id, type: msg.type },
            });

            // Log audit
            await supabase.from('audit_events').insert({
              tenant_id: tenantId,
              event_type: 'whatsapp.message_received',
              resource_type: 'whatsapp_message',
              resource_id: msg.id,
              payload: { from: contactPhone, preview: messageBody.substring(0, 100) },
            });
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('WhatsApp webhook error:', errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
