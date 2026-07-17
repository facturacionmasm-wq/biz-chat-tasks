import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export type CostCategory = 'materials' | 'labor' | 'equipment' | 'subcontracts' | 'overhead' | 'contingency';
export type CostType = 'fixed' | 'variable';

export interface ProjectCost {
  id: string;
  tenant_id: string;
  project_id: string;
  category: CostCategory;
  cost_type: CostType;
  amount: number;
  currency: string;
  cost_date: string;
  description: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
}

export interface FinancialSnapshot {
  id: string;
  project_id: string;
  snapshot_at: string;
  total_fixed: number;
  total_variable: number;
  total_cost: number;
  break_even_amount: number | null;
  break_even_progress_pct: number | null;
  recommended_min_price: number | null;
  projected_total_cost: number | null;
  projected_profit: number | null;
  projected_overrun: number | null;
  cost_performance_index: number | null;
  physical_progress_pct: number | null;
  contract_amount: number | null;
  ai_summary: string | null;
  alerts: Array<{ code: string; severity: string; message: string }>;
  trigger_source: string | null;
}

export interface ProjectFinancialSettings {
  contract_amount: number | null;
  contract_currency: string;
  physical_progress_pct: number;
  target_margin_pct: number;
  estimated_duration_days: number | null;
}

export function useProjectFinancials(projectId: string | null) {
  const { user, tenantId, userRole } = useAuth();
  const canEditSettings = userRole === 'owner' || userRole === 'admin' || userRole === 'super_admin';

  const [costs, setCosts] = useState<ProjectCost[]>([]);
  const [snapshots, setSnapshots] = useState<FinancialSnapshot[]>([]);
  const [settings, setSettings] = useState<ProjectFinancialSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const [costRes, snapRes, projRes] = await Promise.all([
      supabase.from('project_costs').select('*').eq('project_id', projectId).order('cost_date', { ascending: true }),
      supabase.from('project_financial_snapshots').select('*').eq('project_id', projectId).order('snapshot_at', { ascending: false }).limit(20),
      supabase.from('projects').select('contract_amount, contract_currency, physical_progress_pct, target_margin_pct, estimated_duration_days').eq('id', projectId).maybeSingle(),
    ]);
    if (costRes.error) console.error(costRes.error);
    if (snapRes.error) console.error(snapRes.error);
    if (projRes.error) console.error(projRes.error);

    setCosts((costRes.data as any) || []);
    setSnapshots((snapRes.data as any) || []);
    setSettings(projRes.data ? {
      contract_amount: projRes.data.contract_amount != null ? Number(projRes.data.contract_amount) : null,
      contract_currency: projRes.data.contract_currency || 'MXN',
      physical_progress_pct: Number(projRes.data.physical_progress_pct || 0),
      target_margin_pct: Number(projRes.data.target_margin_pct || 20),
      estimated_duration_days: projRes.data.estimated_duration_days,
    } : null);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!projectId) return;
    const channel = supabase.channel(`fin-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_costs', filter: `project_id=eq.${projectId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_financial_snapshots', filter: `project_id=eq.${projectId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId, load]);

  const triggerAgent = useCallback(async (source: string) => {
    if (!projectId) return;
    try {
      await supabase.functions.invoke('project-financial-agent', {
        body: { project_id: projectId, trigger_source: source },
      });
    } catch (e) {
      console.warn('financial agent failed', e);
    }
  }, [projectId]);

  const createCost = useCallback(async (payload: {
    category: CostCategory; cost_type: CostType; amount: number;
    cost_date: string; description?: string; file?: File | null;
  }) => {
    if (!user || !tenantId || !projectId) return null;
    let attachment_path: string | null = null;
    let attachment_name: string | null = null;
    if (payload.file) {
      const path = `costs/${tenantId}/${projectId}/${Date.now()}_${payload.file.name}`;
      const { error: upErr } = await supabase.storage.from('project-documents').upload(path, payload.file);
      if (upErr) { toast.error('Error al subir factura'); return null; }
      attachment_path = path;
      attachment_name = payload.file.name;
    }
    const { data: prof } = await supabase.from('profiles').select('name').eq('user_id', user.id).maybeSingle();
    const { data, error } = await supabase.from('project_costs').insert({
      tenant_id: tenantId,
      project_id: projectId,
      category: payload.category,
      cost_type: payload.cost_type,
      amount: payload.amount,
      currency: settings?.contract_currency || 'MXN',
      cost_date: payload.cost_date,
      description: payload.description || null,
      attachment_path,
      attachment_name,
      created_by: user.id,
      created_by_name: prof?.name || user.email || null,
    }).select().single();
    if (error) { toast.error('Error al registrar costo'); return null; }
    toast.success('Costo registrado');
    triggerAgent('cost_created');
    return data;
  }, [user, tenantId, projectId, settings?.contract_currency, triggerAgent]);

  const deleteCost = useCallback(async (id: string) => {
    const cost = costs.find((c) => c.id === id);
    if (cost?.attachment_path) {
      await supabase.storage.from('project-documents').remove([cost.attachment_path]);
    }
    const { error } = await supabase.from('project_costs').delete().eq('id', id);
    if (error) toast.error('Error al eliminar');
    else { toast.success('Costo eliminado'); triggerAgent('cost_deleted'); }
  }, [costs, triggerAgent]);

  const updateSettings = useCallback(async (patch: Partial<ProjectFinancialSettings>) => {
    if (!canEditSettings || !projectId) return;
    const { error } = await supabase.from('projects').update(patch).eq('id', projectId);
    if (error) { toast.error('No se pudo actualizar'); return; }
    toast.success('Datos actualizados');
    await load();
    triggerAgent('settings_updated');
  }, [canEditSettings, projectId, load, triggerAgent]);

  const downloadAttachment = useCallback(async (path: string) => {
    const { data, error } = await supabase.storage.from('project-documents').createSignedUrl(path, 300);
    if (error || !data?.signedUrl) return toast.error('No se pudo generar enlace');
    window.open(data.signedUrl, '_blank');
  }, []);

  return {
    costs, snapshots, settings, loading, canEditSettings,
    createCost, deleteCost, updateSettings, downloadAttachment, triggerAgent,
  };
}
