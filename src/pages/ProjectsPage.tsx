import { useState, useCallback } from 'react';
import { Plus, FolderKanban, Calendar, Users, ArrowUpCircle, ArrowRightCircle, ArrowDownCircle, Circle, Clock, CheckCircle2, AlertOctagon, ArrowLeft, User, ChevronRight, X } from 'lucide-react';
import { projects as initialProjects, tasks as initialTasks, teamMembers } from '@/data/mockData';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Task } from '@/types/app';
import { toast } from 'sonner';

const statusLabels: Record<string, { label: string; className: string }> = {
  planning: { label: 'Planificación', className: 'bg-muted text-muted-foreground' },
  active: { label: 'Activo', className: 'bg-primary/10 text-primary' },
  completed: { label: 'Completado', className: 'bg-success/10 text-success' },
  on_hold: { label: 'En pausa', className: 'bg-warning/10 text-warning' },
};

const taskStatusConfig: Record<string, { icon: any; label: string; dotClass: string }> = {
  todo: { icon: Circle, label: 'Por hacer', dotClass: 'bg-muted-foreground' },
  in_progress: { icon: Clock, label: 'En progreso', dotClass: 'bg-warning' },
  done: { icon: CheckCircle2, label: 'Hecho', dotClass: 'bg-success' },
  blocked: { icon: AlertOctagon, label: 'Bloqueado', dotClass: 'bg-destructive' },
};

const priorityConfig: Record<string, { icon: any; className: string; label: string }> = {
  high: { icon: ArrowUpCircle, className: 'text-destructive', label: 'Alta' },
  medium: { icon: ArrowRightCircle, className: 'text-warning', label: 'Media' },
  low: { icon: ArrowDownCircle, className: 'text-muted-foreground', label: 'Baja' },
};

const columns: Task['status'][] = ['todo', 'in_progress', 'blocked', 'done'];

// Status cycle: clicking advances the status
const nextStatus: Record<Task['status'], Task['status']> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: 'todo',
  blocked: 'todo',
};

interface TaskWithMeta extends Task {
  completedAt?: Date;
  completedBy?: string;
}

