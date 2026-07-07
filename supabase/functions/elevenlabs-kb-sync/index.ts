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

  // Require authenticated user
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(authHeader.replace('Bearer ', ''));
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
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

    // CROSS-TENANT SAFETY GATE for `list`, `add`, `delete`:
    // A single ELEVENLABS_AGENT_ID is shared across all tenants. Any KB
    // read/write against that shared agent would leak or destroy knowledge
    // belonging to other tenants. Per-tenant RAG is served via the
    // `document-search` edge function and `knowledge_items` queries (both
    // filtered by tenant_id). Block until per-tenant agents are provisioned.
    if (action === 'list' || action === 'add' || action === 'delete') {
      return new Response(
        JSON.stringify({
          error: 'Cross-tenant safety gate: KB operations against the shared ElevenLabs agent are disabled. Per-tenant knowledge is served via document-search.',
          code: 'kb_sync_disabled_shared_agent',
          action,
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
