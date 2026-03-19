import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Plus, FolderKanban, Calendar, Users, ArrowUpCircle, ArrowRightCircle, ArrowDownCircle,
  Circle, Clock, CheckCircle2, AlertOctagon, ArrowLeft, ChevronRight, X, BarChart3,
  Target, Milestone as MilestoneIcon, Edit3, Trash2, Timer, User, FileText
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Task } from '@/types/app';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectsPersistence } from '@/hooks/useProjectsPersistence';

interface RealTeamMember {
  id: string;
  name: string;
  role: string;
  email: string;
}

const statusLabels: Record<string, { label: string; className: string }> = {
  planning: { label: 'Planificación', className: 'bg-muted text-muted-foreground' },
  active: { label: 'Activo', className: 'bg-primary/10 text-primary' },
  completed: { label: 'Completado', className: 'bg-success/10 text-success' },
  on_hold: { label: 'En pausa', className: 'bg-warning/10 text-warning' },
};

const projectStatuses = ['planning', 'active', 'on_hold', 'completed'] as const;

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

const nextStatus: Record<Task['status'], Task['status']> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: 'todo',
  blocked: 'todo',
};

interface TaskWithMeta extends Task {
  completedAt?: Date;
  completedBy?: string;
  estimatedHours?: number;
}

