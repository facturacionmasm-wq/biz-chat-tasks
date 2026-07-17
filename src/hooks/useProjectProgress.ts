import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface ProgressEntry {
  id: string;
  tenant_id: string;
  project_id: string;
  author_user_id: string;
  author_name: string | null;
  entry_date: string;
  comment: string;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  created_at: string;
  observations: ProgressObservation[];
}

export interface ProgressObservation {
  id: string;
  entry_id: string;
  supervisor_user_id: string;
  supervisor_name: string | null;
  observation: string;
  created_at: string;
}

export function useProjectProgress(projectId: string | null) {
  const { user, tenantId, userRole } = useAuth();
  const [entries, setEntries] = useState<ProgressEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const isSupervisor = userRole === 'owner' || userRole === 'admin' || userRole === 'super_admin';

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const [entryRes, obsRes] = await Promise.all([
      supabase.from('project_progress_entries')
        .select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('project_progress_observations')
        .select('*').eq('project_id', projectId).order('created_at', { ascending: true }),
    ]);
    if (entryRes.error) console.error(entryRes.error);
    if (obsRes.error) console.error(obsRes.error);

    const grouped: ProgressEntry[] = (entryRes.data || []).map((e: any) => ({
      ...e,
      observations: (obsRes.data || []).filter((o: any) => o.entry_id === e.id),
    }));
    setEntries(grouped);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`progress-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_progress_entries', filter: `project_id=eq.${projectId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_progress_observations', filter: `project_id=eq.${projectId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId, load]);

  const createEntry = useCallback(async (comment: string, entryDate: string, file: File | null) => {
    if (!user || !tenantId || !projectId) return null;
    let attachment_path: string | null = null;
    let attachment_name: string | null = null;
    let attachment_mime: string | null = null;

    if (file) {
      const path = `progress/${tenantId}/${projectId}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from('project-documents').upload(path, file);
      if (upErr) {
        toast.error('Error al subir adjunto');
        return null;
      }
      attachment_path = path;
      attachment_name = file.name;
      attachment_mime = file.type || null;
    }

    const { data: prof } = await supabase.from('profiles').select('name').eq('user_id', user.id).maybeSingle();

    const { data, error } = await supabase
      .from('project_progress_entries')
      .insert({
        tenant_id: tenantId,
        project_id: projectId,
        author_user_id: user.id,
        author_name: prof?.name || user.email || 'Empleado',
        entry_date: entryDate,
        comment,
        attachment_path,
        attachment_name,
        attachment_mime,
      })
      .select().single();

    if (error || !data) {
      toast.error('Error al registrar avance');
      return null;
    }
    toast.success('Avance registrado');
    return data;
  }, [user, tenantId, projectId]);

  const addObservation = useCallback(async (entryId: string, observation: string) => {
    if (!user || !tenantId || !projectId) return;
    const { data: prof } = await supabase.from('profiles').select('name').eq('user_id', user.id).maybeSingle();
    const { error } = await supabase.from('project_progress_observations').insert({
      tenant_id: tenantId,
      project_id: projectId,
      entry_id: entryId,
      supervisor_user_id: user.id,
      supervisor_name: prof?.name || user.email || 'Supervisor',
      observation,
    });
    if (error) toast.error('Error al agregar observación');
    else toast.success('Observación agregada');
  }, [user, tenantId, projectId]);

  const deleteEntry = useCallback(async (entryId: string) => {
    const entry = entries.find((e) => e.id === entryId);
    if (entry?.attachment_path) {
      await supabase.storage.from('project-documents').remove([entry.attachment_path]);
    }
    const { error } = await supabase.from('project_progress_entries').delete().eq('id', entryId);
    if (error) toast.error('No se pudo eliminar');
    else toast.success('Avance eliminado');
  }, [entries]);

  const downloadAttachment = useCallback(async (path: string) => {
    const { data, error } = await supabase.storage.from('project-documents').createSignedUrl(path, 300);
    if (error || !data?.signedUrl) return toast.error('No se pudo generar enlace');
    window.open(data.signedUrl, '_blank');
  }, []);

  return { entries, loading, isSupervisor, createEntry, addObservation, deleteEntry, downloadAttachment };
}
