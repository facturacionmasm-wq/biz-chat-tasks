// Load-test runner: simulates N concurrent virtual users hitting the main
// flows in DRY-RUN mode against the reserved LOADTEST tenant.
//
// Requires: super_admin caller AND header x-loadtest: 1 AND
// body.tenant_id === LOADTEST_TENANT_ID (implicit — the runner always uses
// the reserved constant and never accepts arbitrary tenant ids).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import {
  LOADTEST_TENANT_ID,
  LOADTEST_EMAIL_DOMAIN,
  LOADTEST_PHONE_PREFIX,
} from '../_shared/loadtest.ts';
import { enqueueJob } from '../_shared/jobs.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-loadtest',
};

const VU_PASSWORD = 'LoadTest!Vu-Password-2026';
const AVAILABLE_FLOWS = ['auth', 'appointment', 'chat', 'jobs', 'var5'] as const;
type Flow = typeof AVAILABLE_FLOWS[number];

const j = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

type Sample = { start: number; end: number; ok: boolean; error?: string };

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * sorted.length)),
  );
  return sorted[idx];
}

function summarize(samples: Sample[]) {
  const total = samples.length;
  const ok = samples.filter((s) => s.ok).length;
  const err = total - ok;
  const durations = samples
    .filter((s) => s.ok)
    .map((s) => s.end - s.start)
    .sort((a, b) => a - b);
  const errors: Record<string, number> = {};
  for (const s of samples) {
    if (!s.ok) {
      const key = String(s.error || 'unknown').substring(0, 200);
      errors[key] = (errors[key] || 0) + 1;
    }
  }
  const durationS = total > 0
    ? (Math.max(...samples.map((s) => s.end)) - Math.min(...samples.map((s) => s.start))) / 1000
    : 0;
  return {
    count: total,
    ok,
    err,
    error_rate: total > 0 ? err / total : 0,
    p50_ms: pct(durations, 50),
    p95_ms: pct(durations, 95),
    p99_ms: pct(durations, 99),
    max_ms: durations[durations.length - 1] || 0,
    throughput_rps: durationS > 0 ? +(ok / durationS).toFixed(2) : 0,
    top_errors: Object.entries(errors)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([msg, n]) => ({ msg, count: n })),
  };
}

async function timeIt<T>(
  fn: () => Promise<T>,
): Promise<Sample & { value?: T }> {
  const start = Date.now();
  try {
    const value = await fn();
    return { start, end: Date.now(), ok: true, value };
  } catch (e) {
    return { start, end: Date.now(), ok: false, error: (e as Error).message };
  }
}

