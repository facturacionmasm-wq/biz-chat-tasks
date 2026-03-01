import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, Loader2, Briefcase, Activity, Search } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const CallObservability = () => {
  const [failedJobs, setFailedJobs] = useState<any[]>([]);
  const [pendingJobs, setPendingJobs] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'failed' | 'pending' | 'audit'>('failed');
  const [loading, setLoading] = useState(true);
  const [auditSearch, setAuditSearch] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [failedRes, pendingRes, auditRes] = await Promise.all([
        supabase.from('call_jobs')
          .select('id, job_type, status, attempts, max_attempts, last_error, call_id, updated_at, created_at')
          .eq('status', 'error')
          .order('updated_at', { ascending: false })
          .limit(50),
        supabase.from('call_jobs')
          .select('id, job_type, status, attempts, run_after, call_id, updated_at, created_at')
          .in('status', ['queued', 'running'])
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.from('audit_events')
          .select('id, event_type, resource_type, resource_id, payload, created_at')
          .in('event_type', ['call_job.failed', 'appointment.auto_created', 'call.completed'])
          .order('created_at', { ascending: false })
          .limit(100),
      ]);

      setFailedJobs(failedRes.data || []);
      setPendingJobs(pendingRes.data || []);
      setAuditLogs(auditRes.data || []);
    } catch (err) {
      console.error('Error loading observability data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Realtime for call_jobs
  useEffect(() => {
    const channel = supabase
      .channel('obs_call_jobs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_jobs' }, () => {
        loadData();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  const retryJob = async (jobId: string) => {
    const { error } = await supabase
      .from('call_jobs')
      .update({ status: 'queued', last_error: null, run_after: new Date().toISOString() })
      .eq('id', jobId);
    if (error) {
      toast.error('Error al reintentar');
    } else {
      toast.success('Job re-encolado');
      supabase.functions.invoke('call-job-worker', { body: { trigger: 'manual_retry' } }).catch(() => {});
      loadData();
    }
  };

  const retryAllFailed = async () => {
    const ids = failedJobs.map(j => j.id);
    if (ids.length === 0) return;
    
    for (const id of ids) {
      await supabase.from('call_jobs')
        .update({ status: 'queued', last_error: null, run_after: new Date().toISOString() })
        .eq('id', id);
    }
    toast.success(`${ids.length} jobs re-encolados`);
    supabase.functions.invoke('call-job-worker', { body: { trigger: 'manual_retry_all' } }).catch(() => {});
    loadData();
  };

  const filteredAudit = auditLogs.filter(log =>
    !auditSearch ||
    log.event_type.toLowerCase().includes(auditSearch.toLowerCase()) ||
    (log.resource_id || '').toLowerCase().includes(auditSearch.toLowerCase())
  );

  const tabs = [
    { key: 'failed' as const, label: 'Errores', count: failedJobs.length, icon: AlertTriangle, color: 'text-destructive' },
    { key: 'pending' as const, label: 'En cola', count: pendingJobs.length, icon: Clock, color: 'text-warning' },
    { key: 'audit' as const, label: 'Auditoría', count: auditLogs.length, icon: Activity, color: 'text-primary' },
  ];

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-2 border-b border-border pb-3">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Icon size={14} className={activeTab === tab.key ? tab.color : ''} />
              {tab.label}
              {tab.count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  tab.key === 'failed' ? 'bg-destructive/10 text-destructive' :
                  tab.key === 'pending' ? 'bg-warning/10 text-warning' :
                  'bg-muted text-muted-foreground'
                }`}>{tab.count}</span>
              )}
            </button>
          );
        })}
        <button onClick={loadData} className="ml-auto p-2 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      {/* Failed Jobs */}
      {activeTab === 'failed' && (
        <div className="space-y-3">
          {failedJobs.length > 0 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{failedJobs.length} job(s) con error</p>
              <button onClick={retryAllFailed} className="text-xs bg-destructive/10 text-destructive hover:bg-destructive/20 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors">
                <RefreshCw size={12} /> Reintentar todos
              </button>
            </div>
          )}
          {failedJobs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 size={32} className="mx-auto mb-2 text-success" />
              <p className="text-sm font-medium">Sin errores</p>
              <p className="text-xs mt-1">Todos los jobs se ejecutaron correctamente</p>
            </div>
          ) : (
            <div className="space-y-2">
              {failedJobs.map(job => (
                <div key={job.id} className="bg-card border border-destructive/20 rounded-xl p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <AlertTriangle size={14} className="text-destructive shrink-0" />
                        <span className="text-sm font-semibold text-foreground capitalize">{job.job_type.replace(/_/g, ' ')}</span>
                        <span className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">
                          {job.attempts}/{job.max_attempts} intentos
                        </span>
                      </div>
                      <p className="text-xs text-destructive/80 font-mono break-all">{job.last_error || 'Error desconocido'}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Call: {job.call_id?.substring(0, 8)}... · {format(new Date(job.updated_at), "d MMM HH:mm", { locale: es })}
                      </p>
                    </div>
                    <button
                      onClick={() => retryJob(job.id)}
                      className="text-xs bg-primary text-primary-foreground hover:opacity-90 px-3 py-1.5 rounded-lg flex items-center gap-1.5 shrink-0"
                    >
                      <RefreshCw size={12} /> Reintentar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pending Jobs */}
      {activeTab === 'pending' && (
        <div className="space-y-2">
          {pendingJobs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 size={32} className="mx-auto mb-2 text-success" />
              <p className="text-sm font-medium">Cola vacía</p>
              <p className="text-xs mt-1">No hay jobs pendientes de procesamiento</p>
            </div>
          ) : (
            pendingJobs.map(job => (
              <div key={job.id} className="bg-card border border-border rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  {job.status === 'running' ? (
                    <Loader2 size={16} className="text-primary animate-spin shrink-0" />
                  ) : (
                    <Clock size={16} className="text-muted-foreground shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground capitalize">{job.job_type.replace(/_/g, ' ')}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        job.status === 'running' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                      }`}>{job.status}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Intento {job.attempts + 1} · Programado: {format(new Date(job.run_after), "d MMM HH:mm:ss", { locale: es })}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Audit Logs */}
      {activeTab === 'audit' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2">
            <Search size={14} className="text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar en audit logs..."
              value={auditSearch}
              onChange={e => setAuditSearch(e.target.value)}
              className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          {filteredAudit.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Activity size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">Sin eventos de auditoría</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredAudit.map(log => (
                <div key={log.id} className="bg-card border border-border rounded-lg px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                      log.event_type.includes('failed') ? 'bg-destructive/10 text-destructive' :
                      log.event_type.includes('created') ? 'bg-success/10 text-success' :
                      'bg-primary/10 text-primary'
                    }`}>{log.event_type}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {format(new Date(log.created_at), "d MMM HH:mm:ss", { locale: es })}
                    </span>
                  </div>
                  {log.resource_type && (
                    <p className="text-xs text-muted-foreground">
                      {log.resource_type} · {log.resource_id?.substring(0, 8)}...
                    </p>
                  )}
                  {log.payload && Object.keys(log.payload).length > 0 && (
                    <details className="mt-1">
                      <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">Ver payload</summary>
                      <pre className="text-[10px] text-muted-foreground font-mono mt-1 bg-muted rounded p-2 overflow-auto max-h-32">{JSON.stringify(log.payload, null, 2)}</pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CallObservability;
