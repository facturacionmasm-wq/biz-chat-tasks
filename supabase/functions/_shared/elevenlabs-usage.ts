// Shared helper: fetch real conversation usage/cost from ElevenLabs Convai API.
// Uses tenant-scoped API key (tenants.elevenlabs_config.api_key) when available,
// otherwise falls back to the global ELEVENLABS_API_KEY env var.
//
// Returns null on any failure so callers can degrade gracefully.

export interface ElevenLabsConversationUsage {
  llm_tokens: number;
  llm_cost_usd: number;
  tts_chars: number;
  stt_secs: number;
  total_cost_usd: number;
  duration_secs: number;
}

export async function fetchElevenLabsConversationUsage(
  supabase: any,
  tenantId: string | null,
  conversationId: string,
): Promise<ElevenLabsConversationUsage | null> {
  if (!conversationId) return null;

  let apiKey: string | null = null;

  if (tenantId) {
    try {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("elevenlabs_config")
        .eq("id", tenantId)
        .maybeSingle();
      const cfg = tenant?.elevenlabs_config as { api_key?: string } | null;
      if (cfg?.api_key) apiKey = cfg.api_key;
    } catch (e) {
      console.warn("[el-usage] tenant config lookup failed:", e);
    }
  }

  if (!apiKey) apiKey = Deno.env.get("ELEVENLABS_API_KEY") || null;
  if (!apiKey) {
    console.warn("[el-usage] no ElevenLabs API key available");
    return null;
  }

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
      { headers: { "xi-api-key": apiKey } },
    );
    if (!res.ok) {
      console.warn("[el-usage] fetch failed", res.status, await res.text().catch(() => ""));
      return null;
    }
    const body = await res.json();
    const meta = body?.metadata || {};
    const charging = meta?.charging || {};
    const cost = body?.conversation_cost || meta?.cost || {};

    // Field names vary across ElevenLabs API versions; check the most common paths.
    const llmTokens = Number(
      charging?.llm_usage?.total_tokens
        ?? charging?.llm_tokens
        ?? cost?.llm_tokens
        ?? body?.analysis?.llm_usage?.total_tokens
        ?? 0,
    );
    const llmCostUsd = Number(
      charging?.llm_cost_usd
        ?? charging?.llm_charge_usd
        ?? cost?.llm_usd
        ?? 0,
    );
    const ttsChars = Number(
      charging?.tts_characters
        ?? charging?.tts_chars
        ?? cost?.tts_chars
        ?? 0,
    );
    const sttSecs = Number(
      charging?.asr_seconds
        ?? charging?.stt_seconds
        ?? cost?.stt_secs
        ?? 0,
    );
    const totalCostUsd = Number(
      charging?.total_cost_usd
        ?? charging?.call_cost_usd
        ?? cost?.total_usd
        ?? (llmCostUsd || 0),
    );
    const durationSecs = Number(
      meta?.call_duration_secs
        ?? body?.call_duration_secs
        ?? meta?.duration_secs
        ?? 0,
    );

    return {
      llm_tokens: Number.isFinite(llmTokens) ? llmTokens : 0,
      llm_cost_usd: Number.isFinite(llmCostUsd) ? llmCostUsd : 0,
      tts_chars: Number.isFinite(ttsChars) ? ttsChars : 0,
      stt_secs: Number.isFinite(sttSecs) ? sttSecs : 0,
      total_cost_usd: Number.isFinite(totalCostUsd) ? totalCostUsd : 0,
      duration_secs: Number.isFinite(durationSecs) ? durationSecs : 0,
    };
  } catch (e) {
    console.warn("[el-usage] request error:", e);
    return null;
  }
}
