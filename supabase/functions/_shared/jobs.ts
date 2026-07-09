// Generic background job helpers (safe fallback: never throws).
//
// Mirrors the proven call_jobs pattern but decoupled: writes to
// public.background_jobs and never touches call_jobs. Callers can enqueue
// fire-and-forget work; if enqueue fails, they should fall back to running
// the work inline as they do today.

export interface EnqueueJobParams {
  jobType: string;
  payload?: Record<string, unknown>;
  tenantId?: string | null;
  createdBy?: string | null;
  maxAttempts?: number;
  runAfter?: string; // ISO
}

export interface BackgroundJob {
  id: string;
  tenant_id: string | null;
  job_type: string;
  payload: Record<string, unknown>;
  status: 'queued' | 'running' | 'success' | 'error';
  attempts: number;
  max_attempts: number;
  run_after: string;
  result: Record<string, unknown> | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Never throws. Returns the new job id, or null on failure.
export async function enqueueJob(
  supabaseAdmin: any,
  params: EnqueueJobParams,
): Promise<string | null> {
  try {
    const row = {
      tenant_id: params.tenantId ?? null,
      job_type: params.jobType,
      payload: params.payload ?? {},
      status: 'queued' as const,
      attempts: 0,
      max_attempts: params.maxAttempts ?? 3,
      run_after: params.runAfter ?? new Date().toISOString(),
      created_by: params.createdBy ?? null,
    };
    const { data, error } = await supabaseAdmin
      .from('background_jobs')
      .insert(row)
      .select('id')
      .single();
    if (error) {
      console.error('[jobs] enqueueJob failed:', error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (e) {
    console.error('[jobs] enqueueJob exception:', (e as Error).message);
    return null;
  }
}

// Claim the next batch of runnable jobs (queued OR retryable errored) whose
// run_after has arrived. Returns [] on any failure.
export async function claimNextJobs(
  supabaseAdmin: any,
  limit = 10,
): Promise<BackgroundJob[]> {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('background_jobs')
      .select('*')
      .in('status', ['queued'])
      .lte('run_after', nowIso)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) {
      console.error('[jobs] claimNextJobs failed:', error.message);
      return [];
    }
    return (data ?? []) as BackgroundJob[];
  } catch (e) {
    console.error('[jobs] claimNextJobs exception:', (e as Error).message);
    return [];
  }
}

export async function markRunning(supabaseAdmin: any, job: BackgroundJob): Promise<void> {
  try {
    await supabaseAdmin
      .from('background_jobs')
      .update({ status: 'running', attempts: job.attempts + 1 })
      .eq('id', job.id);
  } catch (e) {
    console.error('[jobs] markRunning exception:', (e as Error).message);
  }
}

export async function markSuccess(
  supabaseAdmin: any,
  jobId: string,
  result: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabaseAdmin
      .from('background_jobs')
      .update({ status: 'success', result, error: null })
      .eq('id', jobId);
  } catch (e) {
    console.error('[jobs] markSuccess exception:', (e as Error).message);
  }
}

// Exponential backoff on retryable errors; final error status once attempts
// >= max_attempts.
export async function markError(
  supabaseAdmin: any,
  job: BackgroundJob,
  errorMessage: string,
): Promise<void> {
  try {
    // job.attempts is the pre-increment value from claim; markRunning already
    // bumped attempts in DB. Use job.attempts + 1 as the effective count.
    const effectiveAttempts = job.attempts + 1;
    const isFinal = effectiveAttempts >= job.max_attempts;

    if (isFinal) {
      await supabaseAdmin
        .from('background_jobs')
        .update({ status: 'error', error: errorMessage })
        .eq('id', job.id);
      return;
    }

    // Exponential backoff: 2^attempts * 2 minutes (2, 4, 8, 16, 32...)
    const backoffMinutes = Math.pow(2, effectiveAttempts) * 2;
    const runAfter = new Date(Date.now() + backoffMinutes * 60_000).toISOString();
    await supabaseAdmin
      .from('background_jobs')
      .update({ status: 'queued', error: errorMessage, run_after: runAfter })
      .eq('id', job.id);
  } catch (e) {
    console.error('[jobs] markError exception:', (e as Error).message);
  }
}
