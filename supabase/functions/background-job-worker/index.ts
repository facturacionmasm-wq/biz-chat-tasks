// Generic background job worker.
// Processes public.background_jobs (NOT call_jobs — that queue has its own worker).
//
// Dispatches by job_type. Handlers invoke the SAME edge function that already
// does the work (no duplicated logic). Errors bubble up so backoff/retries apply.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import {
  claimNextJobs,
  markRunning,
  markSuccess,
  markError,
  BackgroundJob,
} from "../_shared/jobs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_MAX_JOBS_PER_RUN = 10;
const HARD_CAP_JOBS_PER_RUN = 100;

const j = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const results: Array<{ job_id: string; job_type: string; status: string; error?: string }> = [];

  let requestedMax = DEFAULT_MAX_JOBS_PER_RUN;
  try {
    if (req.method === 'POST') {
      const body = await req.clone().json().catch(() => ({}));
      const m = Number((body as any)?.max);
      if (Number.isFinite(m) && m > 0) {
        requestedMax = Math.min(Math.floor(m), HARD_CAP_JOBS_PER_RUN);
      }
    }
  } catch { /* ignore */ }

  try {
    const jobs = await claimNextJobs(supabase, requestedMax);
    if (jobs.length === 0) {
      return j({ message: "No jobs to process", processed: 0 });
    }

    console.log(`[background-job-worker] Processing ${jobs.length} jobs`);

    for (const job of jobs) {
      await markRunning(supabase, job);

      try {
        const result = await dispatch(supabase, job);
        await markSuccess(supabase, job.id, result);
        results.push({ job_id: job.id, job_type: job.job_type, status: "success" });
        console.log(`[background-job-worker] ${job.job_type} ${job.id}: SUCCESS`);
      } catch (err) {
        const msg = (err as Error).message || "Unknown error";
        await markError(supabase, job, msg);
        const willRetry = job.attempts + 1 < job.max_attempts;
        results.push({
          job_id: job.id,
          job_type: job.job_type,
          status: willRetry ? "retry" : "error",
          error: msg,
        });
        console.error(
          `[background-job-worker] ${job.job_type} ${job.id}: ${willRetry ? "RETRY" : "FAILED"} - ${msg}`,
        );
      }
    }

    return j({ processed: results.length, results });
  } catch (error) {
    console.error("[background-job-worker] Fatal:", (error as Error).message);
    return j({ error: (error as Error).message }, 500);
  }
});

async function dispatch(supabase: any, job: BackgroundJob): Promise<Record<string, unknown>> {
  // Dry-run guard: any job flagged as loadtest is a no-op. Never calls providers.
  const payload = (job.payload || {}) as Record<string, unknown>;
  if (payload.loadtest === true || job.job_type === 'loadtest_noop' || job.job_type.startsWith('loadtest_')) {
    return { ok: true, dry_run: true, job_type: job.job_type, simulated_at: Date.now() };
  }
  switch (job.job_type) {
    case "send_email":
      return await handleSendEmail(job);
    case "generate_report":
      return await handleGenerateReport(supabase, job);
    case "kb_sync_all":
      return await handleKbSyncAll(supabase, job);
    case "calendar_sync":
      return await handleCalendarSync(supabase, job);
    case "delete_tenant":
      return await handleDeleteTenant(supabase, job);
    case "cleanup":
      throw new Error(`Handler for '${job.job_type}' not implemented yet`);
    default:
      throw new Error(`unknown job_type: ${job.job_type}`);
  }
}

// ─── helper: invoke another edge function server-to-server with service role ───
async function invokeFn(fnName: string, body: Record<string, unknown>): Promise<any> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  const txt = await res.text();
  let parsed: any = null;
  try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
  if (!res.ok) {
    const msg = typeof parsed === "object" && parsed?.error ? parsed.error : `${res.status} ${txt}`;
    throw new Error(`${fnName}: ${msg}`);
  }
  return parsed;
}

// send_email payload: { to, subject, html?, text?, from?, replyTo?, kind? }
async function handleSendEmail(job: BackgroundJob): Promise<Record<string, unknown>> {
  const p = (job.payload || {}) as Record<string, unknown>;
  const to = p.to as string | string[] | undefined;
  const subject = p.subject as string | undefined;
  const html = p.html as string | undefined;
  const text = p.text as string | undefined;
  const from = (p.from as string | undefined) || "RYBIX <soporte@rybixholding.com>";
  const replyTo = p.replyTo as string | undefined;

  if (!to || !subject || (!html && !text)) {
    throw new Error("send_email: missing required fields (to, subject, html|text)");
  }

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");

  const body: Record<string, unknown> = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
  };
  if (html) body.html = html;
  if (text) body.text = text;
  if (replyTo) body.reply_to = replyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const respText = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${respText}`);
  let parsed: any = null;
  try { parsed = JSON.parse(respText); } catch { /* ignore */ }
  return { resend_id: parsed?.id ?? null, status: res.status, kind: p.kind ?? null };
}

// generate_report payload: { report: 'financial-projections'|'churn-engine'|'global-metrics-daily'|'billing-monthly-report'|'fraud-detection', args?: {...} }
const REPORT_FNS = new Set([
  "financial-projections",
  "churn-engine",
  "global-metrics-daily",
  "billing-monthly-report",
  "fraud-detection",
]);
async function handleGenerateReport(_supabase: any, job: BackgroundJob): Promise<Record<string, unknown>> {
  const p = (job.payload || {}) as Record<string, unknown>;
  const report = p.report as string | undefined;
  if (!report || !REPORT_FNS.has(report)) {
    throw new Error(`generate_report: invalid report '${report}'`);
  }
  const args = (p.args as Record<string, unknown> | undefined) ?? {};
  const out = await invokeFn(report, args);
  return { report, output: out };
}

// kb_sync_all payload: { tenant_id }
async function handleKbSyncAll(_supabase: any, job: BackgroundJob): Promise<Record<string, unknown>> {
  const p = (job.payload || {}) as Record<string, unknown>;
  const tenant_id = (p.tenant_id as string | undefined) || job.tenant_id || undefined;
  if (!tenant_id) throw new Error("kb_sync_all: missing tenant_id");
  const out = await invokeFn("elevenlabs-kb-sync", { action: "sync_all", tenant_id });
  return { tenant_id, output: out };
}

// calendar_sync payload: { action, appointment_id, ...extra }
async function handleCalendarSync(_supabase: any, job: BackgroundJob): Promise<Record<string, unknown>> {
  const p = (job.payload || {}) as Record<string, unknown>;
  if (!p.action) throw new Error("calendar_sync: missing action");
  const out = await invokeFn("calendar-sync", p);
  return { output: out };
}

// delete_tenant payload: { tenant_id, confirm_name }
async function handleDeleteTenant(_supabase: any, job: BackgroundJob): Promise<Record<string, unknown>> {
  const p = (job.payload || {}) as Record<string, unknown>;
  const tenant_id = p.tenant_id as string | undefined;
  const confirm_name = p.confirm_name as string | undefined;
  if (!tenant_id || !confirm_name) throw new Error("delete_tenant: missing tenant_id or confirm_name");
  if (!job.created_by) throw new Error("delete_tenant: missing created_by (super_admin caller)");
  const out = await invokeFn("admin-delete-tenant", {
    tenant_id,
    confirm_name,
    caller_user_id: job.created_by,
  });
  return { tenant_id, output: out };
}

