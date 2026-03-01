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

  const { data, error } = await anonClient.auth.getClaims(authHeader.replace('Bearer ', ''));
  if (error || !data?.claims) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userId = data.claims.sub as string;

  const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
  const ELEVENLABS_AGENT_ID = Deno.env.get('ELEVENLABS_AGENT_ID');

  if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
    return new Response(JSON.stringify({ error: 'ElevenLabs not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Fetch Knowledge Hub for dynamic context injection
    const serviceClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('tenant_id, name')
      .eq('user_id', userId)
      .maybeSingle();

    let knowledgeContext = '';
    let companyName = '';

    if (profile?.tenant_id) {
      // Get company name
      const { data: tenant } = await serviceClient
        .from('tenants')
        .select('name')
        .eq('id', profile.tenant_id)
        .single();
      companyName = tenant?.name || '';

      // Training corrections (highest priority)
      const { data: corrections } = await serviceClient
        .from('knowledge_items')
        .select('title, content, category')
        .eq('tenant_id', profile.tenant_id)
        .eq('active', true)
        .eq('category', 'Entrenamiento IA')
        .order('updated_at', { ascending: false })
        .limit(15);

      // General knowledge
      const { data: generalKnowledge } = await serviceClient
        .from('knowledge_items')
        .select('title, content, category')
        .eq('tenant_id', profile.tenant_id)
        .eq('active', true)
        .neq('category', 'Entrenamiento IA')
        .order('updated_at', { ascending: false })
        .limit(20);

      const allKnowledge = [...(corrections || []), ...(generalKnowledge || [])];
      
      if (allKnowledge.length > 0) {
        knowledgeContext = allKnowledge.map(k => {
          const prefix = k.category === 'Entrenamiento IA' ? '⚠️ CORRECCIÓN PRIORITARIA' : (k.category || 'General');
          const content = k.category === 'Entrenamiento IA' ? k.content : k.content?.substring(0, 600);
          return `[${prefix}] ${k.title}: ${content}`;
        }).join('\n\n');
      }
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${ELEVENLABS_AGENT_ID}`,
      { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API error [${response.status}]: ${errorText}`);
    }

    const { token } = await response.json();

    return new Response(JSON.stringify({ 
      token, 
      knowledgeContext, 
      companyName,
      userName: profile?.name || '',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Token generation error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
