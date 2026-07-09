// Generic background job worker.
// Processes public.background_jobs (NOT call_jobs — that queue has its own worker).
//
// Dispatches by job_type. In this phase we only wire the dispatcher skeleton;
// no existing callers are migrated yet, so unknown types are marked as error.

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

const MAX_JOBS_PER_RUN = 10;

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

  try {
    const jobs = await claimNextJobs(supabase, MAX_JOBS_PER_RUN);
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

// Dispatch by job_type. Each case will be wired to real work in later phases.
// Adding a case now returns `unknown job_type` for anything not listed so an
// accidentally-enqueued job doesn't loop forever.
async function dispatch(supabase: any, job: BackgroundJob): Promise<Record<string, unknown>> {
  switch (job.job_type) {
    case "send_email":
    case "generate_report":
    case "kb_sync_all":
    case "calendar_sync":
    case "cleanup":
      // Skeleton — real handlers land in follow-up phases. For now, treat as
      // not-implemented so we don't silently swallow real work.
      throw new Error(`Handler for '${job.job_type}' not implemented yet`);

    default:
      throw new Error(`unknown job_type: ${job.job_type}`);
  }

  // Unreachable, kept to document the intended return shape.
  // deno-lint-ignore no-unreachable
  return { ok: true };
}
