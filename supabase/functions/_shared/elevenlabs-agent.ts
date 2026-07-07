// Shared helper to resolve the ElevenLabs agent for a given tenant.
// Uses tenants.elevenlabs_config->>agent_id (Option A, no schema change).
// For the master tenant we lazy-backfill from the global ELEVENLABS_AGENT_ID
// env so existing deployments keep working during the rollout.

const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export interface ResolvedAgent {
  agentId: string | null;
  source: 'tenant' | 'master_fallback' | 'none';
}

export async function resolveTenantAgentId(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tenantId: string | null | undefined,
): Promise<ResolvedAgent> {
  if (!tenantId) return { agentId: null, source: 'none' };

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, elevenlabs_config')
    .eq('id', tenantId)
    .maybeSingle();

  const cfg = (tenant?.elevenlabs_config ?? {}) as Record<string, unknown>;
  const stored = typeof cfg.agent_id === 'string' && cfg.agent_id.length > 0
    ? String(cfg.agent_id)
    : null;
  if (stored) return { agentId: stored, source: 'tenant' };

  // Lazy backfill: only the master tenant may inherit the shared global agent.
  if (tenantId === MASTER_TENANT_ID) {
    const globalAgent = Deno.env.get('ELEVENLABS_AGENT_ID');
    if (globalAgent) {
      const nextCfg = { ...cfg, agent_id: globalAgent };
      await supabase
        .from('tenants')
        .update({ elevenlabs_config: nextCfg })
        .eq('id', tenantId);
      return { agentId: globalAgent, source: 'master_fallback' };
    }
  }

  return { agentId: null, source: 'none' };
}

export const MASTER_TENANT = MASTER_TENANT_ID;
