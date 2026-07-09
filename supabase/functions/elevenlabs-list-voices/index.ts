// elevenlabs-list-voices
// Lightweight catalog endpoint: returns the workspace's ElevenLabs voices
// (premade + cloned) so the Settings UI can render a searchable selector
// with audio previews. In-memory cached 5 min per isolate.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { cacheGet, cacheSet } from "../_shared/cache.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const KV_TTL_SECONDS = 24 * 60 * 60; // 24h — voices are effectively immutable
const KV_KEY = 'elevenlabs:voices';
let cache: { ts: number; data: unknown } | null = null;

function jsonRes(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) return jsonRes({ ok: false, error: "ELEVENLABS_API_KEY not set" }, 500);

  try {
    // L1: per-isolate memory
    if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
      return jsonRes({ ok: true, cached: true, ...(cache.data as object) });
    }

    // L2: shared Deno KV (survives isolate rotation)
    const kvHit = await cacheGet<{ voices: unknown[] }>(KV_KEY);
    if (kvHit) {
      cache = { ts: Date.now(), data: kvHit };
      return jsonRes({ ok: true, cached: true, ...kvHit });
    }


    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
    });
    if (!res.ok) {
      const details = await res.text();
      console.error(`[elevenlabs-list-voices] GET failed [${res.status}]: ${details}`);
      return jsonRes({ ok: false, error: `GET voices failed [${res.status}]`, details }, res.status);
    }
    const body = await res.json();
    const voices = Array.isArray(body?.voices)
      ? body.voices.map((v: any) => ({
          voice_id: v.voice_id,
          name: v.name,
          category: v.category ?? null,
          preview_url: v.preview_url ?? null,
          labels: v.labels ?? {},
        }))
      : [];

    const payload = { voices };
    cache = { ts: Date.now(), data: payload };
    // Best-effort persist to shared KV (24h) — silent on failure.
    cacheSet(KV_KEY, payload, KV_TTL_SECONDS).catch(() => {});
    return jsonRes({ ok: true, cached: false, ...payload });

  } catch (e) {
    console.error("[elevenlabs-list-voices] fatal:", (e as Error).message);
    return jsonRes({ ok: false, error: (e as Error).message }, 500);
  }
});
