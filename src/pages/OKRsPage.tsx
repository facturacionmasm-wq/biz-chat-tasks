import { useState } from 'react';
import { Target, Plus, ChevronDown, ChevronRight, TrendingUp, User } from 'lucide-react';
import { okrs } from '@/data/mockData';

const priorityColors: Record<string, string> = {
  high: 'bg-destructive/10 text-destructive',
  medium: 'bg-warning/10 text-warning',
  low: 'bg-muted text-muted-foreground',
};

const OKRsPage = () => {
  const [expandedOkr, setExpandedOkr] = useState<string | null>('okr1');
  const avgProgress = Math.round(okrs.reduce((s, o) => s + o.progress, 0) / okrs.length);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Objetivos y Resultados Clave</h1>
          <p className="text-sm text-muted-foreground mt-1">Q1 2026 · Progreso general: {avgProgress}%</p>
        </div>
        <button className="flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90">
          <Plus size={16} /> Nuevo OKR
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm text-center">
          <div className="relative w-16 h-16 mx-auto mb-2">
            <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="14" fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
              <circle cx="18" cy="18" r="14" fill="none" stroke="hsl(var(--primary))" strokeWidth="3"
                strokeDasharray={`${avgProgress} ${100 - avgProgress}`} strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-base font-bold text-foreground">{avgProgress}%</span>
          </div>
          <p className="text-xs text-muted-foreground">Promedio general</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-2xl font-bold text-foreground">{okrs.length}</p>
          <p className="text-xs text-muted-foreground">Objetivos activos</p>
          <p className="text-xs text-success mt-1 flex items-center gap-1"><TrendingUp size={12} /> En camino</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-2xl font-bold text-foreground">{okrs.reduce((s, o) => s + o.keyResults.length, 0)}</p>
          <p className="text-xs text-muted-foreground">Resultados clave</p>
          <p className="text-xs text-muted-foreground mt-1">{okrs.reduce((s, o) => s + o.keyResults.filter(kr => kr.progress >= 80).length, 0)} completados (&gt;80%)</p>
        </div>
      </div>

      {/* OKR list */}
      <div className="space-y-3">
        {okrs.map(okr => {
          const isExpanded = expandedOkr === okr.id;
          return (
            <div key={okr.id} className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              <button
                onClick={() => setExpandedOkr(isExpanded ? null : okr.id)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-secondary/30 transition-colors"
              >
                {isExpanded ? <ChevronDown size={16} className="text-muted-foreground shrink-0" /> : <ChevronRight size={16} className="text-muted-foreground shrink-0" />}
                <Target size={16} className="text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">{okr.title}</h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><User size={10} /> {okr.owner}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${priorityColors[okr.priority]}`}>{okr.priority === 'high' ? 'Alta' : okr.priority === 'medium' ? 'Media' : 'Baja'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-20 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${okr.progress >= 70 ? 'bg-success' : okr.progress >= 40 ? 'bg-warning' : 'bg-destructive'}`} style={{ width: `${okr.progress}%` }} />
                  </div>
                  <span className="text-sm font-semibold text-foreground w-10 text-right">{okr.progress}%</span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border px-4 pb-4 pt-3 space-y-3 bg-muted/20">
                  {okr.keyResults.map(kr => (
                    <div key={kr.id} className="flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground">{kr.title}</p>
                        <p className="text-xs text-muted-foreground">{kr.current} / {kr.target} {kr.unit}</p>
                      </div>
                      <div className="w-28 h-1.5 bg-secondary rounded-full overflow-hidden shrink-0">
                        <div className={`h-full rounded-full ${kr.progress >= 80 ? 'bg-success' : kr.progress >= 50 ? 'bg-warning' : 'bg-destructive'}`} style={{ width: `${kr.progress}%` }} />
                      </div>
                      <span className="text-xs font-medium text-muted-foreground w-10 text-right">{kr.progress}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OKRsPage;
