import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface BackgroundJobRow {
  id: string;
  tenant_id: string | null;
  job_type: string;
  status: 'queued' | 'running' | 'success' | 'error';
  attempts: number;
  max_attempts: number;
  result: any;
  error: string | null;
  created_at: string;
  updated_at: string;
  payload: any;
}

/**
 * Light hook to watch background_jobs for a tenant with realtime updates.
 * Respects RLS (users only see their own tenant; super_admin sees all).
 * Safe: on any error returns [] and logs to console.
 */
export function useBackgroundJobs(
  tenantId: string | null | undefined,
  opts?: { jobType?: string; limit?: number },
) {
  const [jobs, setJobs] = useState<BackgroundJobRow[]>([]);
  const [loading, setLoading] = useState<boolean>(!!tenantId);

  const limit = opts?.limit ?? 20;
  const jobType = opts?.jobType;

  const fetchJobs = async () => {
    if (!tenantId) {
      setJobs([]);
      setLoading(false);
      return;
    }
    try {
      let q = supabase
        .from('background_jobs')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (jobType) q = q.eq('job_type', jobType);
      const { data, error } = await q;
      if (error) {
        console.error('[useBackgroundJobs] fetch error:', error.message);
        setJobs([]);
      } else {
        setJobs((data ?? []) as BackgroundJobRow[]);
      }
    } catch (e) {
      console.error('[useBackgroundJobs] exception:', (e as Error).message);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    if (!tenantId) return;
    const channel = supabase
      .channel(`bg-jobs-${tenantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'background_jobs', filter: `tenant_id=eq.${tenantId}` },
        () => { fetchJobs(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, jobType, limit]);

  return { jobs, loading, refetch: fetchJobs };
}
