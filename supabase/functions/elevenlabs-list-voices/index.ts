// elevenlabs-list-voices
// Lightweight catalog endpoint: returns the workspace's ElevenLabs voices
// (premade + cloned) so the Settings UI can render a searchable selector
// with audio previews and language filtering.
//
// Uses the v2 endpoint so we can expose `verified_languages` (array of
// language codes/names) per voice — the v1 endpoint only exposes freeform
// `labels` which are inconsistent and hard to filter by.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { cacheGet, cacheSet } from "../_shared/cache.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const KV_TTL_SECONDS = 24 * 60 * 60; // 24h — voices are effectively immutable
const KV_KEY = 'elevenlabs:voices:v2';
let cache: { ts: number; data: unknown } | null = null;

function jsonRes(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeLanguages(v: any): string[] {
  // v2 shape: verified_languages: [{ language: 'es', accent: 'mexican', ... }, ...]
  const out = new Set<string>();
  if (Array.isArray(v?.verified_languages)) {
    for (const l of v.verified_languages) {
      const lang = (l?.language || l?.locale || l?.language_code || '').toString().trim().toLowerCase();
      if (lang) out.add(lang.slice(0, 2)); // normalize to ISO-639-1 prefix
    }
  }
  // v1 fallback: labels.language (single string)
  const legacy = v?.labels?.language;
  if (typeof legacy === 'string' && legacy.trim()) {
    out.add(legacy.trim().toLowerCase().slice(0, 2));
  }
  return Array.from(out);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) return jsonRes({ ok: false, error: "ELEVENLABS_API_KEY not set" }, 500);

  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
      return jsonRes({ ok: true, cached: true, ...(cache.data as object) });
    }
    const kvHit = await cacheGet<{ voices: unknown[] }>(KV_KEY);
    if (kvHit) {
      cache = { ts: Date.now(), data: kvHit };
      return jsonRes({ ok: true, cached: true, ...kvHit });
    }

    // v2 paginated endpoint. Request a large page so a single call covers
    // typical workspaces (<= 100 voices). If needed, paginate via next_page_token.
    const url = new URL("https://api.elevenlabs.io/v2/voices");
    url.searchParams.set("page_size", "100");
    const res = await fetch(url.toString(), { headers: { "xi-api-key": apiKey } });
    if (!res.ok) {
      const details = await res.text();
      console.error(`[elevenlabs-list-voices] GET failed [${res.status}]: ${details}`);
      // Graceful fallback to v1 if v2 is unavailable on the plan
      const v1 = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": apiKey } });
      if (!v1.ok) return jsonRes({ ok: false, error: `GET voices failed [${res.status}]`, details }, res.status);
      const body = await v1.json();
      const voices = Array.isArray(body?.voices)
        ? body.voices.map((v: any) => ({
            voice_id: v.voice_id,
            name: v.name,
            category: v.category ?? null,
            preview_url: v.preview_url ?? null,
            labels: v.labels ?? {},
            languages: normalizeLanguages(v),
          }))
        : [];
      const payload = { voices };
      cache = { ts: Date.now(), data: payload };
      cacheSet(KV_KEY, payload, KV_TTL_SECONDS).catch(() => {});
      return jsonRes({ ok: true, cached: false, ...payload });
    }
    const body = await res.json();
    const voices = Array.isArray(body?.voices)
      ? body.voices.map((v: any) => ({
          voice_id: v.voice_id,
          name: v.name,
          category: v.category ?? null,
          preview_url: v.preview_url ?? null,
          labels: v.labels ?? {},
          languages: normalizeLanguages(v),
        }))
      : [];

    const payload = { voices };
    cache = { ts: Date.now(), data: payload };
    cacheSet(KV_KEY, payload, KV_TTL_SECONDS).catch(() => {});
    return jsonRes({ ok: true, cached: false, ...payload });

  } catch (e) {
    console.error("[elevenlabs-list-voices] fatal:", (e as Error).message);
    return jsonRes({ ok: false, error: (e as Error).message }, 500);
  }
});
