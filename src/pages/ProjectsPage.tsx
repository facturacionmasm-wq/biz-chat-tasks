import { useState } from 'react';
import { Plus, FolderKanban, Calendar, Users, ArrowUpCircle, ArrowRightCircle, ArrowDownCircle, Circle, Clock, CheckCircle2, AlertOctagon } from 'lucide-react';
import { projects, tasks, teamMembers } from '@/data/mockData';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Task } from '@/types/app';

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

const priorityConfig: Record<string, { icon: any; className: string }> = {
  high: { icon: ArrowUpCircle, className: 'text-destructive' },
  medium: { icon: ArrowRightCircle, className: 'text-warning' },
  low: { icon: ArrowDownCircle, className: 'text-muted-foreground' },
};

const columns: Task['status'][] = ['todo', 'in_progress', 'blocked', 'done'];

const ProjectsPage = () => {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'board'>('list');

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const projectTasks = selectedProjectId ? tasks.filter(t => t.projectId === selectedProjectId) : tasks;

  if (selectedProject) {
    return (
      <div className="flex flex-col h-full">
        {/* Project header */}
        <div className="shrink-0 border-b border-border p-5 bg-card">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => setSelectedProjectId(null)} className="text-muted-foreground hover:text-foreground text-sm">← Proyectos</button>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusLabels[selectedProject.status].className}`}>
              {statusLabels[selectedProject.status].label}
            </span>
          </div>
          <h2 className="text-xl font-bold text-foreground">{selectedProject.name}</h2>
          <p className="text-sm text-muted-foreground mt-1">{selectedProject.description}</p>
          <div className="flex items-center gap-6 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Calendar size={12} /> {format(selectedProject.startDate, 'd MMM yyyy', { locale: es })} - {format(selectedProject.endDate, 'd MMM yyyy', { locale: es })}</span>
            <span className="flex items-center gap-1"><Users size={12} /> {selectedProject.teamIds.length} miembros</span>
            <div className="flex items-center gap-2">
              <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${selectedProject.progress}%` }} />
              </div>
              <span>{selectedProject.progress}%</span>
            </div>
          </div>

          {/* Milestones */}
          {selectedProject.milestones.length > 0 && (
            <div className="mt-4 flex items-center gap-2 overflow-x-auto">
              {selectedProject.milestones.map((m, i) => (
                <div key={m.id} className="flex items-center gap-1.5 shrink-0">
                  <div className={`w-3 h-3 rounded-full border-2 ${m.completed ? 'bg-success border-success' : 'border-border bg-card'}`} />
                  <span className={`text-xs ${m.completed ? 'text-success' : 'text-muted-foreground'}`}>{m.name}</span>
                  <span className="text-[10px] text-muted-foreground">({format(m.date, 'd MMM', { locale: es })})</span>
                  {i < selectedProject.milestones.length - 1 && <div className="w-6 h-px bg-border" />}
                </div>
              ))}
            </div>
          )}

          {/* View toggle */}
          <div className="flex items-center gap-1 mt-4">
            <button onClick={() => setView('board')} className={`text-xs px-3 py-1 rounded-md ${view === 'board' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>Kanban</button>
            <button onClick={() => setView('list')} className={`text-xs px-3 py-1 rounded-md ${view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>Lista</button>
          </div>
        </div>

        {/* Kanban board */}
        <div className="flex-1 overflow-auto p-4">
          {view === 'board' ? (
            <div className="grid grid-cols-4 gap-4 h-full min-w-[800px]">
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
                    <div className="flex-1 space-y-2 overflow-y-auto scrollbar-thin">
                      {colTasks.map(task => {
                        const PIcon = priorityConfig[task.priority].icon;
                        return (
                          <div key={task.id} className="bg-card border border-border rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex items-start justify-between mb-1.5">
                              <h4 className="text-sm font-medium text-foreground leading-tight">{task.title}</h4>
                              <PIcon size={14} className={`shrink-0 ml-2 ${priorityConfig[task.priority].className}`} />
                            </div>
                            {task.description && <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{task.description}</p>}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <div className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold text-secondary-foreground">
                                  {task.assignee.split(' ').map(n => n[0]).join('')}
                                </div>
                                <span className="text-xs text-muted-foreground">{task.assignee.split(' ')[0]}</span>
                              </div>
                              {task.dueDate && <span className="text-xs text-muted-foreground">{format(task.dueDate, 'd MMM', { locale: es })}</span>}
                            </div>
                          </div>
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
                return (
                  <div key={task.id} className="bg-card border border-border rounded-lg p-3 flex items-center gap-4 hover:shadow-sm transition-shadow">
                    <div className={`w-2 h-2 rounded-full ${sConfig.dotClass}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
                      {task.description && <p className="text-xs text-muted-foreground truncate">{task.description}</p>}
                    </div>
                    <span className="text-xs text-muted-foreground">{task.assignee}</span>
                    <PIcon size={14} className={priorityConfig[task.priority].className} />
                    {task.dueDate && <span className="text-xs text-muted-foreground">{format(task.dueDate, 'd MMM', { locale: es })}</span>}
                    <span className="text-xs text-muted-foreground">{sConfig.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-foreground">Proyectos</h1>
        <button className="flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity">
          <Plus size={16} /> Nuevo Proyecto
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {projects.map(proj => (
          <button
            key={proj.id}
            onClick={() => setSelectedProjectId(proj.id)}
            className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow text-left"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <FolderKanban size={16} className="text-primary" />
                <h3 className="font-semibold text-foreground">{proj.name}</h3>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusLabels[proj.status].className}`}>
                {statusLabels[proj.status].label}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{proj.description}</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden w-24">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${proj.progress}%` }} />
                </div>
                <span className="text-xs text-muted-foreground">{proj.progress}%</span>
              </div>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Users size={12} /> {proj.teamIds.length}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default ProjectsPage;
