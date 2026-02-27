import { CalendarDays, CheckCircle2, AlertTriangle, TrendingUp, Clock, Target, FolderKanban, Sparkles, ArrowRight } from 'lucide-react';
import { tasks, projects, okrs, calendarEvents } from '@/data/mockData';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Link } from 'react-router-dom';

const Dashboard = () => {
  const urgentTasks = tasks.filter(t => t.priority === 'high' && t.status !== 'done');
  const blockedTasks = tasks.filter(t => t.status === 'blocked');
  const todayEvents = calendarEvents.filter(e => {
    const today = new Date();
    return e.date.toDateString() === today.toDateString() || e.date > today;
  }).slice(0, 4);
  const activeProjects = projects.filter(p => p.status === 'active');
  const avgOkrProgress = Math.round(okrs.reduce((sum, o) => sum + o.progress, 0) / okrs.length);

  const stats = [
    { label: 'Tareas pendientes', value: tasks.filter(t => t.status === 'todo').length, icon: Clock, color: 'text-warning' },
    { label: 'En progreso', value: tasks.filter(t => t.status === 'in_progress').length, icon: TrendingUp, color: 'text-primary' },
    { label: 'Completadas', value: tasks.filter(t => t.status === 'done').length, icon: CheckCircle2, color: 'text-success' },
    { label: 'Bloqueadas', value: blockedTasks.length, icon: AlertTriangle, color: 'text-destructive' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Welcome */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Buenos días 👋</h1>
          <p className="text-muted-foreground text-sm mt-1">Aquí tienes un resumen de lo que está pasando hoy.</p>
        </div>
        <div className="flex items-center gap-2 bg-primary/10 text-primary border border-primary/20 rounded-lg px-4 py-2 text-sm font-medium">
          <Sparkles size={16} />
          <span>Resumen IA semanal disponible</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">{s.label}</span>
              <s.icon size={18} className={s.color} />
            </div>
            <p className="text-2xl font-bold text-foreground">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Upcoming events */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <CalendarDays size={16} className="text-primary" /> Próximos eventos
            </h3>
            <Link to="/calendar" className="text-xs text-primary hover:underline flex items-center gap-1">
              Ver todos <ArrowRight size={12} />
            </Link>
          </div>
          <div className="space-y-3">
            {todayEvents.map(ev => (
              <div key={ev.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-secondary/50 transition-colors">
                <div className="text-center shrink-0 w-10">
                  <p className="text-[10px] uppercase text-muted-foreground">{format(ev.date, 'MMM', { locale: es })}</p>
                  <p className="text-lg font-bold text-foreground leading-tight">{format(ev.date, 'd')}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{ev.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {ev.endDate ? `${format(ev.date, 'HH:mm')} - ${format(ev.endDate, 'HH:mm')}` : 'Todo el día'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Urgent tasks */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle size={16} className="text-warning" /> Tareas urgentes
            </h3>
            <Link to="/projects" className="text-xs text-primary hover:underline flex items-center gap-1">
              Ver todas <ArrowRight size={12} />
            </Link>
          </div>
          <div className="space-y-2">
            {urgentTasks.slice(0, 5).map(task => (
              <div key={task.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/50 transition-colors">
                <div className={`w-2 h-2 rounded-full shrink-0 ${task.status === 'blocked' ? 'bg-destructive' : 'bg-warning'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
                  <p className="text-xs text-muted-foreground">{task.assignee} {task.dueDate ? `· ${format(task.dueDate, 'd MMM', { locale: es })}` : ''}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* OKR Progress */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Target size={16} className="text-primary" /> Avance OKRs
            </h3>
            <Link to="/okrs" className="text-xs text-primary hover:underline flex items-center gap-1">
              Ver todos <ArrowRight size={12} />
            </Link>
          </div>
          <div className="text-center mb-4">
            <div className="relative w-20 h-20 mx-auto">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="hsl(var(--primary))" strokeWidth="3"
                  strokeDasharray={`${avgOkrProgress} ${100 - avgOkrProgress}`} strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-foreground">{avgOkrProgress}%</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Promedio general Q1</p>
          </div>
          <div className="space-y-2">
            {okrs.map(okr => (
              <div key={okr.id} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{okr.title}</p>
                </div>
                <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${okr.progress}%` }} />
                </div>
                <span className="text-xs text-muted-foreground w-8 text-right">{okr.progress}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Projects at risk & AI Summary */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
            <FolderKanban size={16} className="text-primary" /> Proyectos activos
          </h3>
          <div className="space-y-3">
            {activeProjects.map(proj => (
              <div key={proj.id} className="p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-foreground">{proj.name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    proj.progress >= 60 ? 'bg-success/10 text-success' : proj.progress >= 30 ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'
                  }`}>{proj.progress}%</span>
                </div>
                <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${proj.progress}%` }} />
                </div>
                <p className="text-xs text-muted-foreground mt-2">{proj.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
            <Sparkles size={16} className="text-primary" /> Resumen IA semanal
          </h3>
          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="p-3 bg-primary/5 rounded-lg border border-primary/10">
              <p className="font-medium text-foreground mb-1">📊 Productividad</p>
              <p>El equipo completó 12 tareas esta semana, un 20% más que la semana anterior. Carlos fue el más productivo con 5 tareas completadas.</p>
            </div>
            <div className="p-3 bg-warning/5 rounded-lg border border-warning/10">
              <p className="font-medium text-foreground mb-1">⚠️ Alertas</p>
              <p>Hay 1 tarea bloqueada (integrar pasarela de pago) y 2 tareas próximas a vencer. Se recomienda reasignar recursos.</p>
            </div>
            <div className="p-3 bg-success/5 rounded-lg border border-success/10">
              <p className="font-medium text-foreground mb-1">✅ Logros</p>
              <p>Se completó la migración a Cloud y los mockups del proyecto v2.0 están al 90%. El OKR de satisfacción del equipo va en excelente camino.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