// resolveTenantLocation — mirrored inline so flow E has no cross-function dependency.
function resolveTenantLocation(settings: any): string {
  const branches = Array.isArray(settings?.branches) ? settings.branches : [];
  const def = branches.find((b: any) => b && b.is_default) || branches[0] || null;
  if (def) {
    const url = String(def.maps_url || '').trim();
    if (url) return url;
    const addr = String(def.address || '').trim();
    if (addr) return addr;
  }
  const legacyAddr = String(settings?.address || '').trim();
  return legacyAddr;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Gate: header must be present
  if (req.headers.get('x-loadtest') !== '1') {
    return j({ error: 'Missing header x-loadtest: 1' }, 400);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // AuthN
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return j({ error: 'Unauthorized' }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await userClient.auth.getUser();
  const caller = userData?.user;
  if (!caller) return j({ error: 'Unauthorized' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // AuthZ: super_admin only
  const { data: roles } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', caller.id);
  const isSuper = (roles || []).some((r: any) => r.role === 'super_admin');
  if (!isSuper) return j({ error: 'super_admin required' }, 403);

  const body = await req.json().catch(() => ({}));
  const vus: number = Math.min(Math.max(Number(body?.vus) || 100, 1), 2000);
  const batchSize: number = Math.min(
    Math.max(Number(body?.batch_size) || 50, 1),
    200,
  );
  const requestedFlows = Array.isArray(body?.flows) && body.flows.length > 0
    ? (body.flows as string[]).filter((f): f is Flow =>
        (AVAILABLE_FLOWS as readonly string[]).includes(f))
    : [...AVAILABLE_FLOWS];

  if (requestedFlows.length === 0) {
    return j({ error: 'No valid flows requested' }, 400);
  }

  // Insert run row (started)
  const { data: runRow, error: runErr } = await admin
    .from('load_test_runs')
    .insert({
      params: { vus, batch_size: batchSize, flows: requestedFlows },
      results: { status: 'running' },
      created_by: caller.id,
    })
    .select('id, started_at')
    .single();
  if (runErr || !runRow) {
    return j({ error: `Could not create load_test_runs row: ${runErr?.message}` }, 500);
  }
  const runId = runRow.id;

  // Pre-fetch tenant settings for var5 flow
  const { data: loadtestTenant } = await admin
    .from('tenants')
    .select('settings_json')
    .eq('id', LOADTEST_TENANT_ID)
    .maybeSingle();
  const baseSettings = loadtestTenant?.settings_json || {};

  // Pre-fetch chat channel
  const { data: channel } = await admin
    .from('chat_channels')
    .select('id')
    .eq('tenant_id', LOADTEST_TENANT_ID)
    .eq('name', 'loadtest-general')
    .maybeSingle();
  const chatChannelId: string | null = channel?.id ?? null;

  // Discover pre-seeded VU users (from load-test-seed)
  const { data: vuProfiles } = await admin
    .from('profiles')
    .select('user_id, email')
    .like('email', `vu_%@${LOADTEST_EMAIL_DOMAIN}`)
    .limit(500);
  const vuList = (vuProfiles || []) as Array<{ user_id: string; email: string }>;

  // Cache for auth JWTs so 'auth' flow reuses tokens instead of re-logging every VU.
  const jwtCache = new Map<string, string>();

  // ── Flow implementations (all dry-run; no external providers) ────────────
  const flows: Record<Flow, (vuIndex: number) => Promise<Sample>> = {
    // A. AUTH: sign-in with cached JWT reuse
    auth: async (i) => {
      if (vuList.length === 0) throw new Error('no pre-seeded VUs; run load-test-seed');
      const vu = vuList[i % vuList.length];
      const cached = jwtCache.get(vu.email);
      if (cached) return { start: Date.now(), end: Date.now(), ok: true };
      const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const { data, error } = await anon.auth.signInWithPassword({
        email: vu.email,
        password: VU_PASSWORD,
      });
      if (error) throw new Error(`signIn: ${error.message}`);
      if (data?.session?.access_token) {
        jwtCache.set(vu.email, data.session.access_token);
      }
      return { start: 0, end: 0, ok: true };
    },

    // B. APPOINTMENT: insert row → trigger creates notifications → dry-run drain
    appointment: async (i) => {
      const startAt = new Date(Date.now() + (60 + (i % 300)) * 60_000).toISOString();
      const { data: appt, error: apErr } = await admin
        .from('appointments')
        .insert({
          tenant_id: LOADTEST_TENANT_ID,
          contact_name: `LOADTEST VU ${i}`,
          contact_phone: `${LOADTEST_PHONE_PREFIX}${String(1000 + i).padStart(4, '0')}`,
          contact_email: `vu_${i}@${LOADTEST_EMAIL_DOMAIN}`,
          service_type: 'loadtest',
          start_at: startAt,
          status: 'scheduled',
          notes: '[LOADTEST]',
        })
        .select('id')
        .single();
      if (apErr) throw new Error(`insert appointment: ${apErr.message}`);
      // Kick send-reminders in dry-run to drain the notifications this trigger created.
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-reminders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          'Content-Type': 'application/json',
          'x-loadtest': '1',
        },
        body: JSON.stringify({ tenant_id: LOADTEST_TENANT_ID, appointment_id: appt.id }),
      });
      await res.text();
      if (!res.ok) throw new Error(`send-reminders ${res.status}`);
      return { start: 0, end: 0, ok: true };
    },

    // C. CHAT: insert message + read last 50
    chat: async (i) => {
      if (!chatChannelId) throw new Error('no loadtest-general channel');
      const senderId = vuList[i % Math.max(vuList.length, 1)]?.user_id || caller.id;
      const { error: insErr } = await admin.from('chat_messages').insert({
        tenant_id: LOADTEST_TENANT_ID,
        channel_id: chatChannelId,
        sender_id: senderId,
        content: `[LOADTEST] msg #${i} @ ${Date.now()}`,
      });
      if (insErr) throw new Error(`chat insert: ${insErr.message}`);
      const { error: selErr } = await admin
        .from('chat_messages')
        .select('id, content, created_at')
        .eq('channel_id', chatChannelId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (selErr) throw new Error(`chat select: ${selErr.message}`);
      return { start: 0, end: 0, ok: true };
    },

    // D. JOBS: enqueue loadtest_noop then invoke worker
    jobs: async (i) => {
      const jobId = await enqueueJob(admin, {
        jobType: 'loadtest_noop',
        payload: { loadtest: true, vu: i, ts: Date.now() },
        tenantId: LOADTEST_TENANT_ID,
        createdBy: caller.id,
      });
      if (!jobId) throw new Error('enqueue failed');
      const res = await fetch(`${SUPABASE_URL}/functions/v1/background-job-worker`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          'Content-Type': 'application/json',
          'x-loadtest': '1',
        },
        body: '{}',
      });
      await res.text();
      if (!res.ok) throw new Error(`worker ${res.status}`);
      return { start: 0, end: 0, ok: true };
    },

    // E. VAR5: pure CPU — resolve tenant location over synthetic settings
    var5: async (i) => {
      // Vary the synthetic input so JIT can't skip work entirely.
      const synth = {
        ...baseSettings,
        branches: [
          ...(Array.isArray((baseSettings as any)?.branches) ? (baseSettings as any).branches : []),
          { id: `br_${i}`, name: `Br ${i}`, address: `Addr ${i}`, maps_url: `https://x.test/${i}`, is_default: false },
        ],
      };
      const out = resolveTenantLocation(synth);
      if (!out) throw new Error('empty var5');
      return { start: 0, end: 0, ok: true };
    },
  };

  // ── Runner: dispatch flows across VUs in batches ─────────────────────────
  const perFlowSamples: Record<Flow, Sample[]> = {
    auth: [], appointment: [], chat: [], jobs: [], var5: [],
  };

  const runStart = Date.now();
  for (let offset = 0; offset < vus; offset += batchSize) {
    const batch: Array<Promise<void>> = [];
    for (let n = 0; n < batchSize && offset + n < vus; n++) {
      const vuIndex = offset + n;
      const flow = requestedFlows[vuIndex % requestedFlows.length];
      batch.push(
        timeIt(() => flows[flow](vuIndex)).then((s) => {
          perFlowSamples[flow].push({ start: s.start, end: s.end, ok: s.ok, error: s.error });
        }),
      );
    }
    await Promise.allSettled(batch);
  }
  const runEnd = Date.now();

  // Build per-flow summary
  const flowsReport: Record<string, unknown> = {};
  for (const flow of requestedFlows) {
    flowsReport[flow] = summarize(perFlowSamples[flow]);
  }

  const results = {
    status: 'done',
    duration_ms: runEnd - runStart,
    tenant_id: LOADTEST_TENANT_ID,
    vus,
    batch_size: batchSize,
    flows: flowsReport,
    vu_pool_size: vuList.length,
  };

  await admin
    .from('load_test_runs')
    .update({ ended_at: new Date().toISOString(), results })
    .eq('id', runId);

  return j({ ok: true, run_id: runId, ...results });
});