const ProjectsPage = () => {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'board'>('list');
  const [allTasks, setAllTasks] = useState<TaskWithMeta[]>(initialTasks.map(t => ({ ...t })));
  const [selectedTask, setSelectedTask] = useState<TaskWithMeta | null>(null);
  const [allProjects, setAllProjects] = useState(() => initialProjects.map(p => ({ ...p, milestones: p.milestones.map(m => ({ ...m })) })));

  const selectedProject = allProjects.find(p => p.id === selectedProjectId);
  const projectTasks = selectedProjectId ? allTasks.filter(t => t.projectId === selectedProjectId) : allTasks;

  const toggleMilestone = useCallback((projectId: string, milestoneId: string) => {
    setAllProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        milestones: p.milestones.map(m =>
          m.id === milestoneId ? { ...m, completed: !m.completed } : m
        ),
      };
    }));
    toast.success('Hito actualizado');
  }, []);

  const cycleTaskStatus = useCallback((taskId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setAllTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const newStatus = nextStatus[t.status];
      const updates: Partial<TaskWithMeta> = { status: newStatus };
      if (newStatus === 'done') {
        updates.completedAt = new Date();
        updates.completedBy = t.assignee;
        toast.success(`✅ "${t.title}" marcada como completada`);
      } else {
        updates.completedAt = undefined;
        updates.completedBy = undefined;
        if (newStatus === 'in_progress') {
          toast.info(`🔄 "${t.title}" en progreso`);
        }
      }
      const updated = { ...t, ...updates };
      // Also update selected task if viewing it
      if (selectedTask?.id === taskId) {
        setSelectedTask(updated);
      }
      return updated;
    }));
  }, [selectedTask]);

  const setTaskStatus = useCallback((taskId: string, newStatus: Task['status']) => {
    setAllTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const updates: Partial<TaskWithMeta> = { status: newStatus };
      if (newStatus === 'done') {
        updates.completedAt = new Date();
        updates.completedBy = t.assignee;
      } else {
        updates.completedAt = undefined;
        updates.completedBy = undefined;
      }
      const updated = { ...t, ...updates };
      if (selectedTask?.id === taskId) setSelectedTask(updated);
      return updated;
    }));
    toast.success('Estado actualizado');
  }, [selectedTask]);

  // Task detail panel
  const TaskDetailPanel = ({ task, onClose }: { task: TaskWithMeta; onClose: () => void }) => {
    const sConfig = taskStatusConfig[task.status];
    const pConfig = priorityConfig[task.priority];
    const PIcon = pConfig.icon;
    const StatusIcon = sConfig.icon;

    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
        <div
          className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-auto shadow-lg animate-in slide-in-from-bottom-4"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-card border-b border-border p-4 flex items-start justify-between gap-3 z-10">
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-bold text-foreground">{task.title}</h3>
              {task.description && (
                <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
              )}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground shrink-0">
              <X size={18} />
            </button>
          </div>

          <div className="p-4 space-y-5">
            {/* Status selector */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">Estado</p>
              <div className="flex flex-wrap gap-2">
                {columns.map(status => {
                  const cfg = taskStatusConfig[status];
                  const Icon = cfg.icon;
                  const isActive = task.status === status;
                  return (
                    <button
                      key={status}
                      onClick={() => setTaskStatus(task.id, status)}
                      className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-all ${
                        isActive
                          ? 'border-primary bg-primary/10 text-primary font-semibold'
                          : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-muted'
                      }`}
                    >
                      <Icon size={12} />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Assignee */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">Asignado a</p>
              <div className="flex items-center gap-3 bg-muted/50 rounded-lg px-3 py-2.5">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                  {task.assignee.split(' ').map(n => n[0]).join('')}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{task.assignee}</p>
                  <p className="text-xs text-muted-foreground">Responsable de la tarea</p>
                </div>
              </div>
            </div>

            {/* Priority */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">Prioridad</p>
              <div className={`flex items-center gap-2 text-sm ${pConfig.className}`}>
                <PIcon size={16} />
                <span className="font-medium">{pConfig.label}</span>
              </div>
            </div>

            {/* Due date */}
            {task.dueDate && (
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">Fecha límite</p>
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <Calendar size={14} className="text-muted-foreground" />
                  <span>{format(task.dueDate, "d 'de' MMMM yyyy", { locale: es })}</span>
                  {task.dueDate < new Date() && task.status !== 'done' && (
                    <span className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full">Vencida</span>
                  )}
                </div>
              </div>
            )}

            {/* Completion info */}
            {task.status === 'done' && (
              <div className="bg-success/5 border border-success/20 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 size={14} className="text-success" />
                  <span className="text-sm font-semibold text-success">Completada</span>
                </div>
                {task.completedBy && (
                  <p className="text-xs text-muted-foreground">
                    Completada por <span className="font-medium text-foreground">{task.completedBy}</span>
                    {task.completedAt && (
                      <> el {format(task.completedAt, "d MMM yyyy 'a las' HH:mm", { locale: es })}</>
                    )}
                  </p>
                )}
              </div>
            )}

            {/* Quick action */}
            <button
              onClick={() => {
                cycleTaskStatus(task.id);
              }}
              className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${
                task.status === 'done'
                  ? 'bg-muted text-muted-foreground hover:bg-muted/80'
                  : task.status === 'in_progress'
                    ? 'bg-success text-success-foreground hover:opacity-90'
                    : 'bg-primary text-primary-foreground hover:opacity-90'
              }`}
            >
              {task.status === 'todo' && '▶ Iniciar tarea'}
              {task.status === 'in_progress' && '✅ Marcar como completada'}
              {task.status === 'done' && '↩ Reabrir tarea'}
              {task.status === 'blocked' && '🔓 Desbloquear'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ===== PROJECT DETAIL VIEW =====
  if (selectedProject) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 border-b border-border p-4 sm:p-5 bg-card">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => setSelectedProjectId(null)} className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1">
              <ArrowLeft size={14} /> Proyectos
            </button>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusLabels[selectedProject.status].className}`}>{statusLabels[selectedProject.status].label}</span>
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-foreground">{selectedProject.name}</h2>
          <p className="text-sm text-muted-foreground mt-1">{selectedProject.description}</p>
          <div className="flex flex-wrap items-center gap-4 sm:gap-6 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Calendar size={12} /> {format(selectedProject.startDate, 'd MMM', { locale: es })} - {format(selectedProject.endDate, 'd MMM', { locale: es })}</span>
            <span className="flex items-center gap-1"><Users size={12} /> {selectedProject.teamIds.length}</span>
            {(() => {
              const total = projectTasks.length;
              const done = projectTasks.filter(t => t.status === 'done').length;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              return (
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
                  <span>{pct}%</span>
                </div>
              );
            })()}
          </div>

          {selectedProject.milestones.length > 0 && (
            <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1">
              {selectedProject.milestones.map((m, i) => (
                <div key={m.id} className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => toggleMilestone(selectedProject.id, m.id)}
                    className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs transition-colors ${m.completed ? 'border-success/30 bg-success/10 text-success' : 'border-border text-muted-foreground hover:border-success/40 hover:bg-success/5 hover:text-foreground'}`}
                    title={m.completed ? 'Marcar como pendiente' : 'Marcar como completado'}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full border ${m.completed ? 'bg-success border-success' : 'border-border bg-card'}`} />
                    <span className={m.completed ? 'line-through' : ''}>{m.name}</span>
                    <span className={`text-[10px] ${m.completed ? 'text-success' : 'text-muted-foreground'}`}>
                      {m.completed ? 'Completado' : 'Pendiente'}
                    </span>
                  </button>
                  {i < selectedProject.milestones.length - 1 && <div className="w-6 h-px bg-border" />}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1 mt-4">
            <button onClick={() => setView('board')} className={`text-xs px-3 py-1 rounded-md ${view === 'board' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>Kanban</button>
            <button onClick={() => setView('list')} className={`text-xs px-3 py-1 rounded-md ${view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>Lista</button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {view === 'board' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 min-w-0">
              {columns.map(status => {
                const config = taskStatusConfig[status];
                const colTasks = projectTasks.filter(t => t.status === status);
                return (
                  <div key={status} className="flex flex-col">
                    <div className="flex items-center gap-2 mb-3 px-1">
                      <div className={`w-2 h-2 rounded-full ${config.dotClass}`} />
                      <span className="text-sm font-semibold text-foreground">{config.label}</span>
                      <span className="text-xs text-muted-foreground bg-muted rounded-full w-5 h-5 flex items-center justify-center">{colTasks.length}</span>
                    </div>
                    <div className="space-y-2 overflow-y-auto scrollbar-thin">
                      {colTasks.map(task => {
                        const PIcon = priorityConfig[task.priority].icon;
                        return (
                          <button
                            key={task.id}
                            onClick={() => setSelectedTask(task)}
                            className="w-full text-left bg-card border border-border rounded-lg p-3 shadow-sm hover:shadow-md hover:border-primary/30 transition-all"
                          >
                            <div className="flex items-start justify-between mb-1.5">
                              <h4 className={`text-sm font-medium leading-tight ${task.status === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{task.title}</h4>
                              <PIcon size={14} className={`shrink-0 ml-2 ${priorityConfig[task.priority].className}`} />
                            </div>
                            {task.description && <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{task.description}</p>}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">{task.assignee.split(' ').map(n => n[0]).join('')}</div>
                                <span className="text-xs text-muted-foreground">{task.assignee.split(' ')[0]}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {task.dueDate && <span className="text-xs text-muted-foreground">{format(task.dueDate, 'd MMM', { locale: es })}</span>}
                                {task.status === 'done' && task.completedAt && (
                                  <CheckCircle2 size={12} className="text-success" />
                                )}
                              </div>
                            </div>
                            {task.status === 'done' && task.completedBy && (
                              <p className="text-[10px] text-success mt-1.5">
                                ✅ {task.completedBy} {task.completedAt && `· ${format(task.completedAt, 'd MMM HH:mm', { locale: es })}`}
                              </p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {projectTasks.map(task => {
                const PIcon = priorityConfig[task.priority].icon;
                const sConfig = taskStatusConfig[task.status];
                const StatusIcon = sConfig.icon;
                return (
                  <button
                    key={task.id}
                    onClick={() => setSelectedTask(task)}
                    className="w-full bg-card border border-border rounded-lg p-3 flex items-center gap-3 sm:gap-4 hover:shadow-md hover:border-primary/30 transition-all text-left"
                  >
                    {/* Status toggle button */}
                    <button
                      onClick={(e) => cycleTaskStatus(task.id, e)}
                      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border-2 transition-all hover:scale-110 ${
                        task.status === 'done'
                          ? 'bg-success border-success text-success-foreground'
                          : task.status === 'in_progress'
                            ? 'border-warning bg-warning/10'
                            : task.status === 'blocked'
                              ? 'border-destructive bg-destructive/10'
                              : 'border-border hover:border-primary'
                      }`}
                      title={`Cambiar a: ${taskStatusConfig[nextStatus[task.status]].label}`}
                    >
                      {task.status === 'done' && <CheckCircle2 size={12} />}
                      {task.status === 'in_progress' && <Clock size={10} className="text-warning" />}
                      {task.status === 'blocked' && <AlertOctagon size={10} className="text-destructive" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${task.status === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{task.title}</p>
                      {task.description && <p className="text-xs text-muted-foreground truncate">{task.description}</p>}
                      {task.status === 'done' && task.completedBy && (
                        <p className="text-[10px] text-success mt-0.5">
                          Completada por {task.completedBy}
                          {task.completedAt && ` · ${format(task.completedAt, 'd MMM HH:mm', { locale: es })}`}
                        </p>
                      )}
                    </div>

                    {/* Assignee - always visible */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                        {task.assignee.split(' ').map(n => n[0]).join('')}
                      </div>
                      <span className="text-xs text-muted-foreground hidden sm:block max-w-[80px] truncate">{task.assignee.split(' ')[0]}</span>
                    </div>

                    <PIcon size={14} className={`shrink-0 ${priorityConfig[task.priority].className}`} />

                    {task.dueDate && (
                      <span className={`text-xs shrink-0 hidden sm:block ${
                        task.dueDate < new Date() && task.status !== 'done' ? 'text-destructive font-medium' : 'text-muted-foreground'
                      }`}>
                        {format(task.dueDate, 'd MMM', { locale: es })}
                      </span>
                    )}

                    <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 hidden sm:block ${
                      task.status === 'done' ? 'bg-success/10 text-success' :
                      task.status === 'in_progress' ? 'bg-warning/10 text-warning' :
                      task.status === 'blocked' ? 'bg-destructive/10 text-destructive' :
                      'bg-muted text-muted-foreground'
                    }`}>{sConfig.label}</span>

                    <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Task detail modal */}
        {selectedTask && <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTask(null)} />}
      </div>
    );
  }

  // ===== PROJECTS LIST =====
  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-bold text-foreground">Proyectos</h1>
        <button className="flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 w-fit">
          <Plus size={16} /> Nuevo Proyecto
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {allProjects.map(proj => {
          const projTasks = allTasks.filter(t => t.projectId === proj.id);
          const doneTasks = projTasks.filter(t => t.status === 'done').length;
          const computedProgress = projTasks.length > 0 ? Math.round((doneTasks / projTasks.length) * 100) : 0;
          return (
            <button key={proj.id} onClick={() => setSelectedProjectId(proj.id)} className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow text-left">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FolderKanban size={16} className="text-primary" />
                  <h3 className="font-semibold text-foreground">{proj.name}</h3>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusLabels[proj.status].className}`}>{statusLabels[proj.status].label}</span>
              </div>
              <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{proj.description}</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full transition-all" style={{ width: `${computedProgress}%` }} /></div>
                  <span className="text-xs text-muted-foreground">{computedProgress}%</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {projTasks.length > 0 && (
                    <span className="flex items-center gap-1">
                      <CheckCircle2 size={12} className="text-success" /> {doneTasks}/{projTasks.length}
                    </span>
                  )}
                  <span className="flex items-center gap-1"><Users size={12} /> {proj.teamIds.length}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ProjectsPage;
