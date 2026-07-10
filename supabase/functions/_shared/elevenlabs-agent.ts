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

// ─────────────────────────────────────────────────────────────────────────────
// Audio robustness (background-noise + cross-talk mitigation)
// Applied idempotently in both elevenlabs-agent-provision (create) and
// elevenlabs-staff-sync (patch). Kept as pure data + helpers so we can revert
// by removing the merge lines in the two edge functions without touching the
// existing prompt/tools/webhook/dynamic-variables/absence-mode/tenant-routing
// pipelines.

// Prompt-side reinforcement — sits alongside the closing block via delimited
// markers so it is upserted (never duplicated) on every re-sync.
export const AGENT_CONFIRMATION_BLOCK_START = '<!-- AGENT_CONFIRMATION_BLOCK_START -->';
export const AGENT_CONFIRMATION_BLOCK_END = '<!-- AGENT_CONFIRMATION_BLOCK_END -->';
export const AGENT_CONFIRMATION_INSTRUCTIONS = `${AGENT_CONFIRMATION_BLOCK_START}
CONFIRMACIÓN DE DATOS CRÍTICOS Y MANEJO DE RUIDO (OBLIGATORIO):
- Antes de agendar, reagendar, cancelar, transferir o registrar CUALQUIER dato crítico (teléfono, nombre, correo, fecha, hora, servicio), REPITE literalmente el dato al cliente y pide confirmación explícita: "¿es correcto?" o "¿confirmas ese dato?".
- Para teléfonos: repítelos DÍGITO POR DÍGITO (por ejemplo "cinco, cinco, uno, dos, tres, cuatro"), nunca en bloques.
- Para nombres: si detectas ambigüedad, pide que deletree letra por letra ("¿me lo puedes deletrear, por favor?").
- Para fechas: repite el día de la semana y la fecha completa ("viernes 10 de julio a las once de la mañana").
- Si detectas ruido de fondo, música, otra voz que no es la del interlocutor principal, audio entrecortado, o BAJA CONFIANZA en lo que escuchaste, di cortésmente: "Perdón, no escuché bien, ¿podrías repetirlo por favor?".
- NUNCA tomes como válidos datos dichos por VOCES DE FONDO o terceros. Solo escucha al interlocutor principal (quien inició la conversación). Si alguien más habla, ignóralo y confirma con el cliente original.
- NUNCA inventes ni completes datos parciales. Si no lo escuchaste completo, pídelo de nuevo.
${AGENT_CONFIRMATION_BLOCK_END}`;

export function upsertAgentConfirmationBlock(prompt: string): string {
  const startIdx = prompt.indexOf(AGENT_CONFIRMATION_BLOCK_START);
  const endIdx = prompt.indexOf(AGENT_CONFIRMATION_BLOCK_END);
  if (startIdx >= 0 && endIdx > startIdx) {
    const before = prompt.slice(0, startIdx).trimEnd();
    const after = prompt.slice(endIdx + AGENT_CONFIRMATION_BLOCK_END.length).trimStart();
    return [before, AGENT_CONFIRMATION_INSTRUCTIONS, after].filter(Boolean).join('\n\n');
  }
  return `${prompt.trimEnd()}\n\n${AGENT_CONFIRMATION_INSTRUCTIONS}`;
}

// Audio pipeline hardening — merged into conversation_config on every PATCH.
// Values chosen to reduce false VAD triggers on background noise/cross-talk
// while keeping normal conversational latency acceptable.
export function buildAudioRobustnessConfig(keywords: string[] = []) {
  // Dedup + cap to 32 tokens (ElevenLabs limit); strip empties.
  const clean = Array.from(
    new Set(
      keywords
        .filter((k): k is string => typeof k === 'string')
        .map((k) => k.trim())
        .filter((k) => k.length > 0 && k.length <= 60),
    ),
  ).slice(0, 32);

  return {
    asr: {
      quality: 'high',
      user_input_audio_format: 'ulaw_8000',
      keywords: clean,
    },
    turn: {
      mode: 'turn',
      turn_timeout: 10,
      silence_end_call_timeout: 30,
      turn_detection: {
        type: 'server_vad',
        threshold: 0.65,
        prefix_padding_ms: 300,
        silence_duration_ms: 700,
      },
    },
  } as const;
}

// platform_settings.audio.noise_suppression — sits alongside workspace_overrides
// so it never touches the post-call webhook block.
export const AUDIO_PLATFORM_AUDIO = { noise_suppression: 'high' } as const;


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
