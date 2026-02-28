import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
  const ELEVENLABS_AGENT_ID = Deno.env.get('ELEVENLABS_AGENT_ID');

  if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
    return new Response(JSON.stringify({ error: 'ElevenLabs not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { action, data } = await req.json();
    const headers = {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    };

    // List current KB docs from ElevenLabs
    if (action === 'list') {
      const res = await fetch(
        `${ELEVENLABS_API_URL}/convai/agents/${ELEVENLABS_AGENT_ID}/knowledge-base`,
        { headers }
      );
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`ElevenLabs list KB error [${res.status}]: ${err}`);
      }
      const result = await res.json();
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Add a document to ElevenLabs KB
    if (action === 'add') {
      const { title, content, knowledge_item_id } = data;

      // Use multipart form for text document upload
      const formData = new FormData();
      const blob = new Blob([content], { type: 'text/plain' });
      formData.append('file', blob, `${title}.txt`);

      const res = await fetch(
        `${ELEVENLABS_API_URL}/convai/agents/${ELEVENLABS_AGENT_ID}/add-to-knowledge-base`,
        {
          method: 'POST',
          headers: { 'xi-api-key': ELEVENLABS_API_KEY },
          body: formData,
        }
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`ElevenLabs add KB error [${res.status}]: ${err}`);
      }

      const result = await res.json();

      // Store the ElevenLabs doc ID in our knowledge_items metadata
      if (knowledge_item_id && result.id) {
        // We store the elevenlabs doc id in settings_json or extracted_data
        // For now, log it for audit
        await supabase.from('audit_events').insert({
          tenant_id: data.tenant_id,
          event_type: 'knowledge.synced_to_elevenlabs',
          resource_type: 'knowledge_item',
          resource_id: knowledge_item_id,
          payload: { elevenlabs_doc_id: result.id, title },
        });
      }

      return new Response(JSON.stringify({ success: true, elevenlabs_doc_id: result.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Delete a document from ElevenLabs KB
    if (action === 'delete') {
      const { elevenlabs_doc_id } = data;

      const res = await fetch(
        `${ELEVENLABS_API_URL}/convai/agents/${ELEVENLABS_AGENT_ID}/knowledge-base/${elevenlabs_doc_id}`,
        { method: 'DELETE', headers }
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`ElevenLabs delete KB error [${res.status}]: ${err}`);
      }

      await res.text(); // consume body

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('ElevenLabs KB sync error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
