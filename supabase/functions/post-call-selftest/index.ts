import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// TEMPORARY diagnostic function: signs a sample payload with the stored
// ELEVENLABS_POST_CALL_HMAC_SECRET and calls elevenlabs-post-call to verify
// that HMAC validation succeeds. Never returns the secret itself.
serve(async () => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const secret = Deno.env.get("ELEVENLABS_POST_CALL_HMAC_SECRET") || "";
  if (!secret) {
    return new Response(JSON.stringify({ ok: false, error: "secret_missing" }), { status: 500 });
  }

  const payload = {
    type: "post_call_transcription",
    event_timestamp: Math.floor(Date.now() / 1000),
    data: {
      agent_id: Deno.env.get("ELEVENLABS_AGENT_ID") || "agent_test",
      conversation_id: `selftest_${crypto.randomUUID()}`,
      status: "done",
      call_duration_secs: 5,
      transcript: [{ role: "agent", message: "selftest" }],
      metadata: { call_duration_secs: 5, selftest: true },
    },
  };
  const body = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000).toString();
  const keyMaterial = secret.startsWith("wsec_") ? secret.slice(5) : secret;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(keyMaterial), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`));
  const v0 = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/elevenlabs-post-call`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "elevenlabs-signature": `t=${t},v0=${v0}` },
    body,
  });
  const text = await res.text();

  const bad = await fetch(`${SUPABASE_URL}/functions/v1/elevenlabs-post-call`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "elevenlabs-signature": `t=${t},v0=${"0".repeat(64)}` },
    body,
  });
  const badText = await bad.text();

  return new Response(JSON.stringify({
    signed: { status: res.status, body: text.slice(0, 400) },
    tampered: { status: bad.status, body: badText.slice(0, 200) },
  }), { headers: { "Content-Type": "application/json" } });
});
