// ============================================================
// Shared Deno KV cache helper (read-through with safe fallback)
// ------------------------------------------------------------
// RULE: cache is best-effort. If Deno KV fails, is unavailable,
// or times out, cacheGet returns null (miss) and cacheSet /
// cacheInvalidate silently no-op. The caller MUST always be
// able to fall back to the live query without any error.
// ============================================================

// deno-lint-ignore no-explicit-any
type Json = any;

let _kvPromise: Promise<Deno.Kv | null> | null = null;

async function getKv(): Promise<Deno.Kv | null> {
  if (_kvPromise) return _kvPromise;
  _kvPromise = (async () => {
    try {
      // @ts-ignore Deno.openKv is available in Supabase Edge Runtime
      if (typeof Deno.openKv !== 'function') return null;
      // @ts-ignore
      return await Deno.openKv();
    } catch (err) {
      console.warn('[cache] Deno.openKv unavailable:', err instanceof Error ? err.message : err);
      return null;
    }
  })();
  return _kvPromise;
}

/** Normalize a string key into a Deno.KvKey (single-segment). */
function toKey(key: string): Deno.KvKey {
  return ['cache', key];
}

/**
 * Read a cached JSON value. Returns null on miss, expired, or any error.
 */
export async function cacheGet<T = Json>(key: string): Promise<T | null> {
  try {
    const kv = await getKv();
    if (!kv) return null;
    const entry = await kv.get<{ v: T; exp: number }>(toKey(key));
    if (!entry.value) return null;
    if (typeof entry.value.exp === 'number' && entry.value.exp > 0 && entry.value.exp < Date.now()) {
      // Expired — treat as miss. Best-effort cleanup.
      kv.delete(toKey(key)).catch(() => {});
      return null;
    }
    return entry.value.v ?? null;
  } catch (err) {
    console.warn('[cache] get failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Store a JSON value with TTL (seconds). Silently no-ops on error.
 * Uses Deno KV's native expireIn AND a stored exp guard for double safety.
 */
export async function cacheSet<T = Json>(key: string, value: T, ttlSeconds: number): Promise<void> {
  try {
    const kv = await getKv();
    if (!kv) return;
    const ttlMs = Math.max(1, Math.floor(ttlSeconds * 1000));
    const exp = Date.now() + ttlMs;
    await kv.set(toKey(key), { v: value, exp }, { expireIn: ttlMs });
  } catch (err) {
    console.warn('[cache] set failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Invalidate a single key or every key sharing a prefix. Silently no-ops on error.
 * Deletes are best-effort — bounded to avoid runaway scans.
 */
export async function cacheInvalidate(prefix: string): Promise<void> {
  try {
    const kv = await getKv();
    if (!kv) return;
    // First try direct delete of the exact key (common case).
    await kv.delete(toKey(prefix)).catch(() => {});

    // Then sweep any keys that start with `${prefix}`. Bounded scan.
    let count = 0;
    const iter = kv.list<unknown>({ prefix: toKey(prefix) });
    for await (const entry of iter) {
      try { await kv.delete(entry.key); } catch { /* ignore */ }
      count++;
      if (count >= 500) break; // safety bound
    }
  } catch (err) {
    console.warn('[cache] invalidate failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Compute a stable YYYY-MM-DD (UTC) — useful for day-scoped cache keys.
 */
export function todayUTC(d: Date = new Date()): string {
  return d.toISOString().split('T')[0];
}

/**
 * Compute seconds remaining until end-of-day UTC (min 60s).
 * Handy TTL for "today" rollups so they auto-expire when the day flips.
 */
export function secondsUntilEndOfDayUTC(d: Date = new Date()): number {
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
  return Math.max(60, Math.floor((end.getTime() - d.getTime()) / 1000));
}
