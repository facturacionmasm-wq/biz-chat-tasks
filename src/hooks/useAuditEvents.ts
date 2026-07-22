import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type AuditEvent = {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  event_type: string;
  resource_type: string | null;
  resource_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  actor_name?: string | null;
};

export type AuditFilters = {
  actorId?: string | null;
  eventType?: string | null;
  resourceType?: string | null;
  from?: string | null;
  to?: string | null;
  search?: string | null;
};

const PAGE_SIZE = 50;

export function useAuditEvents(filters: AuditFilters) {
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);

  const fetchPage = useCallback(async (nextPage: number, reset: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const from = nextPage * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let q = supabase
        .from('audit_events')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (filters.actorId === '__system__') q = q.is('actor_id', null);
      else if (filters.actorId) q = q.eq('actor_id', filters.actorId);
      if (filters.eventType) q = q.eq('event_type', filters.eventType);
      if (filters.resourceType) q = q.eq('resource_type', filters.resourceType);
      if (filters.from) q = q.gte('created_at', filters.from);
      if (filters.to) q = q.lte('created_at', filters.to);
      if (filters.search) q = q.or(`event_type.ilike.%${filters.search}%,resource_id.ilike.%${filters.search}%`);

      const { data, error: qErr } = await q;
      if (qErr) throw qErr;

      const events = (data ?? []) as AuditEvent[];

      // Enrich actor_name from profiles
      const actorIds = Array.from(new Set(events.map(e => e.actor_id).filter(Boolean))) as string[];
      let actorMap = new Map<string, string>();
      if (actorIds.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('user_id, name, email')
          .in('user_id', actorIds);
        (profs ?? []).forEach((p: any) => actorMap.set(p.user_id, p.name || p.email || p.user_id));
      }
      const enriched = events.map(e => ({ ...e, actor_name: e.actor_id ? (actorMap.get(e.actor_id) || 'Usuario') : null }));

      setHasMore(events.length === PAGE_SIZE);
      setRows(prev => reset ? enriched : [...prev, ...enriched]);
      setPage(nextPage);
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando auditoría');
    } finally {
      setLoading(false);
    }
  }, [filters.actorId, filters.eventType, filters.resourceType, filters.from, filters.to, filters.search]);

  useEffect(() => {
    fetchPage(0, true);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) fetchPage(page + 1, false);
  }, [fetchPage, loading, hasMore, page]);

  const refresh = useCallback(() => fetchPage(0, true), [fetchPage]);

  return { rows, loading, error, hasMore, loadMore, refresh };
}

export function useAuditFilterOptions() {
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [resourceTypes, setResourceTypes] = useState<string[]>([]);
  const [actors, setActors] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('audit_events')
        .select('event_type, resource_type, actor_id')
        .order('created_at', { ascending: false })
        .limit(500);
      const rows = (data ?? []) as any[];
      setEventTypes(Array.from(new Set(rows.map(r => r.event_type).filter(Boolean))).sort());
      setResourceTypes(Array.from(new Set(rows.map(r => r.resource_type).filter(Boolean))).sort());
      const actorIds = Array.from(new Set(rows.map(r => r.actor_id).filter(Boolean))) as string[];
      if (actorIds.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('user_id, name, email')
          .in('user_id', actorIds);
        setActors((profs ?? []).map((p: any) => ({ id: p.user_id, name: p.name || p.email || 'Usuario' })));
      }
    })();
  }, []);

  return { eventTypes, resourceTypes, actors };
}

export const AUDIT_PAGE_SIZE = PAGE_SIZE;
