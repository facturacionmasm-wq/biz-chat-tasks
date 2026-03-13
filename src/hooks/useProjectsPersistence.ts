import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Project, Milestone } from '@/types/app';
import { toast } from 'sonner';

interface TaskWithMeta {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high';
  assignee: string;
  assigneeAvatar: string;
  dueDate?: Date;
  projectId?: string;
  estimatedHours?: number;
  completedAt?: Date;
  completedBy?: string;
}

const resolveTenantId = async (userId: string) => {
  const { data, error } = await supabase.rpc('get_user_tenant_id', { _user_id: userId });
  if (error) {
    console.error('Error resolving tenant:', error);
    return null;
  }
  return data as string | null;
};

export function useProjectsPersistence() {
  const { user } = useAuth();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskWithMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const ensureTenant = useCallback(async () => {
    if (tenantId) return tenantId;
    if (!user) return null;
    const id = await resolveTenantId(user.id);
    if (id) setTenantId(id);
    return id;
  }, [tenantId, user]);

  useEffect(() => {
    let cancelled = false;

    const loadTenant = async () => {
      if (!user) {
        if (!cancelled) {
          setTenantId(null);
          setProjects([]);
          setTasks([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      const id = await resolveTenantId(user.id);

      if (!cancelled) {
        setTenantId(id);
        if (!id) {
          setLoading(false);
          toast.error('No se pudo identificar tu empresa. Vuelve a iniciar sesión.');
        }
      }
    };

    loadTenant();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!tenantId) return;

      const [projRes, taskRes, msRes] = await Promise.all([
        supabase.from('projects').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
        supabase.from('project_tasks').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
        supabase.from('project_milestones').select('*').eq('tenant_id', tenantId).order('target_date'),
      ]);

      if (projRes.error || taskRes.error || msRes.error) {
        console.error('Error loading projects data:', projRes.error || taskRes.error || msRes.error);
        if (!cancelled) {
          setLoading(false);
          toast.error('No se pudieron cargar los proyectos');
        }
        return;
      }

      const projectIds = (projRes.data || []).map((p: any) => p.id);
      const membRes = projectIds.length > 0
        ? await supabase.from('project_members').select('project_id, user_id').in('project_id', projectIds)
        : { data: [], error: null };

      if (membRes.error) {
        console.error('Error loading project members:', membRes.error);
      }

      const milestoneMap: Record<string, Milestone[]> = {};
      (msRes.data || []).forEach((m: any) => {
        if (!milestoneMap[m.project_id]) milestoneMap[m.project_id] = [];
        milestoneMap[m.project_id].push({
          id: m.id,
          name: m.name,
          date: new Date(m.target_date),
          completed: m.completed,
        });
      });

      const memberMap: Record<string, string[]> = {};
      (membRes.data || []).forEach((m: any) => {
        if (!memberMap[m.project_id]) memberMap[m.project_id] = [];
        memberMap[m.project_id].push(m.user_id);
      });

      if (!cancelled) {
        setProjects((projRes.data || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          description: p.description || '',
          status: p.status,
          progress: 0,
          teamIds: memberMap[p.id] || [],
          startDate: new Date(p.start_date),
          endDate: new Date(p.end_date),
          milestones: milestoneMap[p.id] || [],
        })));

        setTasks((taskRes.data || []).map((t: any) => ({
          id: t.id,
          title: t.title,
          description: t.description || undefined,
          status: t.status,
          priority: t.priority,
          assignee: t.assignee_name || 'Sin asignar',
          assigneeAvatar: '',
          dueDate: t.due_date ? new Date(t.due_date) : undefined,
          projectId: t.project_id || undefined,
          estimatedHours: t.estimated_hours ? Number(t.estimated_hours) : undefined,
          completedAt: t.completed_at ? new Date(t.completed_at) : undefined,
          completedBy: t.completed_by || undefined,
        })));

        setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const createProject = useCallback(async (data: {
    name: string;
    description: string;
    status: string;
    startDate: string;
    endDate: string;
    teamIds: string[];
  }) => {
    const activeTenantId = await ensureTenant();
    if (!activeTenantId || !user) {
      toast.error('No hay sesión activa para guardar el proyecto');
      return null;
    }

    const { data: proj, error } = await supabase
      .from('projects')
      .insert({
        tenant_id: activeTenantId,
        name: data.name,
        description: data.description,
        status: data.status,
        start_date: data.startDate,
        end_date: data.endDate,
        created_by: user.id,
      })
      .select()
      .single();

    if (error || !proj) {
      console.error('Error creating project:', error);
      toast.error('Error al crear proyecto');
      return null;
    }

    if (data.teamIds.length > 0) {
      const { error: membersError } = await supabase.from('project_members').insert(
        data.teamIds.map((uid) => ({ project_id: proj.id, user_id: uid }))
      );
      if (membersError) {
        console.error('Error adding project members:', membersError);
        toast.error('Proyecto creado, pero no se pudo guardar el equipo');
      }
    }

    const newProject: Project = {
      id: proj.id,
      name: proj.name,
      description: proj.description || '',
      status: proj.status as any,
      progress: 0,
      teamIds: data.teamIds,
      startDate: new Date(proj.start_date),
      endDate: new Date(proj.end_date),
      milestones: [],
    };

    setProjects((prev) => [newProject, ...prev]);
    toast.success(`Proyecto "${proj.name}" creado 🎉`);
    return newProject;
  }, [ensureTenant, user]);

  const updateProjectStatus = useCallback(async (projectId: string, newStatus: string) => {
    const activeTenantId = await ensureTenant();
    if (!activeTenantId) return;

    const { data, error } = await supabase
      .from('projects')
      .update({ status: newStatus })
      .eq('id', projectId)
      .eq('tenant_id', activeTenantId)
      .select('id')
      .maybeSingle();

    if (error || !data) {
      console.error('Error updating project status:', error);
      toast.error('No se pudo actualizar el estado del proyecto');
      return;
    }

    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, status: newStatus as any } : p)));
    toast.success('Estado del proyecto actualizado');
  }, [ensureTenant]);

  const createTask = useCallback(async (data: {
    title: string;
    description?: string;
    assigneeId: string;
    assigneeName: string;
    priority: string;
    dueDate?: string;
    estimatedHours?: number;
    projectId?: string;
  }) => {
    const activeTenantId = await ensureTenant();
    if (!activeTenantId) {
      toast.error('No hay sesión activa para guardar la tarea');
      return null;
    }

    const { data: task, error } = await supabase
      .from('project_tasks')
      .insert({
        tenant_id: activeTenantId,
        project_id: data.projectId || null,
        title: data.title,
        description: data.description || null,
        status: 'todo',
        priority: data.priority,
        assignee_user_id: data.assigneeId,
        assignee_name: data.assigneeName,
        due_date: data.dueDate || null,
        estimated_hours: data.estimatedHours || null,
      })
      .select()
      .single();

    if (error || !task) {
      console.error('Error creating task:', error);
      toast.error('Error al crear tarea');
      return null;
    }

    const newTask: TaskWithMeta = {
      id: task.id,
      title: task.title,
      description: task.description || undefined,
      status: 'todo',
      priority: task.priority as any,
      assignee: task.assignee_name || 'Sin asignar',
      assigneeAvatar: '',
      dueDate: task.due_date ? new Date(task.due_date) : undefined,
      projectId: task.project_id || undefined,
      estimatedHours: task.estimated_hours ? Number(task.estimated_hours) : undefined,
    };

    setTasks((prev) => [newTask, ...prev]);
    toast.success(`Tarea "${task.title}" creada ✅`);
    return newTask;
  }, [ensureTenant]);

  const updateTaskStatus = useCallback(async (taskId: string, newStatus: 'todo' | 'in_progress' | 'done' | 'blocked') => {
    const activeTenantId = await ensureTenant();
    if (!activeTenantId) return;

    const currentTask = tasks.find((t) => t.id === taskId);
    const updates: any = { status: newStatus };

    if (newStatus === 'done') {
      updates.completed_at = new Date().toISOString();
      updates.completed_by = currentTask?.assignee || null;
    } else {
      updates.completed_at = null;
      updates.completed_by = null;
    }

    const { data, error } = await supabase
      .from('project_tasks')
      .update(updates)
      .eq('id', taskId)
      .eq('tenant_id', activeTenantId)
      .select('id')
      .maybeSingle();

    if (error || !data) {
      console.error('Error updating task status:', error);
      toast.error('No se pudo actualizar la tarea');
      return;
    }

    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          status: newStatus,
          completedAt: newStatus === 'done' ? new Date() : undefined,
          completedBy: newStatus === 'done' ? t.assignee : undefined,
        };
      })
    );
  }, [ensureTenant, tasks]);

  const deleteTask = useCallback(async (taskId: string) => {
    const activeTenantId = await ensureTenant();
    if (!activeTenantId) return;

    const { data, error } = await supabase
      .from('project_tasks')
      .delete()
      .eq('id', taskId)
      .eq('tenant_id', activeTenantId)
      .select('id')
      .maybeSingle();

    if (error || !data) {
      console.error('Error deleting task:', error);
      toast.error('No se pudo eliminar la tarea');
      return;
    }

    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    toast.success('Tarea eliminada');
  }, [ensureTenant]);

  const createMilestone = useCallback(async (projectId: string, name: string, date: string) => {
    const activeTenantId = await ensureTenant();
    if (!activeTenantId) return;

    const { data: ms, error } = await supabase
      .from('project_milestones')
      .insert({ tenant_id: activeTenantId, project_id: projectId, name, target_date: date })
      .select()
      .single();

    if (error || !ms) {
      console.error('Error creating milestone:', error);
      toast.error('Error al crear hito');
      return;
    }

    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          milestones: [...p.milestones, { id: ms.id, name: ms.name, date: new Date(ms.target_date), completed: false }],
        };
      })
    );
    toast.success('Hito agregado');
  }, [ensureTenant]);

  const toggleMilestone = useCallback(async (projectId: string, milestoneId: string) => {
    const activeTenantId = await ensureTenant();
    if (!activeTenantId) return;

    const project = projects.find((p) => p.id === projectId);
    const ms = project?.milestones.find((m) => m.id === milestoneId);
    if (!ms) return;

    const { data, error } = await supabase
      .from('project_milestones')
      .update({ completed: !ms.completed })
      .eq('id', milestoneId)
      .eq('tenant_id', activeTenantId)
      .select('id')
      .maybeSingle();

    if (error || !data) {
      console.error('Error toggling milestone:', error);
      toast.error('No se pudo actualizar el hito');
      return;
    }

    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          milestones: p.milestones.map((m) => (m.id === milestoneId ? { ...m, completed: !m.completed } : m)),
        };
      })
    );
    toast.success('Hito actualizado');
  }, [ensureTenant, projects]);

  const deleteMilestone = useCallback(async (projectId: string, milestoneId: string) => {
    const activeTenantId = await ensureTenant();
    if (!activeTenantId) return;

    const { data, error } = await supabase
      .from('project_milestones')
      .delete()
      .eq('id', milestoneId)
      .eq('tenant_id', activeTenantId)
      .select('id')
      .maybeSingle();

    if (error || !data) {
      console.error('Error deleting milestone:', error);
      toast.error('No se pudo eliminar el hito');
      return;
    }

    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        return { ...p, milestones: p.milestones.filter((m) => m.id !== milestoneId) };
      })
    );
    toast.success('Hito eliminado');
  }, [ensureTenant]);

  return {
    projects,
    tasks,
    loading,
    createProject,
    updateProjectStatus,
    createTask,
    updateTaskStatus,
    deleteTask,
    createMilestone,
    toggleMilestone,
    deleteMilestone,
    setTasks,
    setProjects,
  };
}
