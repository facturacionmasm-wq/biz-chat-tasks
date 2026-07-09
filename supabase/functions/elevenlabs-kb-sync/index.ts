import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { resolveTenantAgentId, MASTER_TENANT } from "../_shared/elevenlabs-agent.ts";
import { cacheInvalidate } from "../_shared/cache.ts";


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

  const jwtUserId = claimsData.claims.sub as string;

  const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
  if (!ELEVENLABS_API_KEY) {
    return new Response(JSON.stringify({ error: 'ElevenLabs not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { action, data } = await req.json();

    // Resolve caller tenant
    const { data: callerTenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: jwtUserId });
    if (!callerTenantId) {
      return new Response(JSON.stringify({ error: 'Tenant no encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Body-level tenant guard: reject cross-tenant tampering
    if (data?.tenant_id && data.tenant_id !== callerTenantId) {
      return new Response(JSON.stringify({ error: 'Forbidden: tenant mismatch' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve the tenant's ElevenLabs agent (per-tenant, with lazy master fallback)
    const { agentId, source } = await resolveTenantAgentId(supabase, callerTenantId);

    // If the resolved agent is still the shared global one (only possible for
    // master tenant via lazy backfill), keep the cross-tenant safety gate ON
    // for non-master tenants that somehow reach here without their own agent.
    if (!agentId) {
      return new Response(JSON.stringify({
        error: 'Este tenant no tiene un agente de voz aprovisionado. Aprovisiona tu agente de voz en Ajustes.',
        code: 'no_tenant_agent',
      }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Extra defence: for non-master tenants the resolved agent MUST come from
    // their own row — never from the global env fallback.
    if (callerTenantId !== MASTER_TENANT && source !== 'tenant') {
      return new Response(JSON.stringify({
        error: 'Cross-tenant safety gate: falling back to shared agent is disabled.',
        code: 'kb_sync_disabled_shared_agent',
        action,
      }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const headers = {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    };

    if (action === 'list') {
      const res = await fetch(`${ELEVENLABS_API_URL}/convai/agents/${agentId}/knowledge-base`, { headers });
      const body = await res.text();
      if (!res.ok) {
        console.error(`[kb-sync] list failed [${res.status}]: ${body}`);
        return new Response(JSON.stringify({ error: 'ElevenLabs list failed', status: res.status, details: body }), {
          status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(body, { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'add') {
      const res = await fetch(`${ELEVENLABS_API_URL}/convai/agents/${agentId}/knowledge-base`, {
        method: 'POST', headers, body: JSON.stringify(data || {}),
      });
      const body = await res.text();
      if (!res.ok) {
        console.error(`[kb-sync] add failed [${res.status}]: ${body}`);
        return new Response(JSON.stringify({ error: 'ElevenLabs add failed', status: res.status, details: body }), {
          status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Audit
      try {
        const parsed = body ? JSON.parse(body) : {};
        await supabase.from('audit_events').insert({
          tenant_id: callerTenantId,
          event_type: 'knowledge.synced_to_elevenlabs',
          actor_id: jwtUserId,
          resource_type: 'elevenlabs_kb',
          resource_id: parsed.id || parsed.document_id || null,
          payload: { agent_id: agentId },
        });
      } catch { /* audit best-effort */ }

      // KB changed — invalidate all cached RAG results for this tenant.
      cacheInvalidate(`rag:${callerTenantId}:`).catch(() => {});

      return new Response(body, { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }


    if (action === 'delete') {
      const docId = data?.document_id || data?.id;
      if (!docId) {
        return new Response(JSON.stringify({ error: 'document_id required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const res = await fetch(`${ELEVENLABS_API_URL}/convai/agents/${agentId}/knowledge-base/${docId}`, {
        method: 'DELETE', headers,
      });
      const body = await res.text();
      if (!res.ok) {
        console.error(`[kb-sync] delete failed [${res.status}]: ${body}`);
        return new Response(JSON.stringify({ error: 'ElevenLabs delete failed', status: res.status, details: body }), {
          status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // KB changed — invalidate all cached RAG results for this tenant.
      cacheInvalidate(`rag:${callerTenantId}:`).catch(() => {});
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
