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

export function useProjectsPersistence() {
  const { user } = useAuth();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskWithMeta[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch tenant
  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('tenant_id').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (data) setTenantId(data.tenant_id); });
  }, [user]);

  // Load projects, tasks, milestones, members
  useEffect(() => {
    if (!tenantId) return;

    const load = async () => {
      const [projRes, taskRes, msRes, membRes] = await Promise.all([
        supabase.from('projects').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
        supabase.from('project_tasks').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
        supabase.from('project_milestones').select('*').eq('tenant_id', tenantId).order('target_date'),
        supabase.from('project_members').select('project_id, user_id'),
      ]);

      // Build milestones map
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

      // Build members map
      const memberMap: Record<string, string[]> = {};
      (membRes.data || []).forEach((m: any) => {
        if (!memberMap[m.project_id]) memberMap[m.project_id] = [];
        memberMap[m.project_id].push(m.user_id);
      });

      if (projRes.data) {
        setProjects(projRes.data.map((p: any) => ({
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
      }

      if (taskRes.data) {
        setTasks(taskRes.data.map((t: any) => ({
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
      }

      setLoading(false);
    };

    load();
  }, [tenantId]);

  const createProject = useCallback(async (data: {
    name: string; description: string; status: string;
    startDate: string; endDate: string; teamIds: string[];
  }) => {
    if (!tenantId || !user) return null;

    const { data: proj, error } = await supabase.from('projects').insert({
      tenant_id: tenantId,
      name: data.name,
      description: data.description,
      status: data.status,
      start_date: data.startDate,
      end_date: data.endDate,
      created_by: user.id,
    }).select().single();

    if (error || !proj) { toast.error('Error al crear proyecto'); return null; }

    // Add team members
    if (data.teamIds.length > 0) {
      await supabase.from('project_members').insert(
        data.teamIds.map(uid => ({ project_id: proj.id, user_id: uid }))
      );
    }

    const newProject: Project = {
      id: proj.id, name: proj.name, description: proj.description || '',
      status: proj.status as any, progress: 0, teamIds: data.teamIds,
      startDate: new Date(proj.start_date), endDate: new Date(proj.end_date), milestones: [],
    };

    setProjects(prev => [newProject, ...prev]);
    toast.success(`Proyecto "${proj.name}" creado 🎉`);
    return newProject;
  }, [tenantId, user]);

  const updateProjectStatus = useCallback(async (projectId: string, newStatus: string) => {
    await supabase.from('projects').update({ status: newStatus }).eq('id', projectId);
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: newStatus as any } : p));
    toast.success('Estado del proyecto actualizado');
  }, []);

  const createTask = useCallback(async (data: {
    title: string; description?: string; assigneeId: string; assigneeName: string;
    priority: string; dueDate?: string; estimatedHours?: number; projectId?: string;
  }) => {
    if (!tenantId) return null;

    const { data: task, error } = await supabase.from('project_tasks').insert({
      tenant_id: tenantId,
      project_id: data.projectId || null,
      title: data.title,
      description: data.description || null,
      status: 'todo',
      priority: data.priority,
      assignee_user_id: data.assigneeId,
      assignee_name: data.assigneeName,
      due_date: data.dueDate || null,
      estimated_hours: data.estimatedHours || null,
    }).select().single();

    if (error || !task) { toast.error('Error al crear tarea'); return null; }

    const newTask: TaskWithMeta = {
      id: task.id, title: task.title, description: task.description || undefined,
      status: 'todo', priority: task.priority as any, assignee: task.assignee_name || 'Sin asignar',
      assigneeAvatar: '', dueDate: task.due_date ? new Date(task.due_date) : undefined,
      projectId: task.project_id || undefined,
      estimatedHours: task.estimated_hours ? Number(task.estimated_hours) : undefined,
    };

    setTasks(prev => [newTask, ...prev]);
    toast.success(`Tarea "${task.title}" creada ✅`);
    return newTask;
  }, [tenantId]);

  const updateTaskStatus = useCallback(async (taskId: string, newStatus: 'todo' | 'in_progress' | 'done' | 'blocked') => {
    const updates: any = { status: newStatus };
    if (newStatus === 'done') {
      updates.completed_at = new Date().toISOString();
      const task = tasks.find(t => t.id === taskId);
      updates.completed_by = task?.assignee || null;
    } else {
      updates.completed_at = null;
      updates.completed_by = null;
    }

    await supabase.from('project_tasks').update(updates).eq('id', taskId);

    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return {
        ...t, status: newStatus,
        completedAt: newStatus === 'done' ? new Date() : undefined,
        completedBy: newStatus === 'done' ? t.assignee : undefined,
      };
    }));
  }, [tasks]);

  const deleteTask = useCallback(async (taskId: string) => {
    await supabase.from('project_tasks').delete().eq('id', taskId);
    setTasks(prev => prev.filter(t => t.id !== taskId));
    toast.success('Tarea eliminada');
  }, []);

  const createMilestone = useCallback(async (projectId: string, name: string, date: string) => {
    if (!tenantId) return;

    const { data: ms, error } = await supabase.from('project_milestones').insert({
      tenant_id: tenantId,
      project_id: projectId,
      name,
      target_date: date,
    }).select().single();

    if (error || !ms) { toast.error('Error al crear hito'); return; }

    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      return { ...p, milestones: [...p.milestones, { id: ms.id, name: ms.name, date: new Date(ms.target_date), completed: false }] };
    }));
    toast.success('Hito agregado');
  }, [tenantId]);

  const toggleMilestone = useCallback(async (projectId: string, milestoneId: string) => {
    const project = projects.find(p => p.id === projectId);
    const ms = project?.milestones.find(m => m.id === milestoneId);
    if (!ms) return;

    await supabase.from('project_milestones').update({ completed: !ms.completed }).eq('id', milestoneId);

    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      return { ...p, milestones: p.milestones.map(m => m.id === milestoneId ? { ...m, completed: !m.completed } : m) };
    }));
    toast.success('Hito actualizado');
  }, [projects]);

  const deleteMilestone = useCallback(async (projectId: string, milestoneId: string) => {
    await supabase.from('project_milestones').delete().eq('id', milestoneId);
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      return { ...p, milestones: p.milestones.filter(m => m.id !== milestoneId) };
    }));
    toast.success('Hito eliminado');
  }, []);

  return {
    projects, tasks, loading,
    createProject, updateProjectStatus,
    createTask, updateTaskStatus, deleteTask,
    createMilestone, toggleMilestone, deleteMilestone,
    setTasks, setProjects,
  };
}
