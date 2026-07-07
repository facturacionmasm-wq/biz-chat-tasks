import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { resolveTenantAgentId } from "../_shared/elevenlabs-agent.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
  const GLOBAL_AGENT_ID = Deno.env.get('ELEVENLABS_AGENT_ID');

  if (!ELEVENLABS_API_KEY) {
    return new Response(JSON.stringify({ error: 'ElevenLabs not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await anonClient.auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Resolve tenant + validate role (owner or super_admin)
    const { data: tenantId, error: tErr } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
    if (tErr || !tenantId) {
      return new Response(JSON.stringify({ error: 'Tenant no encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);
    const hasOwner = (roles ?? []).some((r: any) => r.role === 'owner' || r.role === 'super_admin');
    if (!hasOwner) {
      return new Response(JSON.stringify({ error: 'Solo el owner puede aprovisionar el agente' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If already provisioned, return it
    const existing = await resolveTenantAgentId(supabase, tenantId);
    if (existing.agentId) {
      return new Response(JSON.stringify({
        agent_id: existing.agentId,
        already_provisioned: true,
        source: existing.source,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Load tenant name + clone base prompt from the global agent if available
    const { data: tenant } = await supabase.from('tenants').select('name, elevenlabs_config').eq('id', tenantId).single();
    const agentName = `OfficeHub - ${tenant?.name || 'Cliente'}`;

    let basePrompt = 'Eres un asistente de voz profesional y amable.';
    let baseFirstMessage = '';
    let baseLanguage = 'es';
    let baseVoiceId: string | undefined;
    let baseLlm: string | undefined;

    if (GLOBAL_AGENT_ID) {
      try {
        const baseRes = await fetch(`${ELEVENLABS_API_URL}/convai/agents/${GLOBAL_AGENT_ID}`, {
          headers: { 'xi-api-key': ELEVENLABS_API_KEY },
        });
        if (baseRes.ok) {
          const baseData = await baseRes.json();
          const cfg = baseData?.conversation_config ?? baseData;
          basePrompt = cfg?.agent?.prompt?.prompt || basePrompt;
          baseFirstMessage = cfg?.agent?.first_message || '';
          baseLanguage = cfg?.agent?.language || 'es';
          baseVoiceId = cfg?.tts?.voice_id;
          baseLlm = cfg?.agent?.prompt?.llm;
        } else {
          console.warn('[agent-provision] Base agent fetch failed:', baseRes.status);
        }
      } catch (e) {
        console.warn('[agent-provision] Base agent clone skipped:', (e as Error).message);
      }
    }

    // Build create payload
    const conversationConfig: any = {
      agent: {
        prompt: { prompt: basePrompt },
        first_message: baseFirstMessage,
        language: baseLanguage,
      },
    };
    if (baseVoiceId) conversationConfig.tts = { voice_id: baseVoiceId };
    if (baseLlm) conversationConfig.agent.prompt.llm = baseLlm;

    const createRes = await fetch(`${ELEVENLABS_API_URL}/convai/agents/create`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: agentName, conversation_config: conversationConfig }),
    });

    if (!createRes.ok) {
      const errBody = await createRes.text();
      console.error(`[agent-provision] ElevenLabs create failed [${createRes.status}]: ${errBody}`);
      return new Response(JSON.stringify({
        error: 'ElevenLabs create failed',
        status: createRes.status,
        details: errBody,
      }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const created = await createRes.json();
    const newAgentId: string = created.agent_id || created.id;
    if (!newAgentId) {
      return new Response(JSON.stringify({ error: 'ElevenLabs response missing agent_id' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Persist in tenants.elevenlabs_config
    const prevCfg = (tenant?.elevenlabs_config ?? {}) as Record<string, unknown>;
    const nextCfg = { ...prevCfg, agent_id: newAgentId, provisioned_at: new Date().toISOString() };
    const { error: upErr } = await supabase
      .from('tenants')
      .update({ elevenlabs_config: nextCfg })
      .eq('id', tenantId);
    if (upErr) {
      console.error('[agent-provision] Persist error:', upErr);
      return new Response(JSON.stringify({ error: 'Failed to persist agent_id', details: upErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabase.from('audit_events').insert({
      tenant_id: tenantId,
      event_type: 'elevenlabs.agent_provisioned',
      actor_id: user.id,
      resource_type: 'elevenlabs_agent',
      resource_id: newAgentId,
      payload: { agent_name: agentName, cloned_from: GLOBAL_AGENT_ID || null },
    });

    return new Response(JSON.stringify({
      agent_id: newAgentId,
      already_provisioned: false,
      source: 'tenant',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[agent-provision] Fatal:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
