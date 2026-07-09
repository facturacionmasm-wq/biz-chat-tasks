// Shared helper to resolve the ElevenLabs agent for a given tenant.
// Uses tenants.elevenlabs_config->>agent_id (Option A, no schema change).
// For the master tenant we lazy-backfill from the global ELEVENLABS_AGENT_ID
// env so existing deployments keep working during the rollout.

const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001';

// Hard cap on any ElevenLabs conversation. ElevenLabs typically caps at 1800s
// (30 min) on all plans; keep both provision + staff-sync pinned to this.
export const MAX_CALL_DURATION_SECONDS = 1800;

// Instruction block appended to every tenant agent prompt so the agent
// ALWAYS asks "algo más" and delivers a farewell before hanging up.
export const AGENT_CLOSING_BLOCK_START = '<!-- AGENT_CLOSING_BLOCK_START -->';
export const AGENT_CLOSING_BLOCK_END = '<!-- AGENT_CLOSING_BLOCK_END -->';
export const AGENT_CLOSING_INSTRUCTIONS = `${AGENT_CLOSING_BLOCK_START}
CIERRE DE LLAMADA (OBLIGATORIO):
- Después de agendar, reagendar, cancelar o confirmar una cita, y en general al terminar cualquier tarea, DEBES preguntar textualmente: "Perfecto, tu cita quedó agendada. ¿Hay algo más en lo que pueda ayudarte?" (adapta ligeramente el verbo si fue reagendar/cancelar/confirmar).
- Si el cliente pide algo más, atiéndelo.
- Solo cuando el cliente diga que NO necesita nada más, despídete con: "Con gusto, que tengas excelente día." y termina la llamada.
- NUNCA cuelgues de golpe después de confirmar una cita sin hacer la pregunta y despedirte.
${AGENT_CLOSING_BLOCK_END}`;

export function upsertAgentClosingBlock(prompt: string): string {
  const startIdx = prompt.indexOf(AGENT_CLOSING_BLOCK_START);
  const endIdx = prompt.indexOf(AGENT_CLOSING_BLOCK_END);
  if (startIdx >= 0 && endIdx > startIdx) {
    const before = prompt.slice(0, startIdx).trimEnd();
    const after = prompt.slice(endIdx + AGENT_CLOSING_BLOCK_END.length).trimStart();
    return [before, AGENT_CLOSING_INSTRUCTIONS, after].filter(Boolean).join('\n\n');
  }
  return `${prompt.trimEnd()}\n\n${AGENT_CLOSING_INSTRUCTIONS}`;
}

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