const ProjectsPage = () => {
  const { user } = useAuth();
  const {
    projects: allProjects, tasks: allTasks, loading: dbLoading,
    createProject: dbCreateProject, updateProjectStatus: dbUpdateProjectStatus,
    createTask: dbCreateTask, updateTaskStatus: dbUpdateTaskStatus,
    deleteTask: dbDeleteTask, createMilestone: dbCreateMilestone,
    toggleMilestone: dbToggleMilestone, deleteMilestone: dbDeleteMilestone,
    setTasks: setAllTasks, setProjects: setAllProjects,
  } = useProjectsPersistence();
  const [teamMembers, setTeamMembers] = useState<RealTeamMember[]>([]);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'board'>('list');
  const [selectedTask, setSelectedTask] = useState<TaskWithMeta | null>(null);

  // New project modal
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newProjectStartDate, setNewProjectStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [newProjectEndDate, setNewProjectEndDate] = useState(format(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'));
  const [newProjectTeam, setNewProjectTeam] = useState<string[]>([]);
  const [newProjectStatus, setNewProjectStatus] = useState<'planning' | 'active'>('planning');

  // New task modal
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [newTaskEstHours, setNewTaskEstHours] = useState('');

  // New milestone modal
  const [showNewMilestone, setShowNewMilestone] = useState(false);
  const [newMilestoneName, setNewMilestoneName] = useState('');
  const [newMilestoneDate, setNewMilestoneDate] = useState('');

  // Load real team members from DB
  useEffect(() => {
    if (!user) return;
    const loadTeam = async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!profile) return;

      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, name, email')
        .eq('tenant_id', profile.tenant_id);

      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .eq('tenant_id', profile.tenant_id);

      const roleMap = new Map((roles || []).map(r => [r.user_id, r.role]));

      setTeamMembers(
        (profiles || []).map(p => ({
          id: p.user_id,
          name: p.name || p.email || 'Sin nombre',
          role: roleMap.get(p.user_id) || 'staff',
          email: p.email || '',
        }))
      );
    };
    loadTeam();
  }, [user]);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      toast.error('El nombre del proyecto es obligatorio');
      return;
    }
    await dbCreateProject({
      name: newProjectName.trim(),
      description: newProjectDesc.trim() || 'Sin descripción',
      status: newProjectStatus,
      startDate: newProjectStartDate,
      endDate: newProjectEndDate,
      teamIds: newProjectTeam,
    });
    setNewProjectName('');
    setNewProjectDesc('');
    setNewProjectTeam([]);
    setNewProjectStatus('planning');
    setShowNewProject(false);
  };

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim()) { toast.error('El título de la tarea es obligatorio'); return; }
    if (!newTaskAssignee) { toast.error('Selecciona un responsable'); return; }
    const member = teamMembers.find(m => m.id === newTaskAssignee);
    await dbCreateTask({
      title: newTaskTitle.trim(),
      description: newTaskDesc.trim() || undefined,
      assigneeId: newTaskAssignee,
      assigneeName: member?.name || 'Sin asignar',
      priority: newTaskPriority,
      dueDate: newTaskDueDate || undefined,
      estimatedHours: newTaskEstHours ? parseFloat(newTaskEstHours) : undefined,
      projectId: selectedProjectId || undefined,
    });
    setNewTaskTitle(''); setNewTaskDesc(''); setNewTaskAssignee('');
    setNewTaskPriority('medium'); setNewTaskDueDate(''); setNewTaskEstHours('');
    setShowNewTask(false);
  };

  const handleCreateMilestone = async () => {
    if (!newMilestoneName.trim() || !newMilestoneDate || !selectedProjectId) return;
    await dbCreateMilestone(selectedProjectId, newMilestoneName.trim(), newMilestoneDate);
    setNewMilestoneName(''); setNewMilestoneDate(''); setShowNewMilestone(false);
  };

  const handleDeleteTask = async (taskId: string) => {
    await dbDeleteTask(taskId);
    setSelectedTask(null);
  };

  const handleDeleteMilestone = async (projectId: string, milestoneId: string) => {
    await dbDeleteMilestone(projectId, milestoneId);
  };

  const handleChangeProjectStatus = async (projectId: string, newStatus: string) => {
    await dbUpdateProjectStatus(projectId, newStatus);
  };

  const toggleTeamMember = (memberId: string) => {
    setNewProjectTeam(prev =>
      prev.includes(memberId)
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    );
  };

  const selectedProject = allProjects.find(p => p.id === selectedProjectId);
  const projectTasks = selectedProjectId ? allTasks.filter(t => t.projectId === selectedProjectId) : allTasks;

  const getProjectProgress = useCallback((projectId: string) => {
    const project = allProjects.find(p => p.id === projectId);
    const tasks = allTasks.filter(t => t.projectId === projectId);
    const taskPct = tasks.length > 0 ? Math.round((tasks.filter(t => t.status === 'done').length / tasks.length) * 100) : null;
    const milestonePct = project && project.milestones.length > 0
      ? Math.round((project.milestones.filter(m => m.completed).length / project.milestones.length) * 100) : null;
    if (taskPct !== null && milestonePct !== null) return Math.round((taskPct + milestonePct) / 2);
    if (taskPct !== null) return taskPct;
    if (milestonePct !== null) return milestonePct;
    return 0;
  }, [allProjects, allTasks]);

  const toggleMilestone = useCallback(async (projectId: string, milestoneId: string) => {
    await dbToggleMilestone(projectId, milestoneId);
  }, [dbToggleMilestone]);

  const cycleTaskStatus = useCallback(async (taskId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;
    const newStatus = nextStatus[task.status];
    await dbUpdateTaskStatus(taskId, newStatus);
    if (newStatus === 'done') toast.success(`✅ "${task.title}" completada`);
    const updated = {
      ...task, status: newStatus,
      completedAt: newStatus === 'done' ? new Date() : undefined,
      completedBy: newStatus === 'done' ? task.assignee : undefined,
    };
    if (selectedTask?.id === taskId) setSelectedTask(updated);
  }, [selectedTask, allTasks, dbUpdateTaskStatus]);

  const setTaskStatus = useCallback(async (taskId: string, newStatus: Task['status']) => {
    await dbUpdateTaskStatus(taskId, newStatus);
    const task = allTasks.find(t => t.id === taskId);
    if (task) {
      const updated = {
        ...task, status: newStatus,
        completedAt: newStatus === 'done' ? new Date() : undefined,
        completedBy: newStatus === 'done' ? task.assignee : undefined,
      };
      if (selectedTask?.id === taskId) setSelectedTask(updated);
    }
    toast.success('Estado actualizado');
  }, [selectedTask, allTasks, dbUpdateTaskStatus]);

  // Stats for project detail
  const projectStats = useMemo(() => {
    if (!selectedProjectId) return null;
    const tasks = allTasks.filter(t => t.projectId === selectedProjectId);
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'done').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const blocked = tasks.filter(t => t.status === 'blocked').length;
    const overdue = tasks.filter(t => t.dueDate && t.dueDate < new Date() && t.status !== 'done').length;
    const totalEstHours = tasks.reduce((s, t) => s + ((t as TaskWithMeta).estimatedHours || 0), 0);
    const completedEstHours = tasks.filter(t => t.status === 'done').reduce((s, t) => s + ((t as TaskWithMeta).estimatedHours || 0), 0);
    return { total, done, inProgress, blocked, overdue, totalEstHours, completedEstHours };
  }, [allTasks, selectedProjectId]);

  // NewTaskModal and NewMilestoneModal are rendered as inline JSX below (see render)


  // ===== Task detail panel =====
  const TaskDetailPanel = ({ task, onClose }: { task: TaskWithMeta; onClose: () => void }) => {
    const pConfig = priorityConfig[task.priority];
    const PIcon = pConfig.icon;
    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
        <div className="bg-card rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[85vh] overflow-auto shadow-elevated animate-in slide-in-from-bottom-4" onClick={e => e.stopPropagation()}>
          <div className="sticky top-0 bg-card p-4 flex items-start justify-between gap-3 z-10">
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-bold text-foreground">{task.title}</h3>
              {task.description && <p className="text-sm text-muted-foreground mt-1">{task.description}</p>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => handleDeleteTask(task.id)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Eliminar tarea"><Trash2 size={16} /></button>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X size={18} /></button>
            </div>
          </div>
          <div className="p-4 space-y-5">
            {/* Status */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">Estado</p>
              <div className="flex flex-wrap gap-2">
                {columns.map(status => {
                  const cfg = taskStatusConfig[status];
                  const Icon = cfg.icon;
                  const isActive = task.status === status;
                  return (
                    <button key={status} onClick={() => setTaskStatus(task.id, status)}
                      className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-all ${isActive ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-muted'}`}>
                      <Icon size={12} />{cfg.label}
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
                  <p className="text-xs text-muted-foreground">Responsable</p>
                </div>
              </div>
            </div>
            {/* Priority & Hours */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">Prioridad</p>
                <div className={`flex items-center gap-2 text-sm ${pConfig.className}`}>
                  <PIcon size={16} /><span className="font-medium">{pConfig.label}</span>
                </div>
              </div>
              {task.estimatedHours != null && task.estimatedHours > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2 font-medium">Tiempo estimado</p>
                  <div className="flex items-center gap-2 text-sm text-foreground">
                    <Timer size={14} className="text-muted-foreground" />
                    <span>{task.estimatedHours}h</span>
                  </div>
                </div>
              )}
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
            {/* Completion */}
            {task.status === 'done' && (
              <div className="bg-success/5 border border-success/20 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 size={14} className="text-success" />
                  <span className="text-sm font-semibold text-success">Completada</span>
                </div>
                {task.completedBy && (
                  <p className="text-xs text-muted-foreground">
                    Por <span className="font-medium text-foreground">{task.completedBy}</span>
                    {task.completedAt && <> el {format(task.completedAt, "d MMM yyyy HH:mm", { locale: es })}</>}
                  </p>
                )}
              </div>
            )}
            {/* Action */}
            <button onClick={() => cycleTaskStatus(task.id)}
              className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${
                task.status === 'done' ? 'bg-muted text-muted-foreground hover:bg-muted/80'
                  : task.status === 'in_progress' ? 'bg-success text-success-foreground hover:opacity-90'
                    : 'bg-primary text-primary-foreground hover:opacity-90'
              }`}>
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

  if (dbLoading) {
    return <div className="flex items-center justify-center h-full text-muted-foreground">Cargando proyectos...</div>;
  }

  // ===== PROJECT DETAIL VIEW =====
  if (selectedProject) {
    const pct = getProjectProgress(selectedProject.id);
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="shrink-0 p-4 sm:p-5 bg-card shadow-soft">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => setSelectedProjectId(null)} className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1">
              <ArrowLeft size={14} /> Proyectos
            </button>
            {/* Status selector */}
            <select
              value={selectedProject.status}
              onChange={e => handleChangeProjectStatus(selectedProject.id, e.target.value)}
              className={`text-xs px-2 py-0.5 rounded-full font-medium border-0 cursor-pointer ${statusLabels[selectedProject.status].className}`}
            >
              {projectStatuses.map(s => (
                <option key={s} value={s}>{statusLabels[s].label}</option>
              ))}
            </select>
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-foreground">{selectedProject.name}</h2>
          <p className="text-sm text-muted-foreground mt-1">{selectedProject.description}</p>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-4 sm:gap-6 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Calendar size={12} /> {format(selectedProject.startDate, 'd MMM', { locale: es })} → {format(selectedProject.endDate, 'd MMM yyyy', { locale: es })}</span>
            <span className="flex items-center gap-1"><Users size={12} /> {selectedProject.teamIds.length} miembros</span>
            <div className="flex items-center gap-2">
              <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
              <span>{pct}%</span>
            </div>
          </div>

          {/* Stats cards */}
          {projectStats && projectStats.total > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4">
              {[
                { label: 'Total', value: projectStats.total, icon: BarChart3, color: 'text-foreground' },
                { label: 'En progreso', value: projectStats.inProgress, icon: Clock, color: 'text-warning' },
                { label: 'Completadas', value: projectStats.done, icon: CheckCircle2, color: 'text-success' },
                { label: 'Bloqueadas', value: projectStats.blocked, icon: AlertOctagon, color: 'text-destructive' },
                { label: 'Vencidas', value: projectStats.overdue, icon: Calendar, color: projectStats.overdue > 0 ? 'text-destructive' : 'text-muted-foreground' },
              ].map(stat => {
                const SIcon = stat.icon;
                return (
                  <div key={stat.label} className="bg-muted/50 rounded-xl px-3 py-2.5 flex items-center gap-2">
                    <SIcon size={14} className={stat.color} />
                    <div>
                      <p className={`text-sm font-bold ${stat.color}`}>{stat.value}</p>
                      <p className="text-[10px] text-muted-foreground">{stat.label}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Estimated hours */}
          {projectStats && projectStats.totalEstHours > 0 && (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Timer size={12} />
              <span>{projectStats.completedEstHours}h / {projectStats.totalEstHours}h estimadas completadas</span>
              <div className="w-20 h-1 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round((projectStats.completedEstHours / projectStats.totalEstHours) * 100)}%` }} />
              </div>
            </div>
          )}

          {/* Milestones */}
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-2">
              <Target size={14} className="text-primary" />
              <span className="text-xs font-semibold text-foreground">Hitos</span>
              <button onClick={() => setShowNewMilestone(true)} className="ml-auto text-xs text-primary hover:underline flex items-center gap-1"><Plus size={12} /> Agregar</button>
            </div>
            {selectedProject.milestones.length > 0 ? (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {selectedProject.milestones.map((m, i) => (
                  <div key={m.id} className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => toggleMilestone(selectedProject.id, m.id)}
                      className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs transition-colors ${m.completed ? 'border-success/30 bg-success/10 text-success' : 'border-border text-muted-foreground hover:border-success/40'}`}>
                      <span className={`w-2.5 h-2.5 rounded-full border ${m.completed ? 'bg-success border-success' : 'border-border bg-card'}`} />
                      <span className={m.completed ? 'line-through' : ''}>{m.name}</span>
                      <span className="text-[10px]">{format(m.date, 'd MMM', { locale: es })}</span>
                    </button>
                    <button onClick={() => handleDeleteMilestone(selectedProject.id, m.id)} className="p-0.5 text-muted-foreground hover:text-destructive"><X size={12} /></button>
                    {i < selectedProject.milestones.length - 1 && <div className="w-4 h-px bg-border" />}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Sin hitos definidos</p>
            )}
          </div>

          {/* View toggle + New task */}
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-1">
               <button onClick={() => setView('board')} className={`text-xs px-3.5 py-1.5 rounded-xl font-medium transition-all ${view === 'board' ? 'bg-primary text-primary-foreground shadow-soft' : 'text-muted-foreground hover:bg-secondary'}`}>Kanban</button>
               <button onClick={() => setView('list')} className={`text-xs px-3.5 py-1.5 rounded-xl font-medium transition-all ${view === 'list' ? 'bg-primary text-primary-foreground shadow-soft' : 'text-muted-foreground hover:bg-secondary'}`}>Lista</button>
            </div>
            <button onClick={() => setShowNewTask(true)} className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-semibold px-4 py-2 rounded-xl hover:opacity-90 shadow-soft active:scale-95 transition-all">
              <Plus size={14} /> Nueva Tarea
            </button>
          </div>
        </div>

        {/* Tasks content */}
        <div className="flex-1 overflow-auto p-4">
          {projectTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FolderKanban size={40} className="text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground mb-3">Este proyecto aún no tiene tareas</p>
              <button onClick={() => setShowNewTask(true)} className="flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90">
                <Plus size={16} /> Crear primera tarea
              </button>
            </div>
          ) : view === 'board' ? (
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
                          <button key={task.id} onClick={() => setSelectedTask(task)}
                            className="w-full text-left bg-card rounded-2xl p-3.5 shadow-soft hover:shadow-card transition-all active:scale-[0.98]">
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
                                {(task as TaskWithMeta).estimatedHours && <span className="text-[10px] text-muted-foreground">{(task as TaskWithMeta).estimatedHours}h</span>}
                                {task.dueDate && <span className="text-xs text-muted-foreground">{format(task.dueDate, 'd MMM', { locale: es })}</span>}
                              </div>
                            </div>
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
                return (
                  <button key={task.id} onClick={() => setSelectedTask(task)}
                    className="w-full bg-card rounded-2xl p-3.5 flex items-center gap-3 sm:gap-4 shadow-soft hover:shadow-card transition-all text-left active:scale-[0.98]">
                    <button onClick={(e) => cycleTaskStatus(task.id, e)}
                      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border-2 transition-all hover:scale-110 ${
                        task.status === 'done' ? 'bg-success border-success text-success-foreground'
                          : task.status === 'in_progress' ? 'border-warning bg-warning/10'
                            : task.status === 'blocked' ? 'border-destructive bg-destructive/10' : 'border-border hover:border-primary'
                      }`} title={`Cambiar a: ${taskStatusConfig[nextStatus[task.status]].label}`}>
                      {task.status === 'done' && <CheckCircle2 size={12} />}
                      {task.status === 'in_progress' && <Clock size={10} className="text-warning" />}
                      {task.status === 'blocked' && <AlertOctagon size={10} className="text-destructive" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${task.status === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{task.title}</p>
                      {task.description && <p className="text-xs text-muted-foreground truncate">{task.description}</p>}
                      {task.status === 'done' && (task as TaskWithMeta).completedBy && (
                        <p className="text-[10px] text-success mt-0.5">
                          Completada por {(task as TaskWithMeta).completedBy}
                          {(task as TaskWithMeta).completedAt && ` · ${format((task as TaskWithMeta).completedAt!, 'd MMM HH:mm', { locale: es })}`}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                        {task.assignee.split(' ').map(n => n[0]).join('')}
                      </div>
                      <span className="text-xs text-muted-foreground hidden sm:block max-w-[80px] truncate">{task.assignee.split(' ')[0]}</span>
                    </div>
                    <PIcon size={14} className={`shrink-0 ${priorityConfig[task.priority].className}`} />
                    {(task as TaskWithMeta).estimatedHours && (
                      <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">{(task as TaskWithMeta).estimatedHours}h</span>
                    )}
                    {task.dueDate && (
                      <span className={`text-xs shrink-0 hidden sm:block ${task.dueDate < new Date() && task.status !== 'done' ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
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

        {selectedTask && <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTask(null)} />}
        {showNewTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowNewTask(false)}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-lg p-6 shadow-lg animate-in zoom-in-95 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-foreground">Nueva Tarea</h3>
                <button onClick={() => setShowNewTask(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X size={18} /></button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Título *</label>
                  <input autoFocus value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateTask()}
                    placeholder="Ej: Implementar autenticación" className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Descripción</label>
                  <textarea value={newTaskDesc} onChange={e => setNewTaskDesc(e.target.value)} placeholder="Detalla el alcance de la tarea..." rows={2}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">Responsable *</label>
                    <select value={newTaskAssignee} onChange={e => setNewTaskAssignee(e.target.value)}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                      <option value="">Seleccionar...</option>
                      {teamMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">Prioridad</label>
                    <select value={newTaskPriority} onChange={e => setNewTaskPriority(e.target.value as any)}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                      <option value="low">Baja</option>
                      <option value="medium">Media</option>
                      <option value="high">Alta</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">Fecha límite</label>
                    <input type="date" value={newTaskDueDate} onChange={e => setNewTaskDueDate(e.target.value)}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">Horas estimadas</label>
                    <input type="number" min="0" step="0.5" value={newTaskEstHours} onChange={e => setNewTaskEstHours(e.target.value)} placeholder="Ej: 8"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <button onClick={() => setShowNewTask(false)} className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-muted">Cancelar</button>
                  <button onClick={handleCreateTask} className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90">Crear Tarea</button>
                </div>
              </div>
            </div>
          </div>
        )}
        {showNewMilestone && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowNewMilestone(false)}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-sm p-6 shadow-lg animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-foreground">Nuevo Hito</h3>
                <button onClick={() => setShowNewMilestone(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X size={18} /></button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Nombre del hito *</label>
                  <input autoFocus value={newMilestoneName} onChange={e => setNewMilestoneName(e.target.value)}
                    placeholder="Ej: Beta Launch" className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Fecha *</label>
                  <input type="date" value={newMilestoneDate} onChange={e => setNewMilestoneDate(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowNewMilestone(false)} className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-muted">Cancelar</button>
                  <button onClick={handleCreateMilestone} className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90">Agregar Hito</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===== PROJECTS LIST =====
  return (
     <div className="p-4 sm:p-6 max-w-7xl mx-auto animate-fade-in">
       <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
         <h1 className="text-2xl font-extrabold text-foreground">Proyectos</h1>
         <button onClick={() => setShowNewProject(true)} className="flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 shadow-soft active:scale-95 transition-all w-fit">
           <Plus size={16} /> Nuevo Proyecto
        </button>
      </div>

      {/* Modal nuevo proyecto */}
      {showNewProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowNewProject(false)}>
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg p-6 shadow-lg animate-in zoom-in-95 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-foreground">Nuevo Proyecto</h3>
              <button onClick={() => setShowNewProject(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Nombre *</label>
                <input autoFocus value={newProjectName} onChange={e => setNewProjectName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateProject()}
                  placeholder="Ej: Rediseño del sitio web" className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Descripción</label>
                <textarea value={newProjectDesc} onChange={e => setNewProjectDesc(e.target.value)} placeholder="Describe brevemente el proyecto..." rows={2}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Estado inicial</label>
                <select value={newProjectStatus} onChange={e => setNewProjectStatus(e.target.value as any)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="planning">Planificación</option>
                  <option value="active">Activo</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Fecha inicio</label>
                  <input type="date" value={newProjectStartDate} onChange={e => setNewProjectStartDate(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Fecha fin</label>
                  <input type="date" value={newProjectEndDate} onChange={e => setNewProjectEndDate(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
              </div>
              {/* Team members */}
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Equipo</label>
                <div className="flex flex-wrap gap-2">
                  {teamMembers.map(m => {
                    const selected = newProjectTeam.includes(m.id);
                    return (
                      <button key={m.id} onClick={() => toggleTeamMember(m.id)}
                        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-all ${selected ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-muted-foreground hover:border-primary/40'}`}>
                        <div className="w-4 h-4 rounded-full bg-primary/10 flex items-center justify-center text-[8px] font-bold text-primary">
                          {m.name.split(' ').map(n => n[0]).join('')}
                        </div>
                        {m.name.split(' ')[0]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button onClick={() => setShowNewProject(false)} className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-muted">Cancelar</button>
                <button onClick={handleCreateProject} className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90">Crear Proyecto</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {allProjects.map(proj => {
          const projTasks = allTasks.filter(t => t.projectId === proj.id);
          const doneTasks = projTasks.filter(t => t.status === 'done').length;
          const computedProgress = getProjectProgress(proj.id);
          const members = teamMembers.filter(m => proj.teamIds.includes(m.id));
          return (
            <button key={proj.id} onClick={() => setSelectedProjectId(proj.id)} className="bg-card rounded-2xl p-5 shadow-card hover:shadow-elevated transition-all active:scale-[0.98] text-left">
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
                  {/* Avatars */}
                  <div className="flex -space-x-1.5">
                    {members.slice(0, 3).map(m => (
                      <div key={m.id} className="w-5 h-5 rounded-full bg-primary/10 border border-card flex items-center justify-center text-[8px] font-bold text-primary">
                        {m.name.split(' ').map(n => n[0]).join('')}
                      </div>
                    ))}
                    {members.length > 3 && <div className="w-5 h-5 rounded-full bg-muted border border-card flex items-center justify-center text-[8px] text-muted-foreground">+{members.length - 3}</div>}
                  </div>
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
