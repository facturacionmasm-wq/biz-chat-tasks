import { useState, useEffect, useCallback } from 'react';
import { Target, Plus, ChevronDown, ChevronRight, TrendingUp, User, Loader2, Trash2, Edit3, X, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface KeyResult {
  id: string;
  title: string;
  current_value: number;
  target_value: number;
  unit: string | null;
  progress: number;
}

interface OKR {
  id: string;
  title: string;
  description: string | null;
  quarter: string;
  progress: number;
  priority: 'high' | 'medium' | 'low';
  owner_id: string | null;
  owner_name?: string;
  key_results: KeyResult[];
}

const priorityColors: Record<string, string> = {
  high: 'bg-destructive/10 text-[var(--rx-rose)]',
  medium: 'bg-warning/10 text-[var(--rx-amber)]',
  low: 'bg-[var(--rx-s2)] text-[var(--rx-t2)]',
};

const priorityLabels: Record<string, string> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};

const OKRsPage = () => {
  const { user } = useAuth();
  const [okrs, setOkrs] = useState<OKR[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedOkr, setExpandedOkr] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    quarter: `Q${Math.ceil((new Date().getMonth() + 1) / 3)} ${new Date().getFullYear()}`,
    priority: 'medium' as 'high' | 'medium' | 'low',
  });

  const fetchOKRs = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: tid } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tid) { toast.error('No se pudo identificar tu empresa'); return; }
      setTenantId(tid);

      // Fetch OKRs — uses project_milestones as proxy if no okrs table exists,
      // or falls back to projects with type=okr. Adjust table name to your schema.
      const { data: okrData, error } = await supabase
        .from('projects')
        .select(`
          id, name, description, status, created_at,
          project_milestones ( id, title, description, progress, due_date )
        `)
        .eq('tenant_id', tid)
        .eq('type', 'okr')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error && error.code !== 'PGRST116') {
        // Table or column doesn't exist — show empty state
        console.warn('[OKRs] table/column not found:', error.message);
        setOkrs([]);
        return;
      }

      // Map projects+milestones → OKR shape
      const mapped: OKR[] = (okrData || []).map((p: any) => {
        const krs: KeyResult[] = (p.project_milestones || []).map((m: any) => ({
          id: m.id,
          title: m.title,
          current_value: m.progress || 0,
          target_value: 100,
          unit: '%',
          progress: m.progress || 0,
        }));
        const avgProgress = krs.length > 0
          ? Math.round(krs.reduce((s, k) => s + k.progress, 0) / krs.length)
          : 0;
        return {
          id: p.id,
          title: p.name,
          description: p.description,
          quarter: `Q${Math.ceil((new Date(p.created_at).getMonth() + 1) / 3)} ${new Date(p.created_at).getFullYear()}`,
          progress: avgProgress,
          priority: 'medium',
          owner_id: null,
          key_results: krs,
        };
      });

      setOkrs(mapped);
      if (mapped.length > 0) setExpandedOkr(mapped[0].id);
    } catch (err: any) {
      console.error('[OKRs] fetch error:', err);
      // Silent: OKR feature may not be fully set up yet
      setOkrs([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchOKRs(); }, [fetchOKRs]);

  const handleCreate = async () => {
    if (!form.title.trim()) { toast.error('El título es obligatorio'); return; }
    if (!tenantId || !user) return;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('projects')
        .insert({
          tenant_id: tenantId,
          name: form.title.trim(),
          description: form.description.trim() || null,
          status: 'active',
          type: 'okr',
          created_by: user.id,
        })
        .select('id')
        .single();
      if (error) throw error;
      toast.success('OKR creado');
      setShowForm(false);
      setForm(prev => ({ ...prev, title: '', description: '' }));
      fetchOKRs();
    } catch (err: any) {
      toast.error(err.message || 'Error al crear OKR');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`¿Eliminar OKR "${title}"?`)) return;
    try {
      const { error } = await supabase
        .from('projects')
        .update({ deleted_at: new Date().toISOString(), status: 'archived' })
        .eq('id', id)
        .eq('tenant_id', tenantId);
      if (error) throw error;
      toast.success('OKR eliminado');
      setOkrs(prev => prev.filter(o => o.id !== id));
    } catch (err: any) {
      toast.error(err.message || 'Error al eliminar');
    }
  };

  const avgProgress = okrs.length > 0
    ? Math.round(okrs.reduce((s, o) => s + o.progress, 0) / okrs.length)
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <Loader2 size={28} className="animate-spin text-[var(--rx-brand)]" />
      </div>
    );
  }

  return (
    <div className="rx-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="rx-page-title">Objetivos y Resultados Clave</h1>
          <p className="text-sm text-[var(--rx-t2)] mt-1">
            {form.quarter} · Progreso general: {avgProgress}%
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90"
        >
          <Plus size={16} /> Nuevo OKR
        </button>
      </div>

      {/* New OKR Form */}
      {showForm && (
        <div className="rx-panel">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Crear OKR</h3>
            <button onClick={() => setShowForm(false)}><X size={15} className="text-[var(--rx-t2)]" /></button>
          </div>
          <input
            type="text"
            value={form.title}
            onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            placeholder="Título del objetivo *"
            className="w-full px-3 py-2 bg-[var(--rx-s2)]/50 rounded-lg text-sm border border-[var(--rx-b1)] focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <textarea
            value={form.description}
            onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            placeholder="Descripción (opcional)"
            rows={2}
            className="w-full px-3 py-2 bg-[var(--rx-s2)]/50 rounded-lg text-sm border border-[var(--rx-b1)] focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
          />
          <div className="flex items-center gap-3">
            <select
              value={form.priority}
              onChange={e => setForm(p => ({ ...p, priority: e.target.value as any }))}
              className="px-3 py-2 bg-[var(--rx-s2)]/50 rounded-lg text-sm border border-[var(--rx-b1)] focus:outline-none"
            >
              <option value="high">Alta prioridad</option>
              <option value="medium">Media prioridad</option>
              <option value="low">Baja prioridad</option>
            </select>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="flex items-center gap-1.5 bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : null}
              {saving ? 'Creando...' : 'Crear OKR'}
            </button>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {okrs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="rx-panel">
            <div className="relative w-16 h-16 mx-auto mb-2">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="14" fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
                <circle cx="18" cy="18" r="14" fill="none" stroke="hsl(var(--primary))" strokeWidth="3"
                  strokeDasharray={`${avgProgress} ${100 - avgProgress}`} strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-base font-bold text-foreground">{avgProgress}%</span>
            </div>
            <p className="text-xs text-[var(--rx-t2)]">Promedio general</p>
          </div>
          <div className="rx-panel">
            <div className="text-2xl font-bold text-foreground mb-1">{okrs.length}</div>
            <p className="text-xs text-[var(--rx-t2)]">OKRs activos</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {['high', 'medium', 'low'].map(p => {
                const count = okrs.filter(o => o.priority === p).length;
                if (!count) return null;
                return (
                  <span key={p} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${priorityColors[p]}`}>
                    {count} {priorityLabels[p]}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="rx-panel">
            <div className="text-2xl font-bold text-foreground mb-1">
              {okrs.reduce((s, o) => s + o.key_results.length, 0)}
            </div>
            <p className="text-xs text-[var(--rx-t2)]">Resultados clave</p>
            <div className="mt-2">
              <div className="text-xs text-[var(--rx-emerald)] font-medium">
                {okrs.filter(o => o.progress >= 100).length} completados
              </div>
            </div>
          </div>
        </div>
      )}

      {/* OKR List */}
      {okrs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle size={36} className="text-[var(--rx-t2)]/30 mb-3" />
          <p className="text-sm font-medium text-[var(--rx-t2)] mb-1">No hay OKRs todavía</p>
          <p className="text-xs text-[var(--rx-t2)] mb-4">Crea tu primer objetivo para este trimestre</p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground text-sm px-4 py-2 rounded-xl hover:opacity-90"
          >
            <Plus size={14} /> Crear OKR
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {okrs.map(okr => (
            <div key={okr.id} className="rx-panel">
              <div
                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-[var(--rx-s2)]/30 transition-colors"
                onClick={() => setExpandedOkr(expandedOkr === okr.id ? null : okr.id)}
              >
                <button className="shrink-0 text-[var(--rx-t2)]">
                  {expandedOkr === okr.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Target size={14} className="text-[var(--rx-brand)] shrink-0" />
                    <span className="font-semibold text-sm text-foreground">{okr.title}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${priorityColors[okr.priority]}`}>
                      {priorityLabels[okr.priority]}
                    </span>
                  </div>
                  {okr.description && (
                    <p className="text-xs text-[var(--rx-t2)] mt-0.5 truncate">{okr.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right hidden sm:block">
                    <div className="text-sm font-bold text-foreground">{okr.progress}%</div>
                    <div className="w-20 h-1.5 bg-[var(--rx-s2)] rounded-full mt-1">
                      <div
                        className="h-full bg-[var(--rx-brand)] rounded-full transition-all"
                        style={{ width: `${Math.min(okr.progress, 100)}%` }}
                      />
                    </div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(okr.id, okr.title); }}
                    className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 size={13} className="text-[var(--rx-t2)] hover:text-[var(--rx-rose)]" />
                  </button>
                </div>
              </div>

              {expandedOkr === okr.id && (
                <div className="px-4 pb-4 border-t border-[var(--rx-b1)] pt-3 space-y-3">
                  {okr.key_results.length === 0 ? (
                    <p className="text-xs text-[var(--rx-t2)] text-center py-2">
                      Sin resultados clave. Agrega hitos en la vista de Proyectos.
                    </p>
                  ) : (
                    okr.key_results.map(kr => (
                      <div key={kr.id} className="flex items-center gap-3">
                        <TrendingUp size={13} className="text-[var(--rx-t2)] shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-foreground truncate">{kr.title}</span>
                            <span className="text-xs font-bold text-foreground ml-2 shrink-0">{kr.progress}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-[var(--rx-s2)] rounded-full">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(kr.progress, 100)}%`,
                                backgroundColor: kr.progress >= 100 ? 'hsl(var(--success))' : 'hsl(var(--primary))',
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default OKRsPage;
