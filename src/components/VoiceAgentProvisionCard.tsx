import { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Provisioning card for the tenant's dedicated ElevenLabs voice agent.
 * On click, invokes `elevenlabs-agent-provision` (owner/super_admin only)
 * which creates the agent in ElevenLabs and persists agent_id in
 * tenants.elevenlabs_config.
 */
const VoiceAgentProvisionCard = () => {
  const [busy, setBusy] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  const loadStatus = useCallback(async () => {
    setChecking(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) { setChecking(false); return; }
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: uid });
      if (!tenantId) { setChecking(false); return; }
      const { data } = await supabase
        .from('tenants').select('elevenlabs_config').eq('id', tenantId).maybeSingle();
      const cfg = (data?.elevenlabs_config ?? {}) as Record<string, unknown>;
      setAgentId(typeof cfg.agent_id === 'string' ? String(cfg.agent_id) : null);
    } catch (err) {
      console.warn('[VoiceAgentProvisionCard] status load failed', err);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleProvision = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('elevenlabs-agent-provision', {
        body: {},
      });
      if (error) throw error;
      if (data?.agent_id) {
        setAgentId(data.agent_id);
        toast.success(
          data.already_provisioned
            ? 'Tu agente ya estaba aprovisionado.'
            : 'Agente de voz aprovisionado correctamente.',
        );
      }
    } catch (err: any) {
      console.error('[VoiceAgentProvisionCard] provision failed', err);
      toast.error('No se pudo aprovisionar el agente. Requiere rol owner.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-8 bg-card border border-[var(--rx-b1)] rounded-xl p-6 shadow-sm">
      <h2 className="text-lg font-bold text-foreground flex items-center gap-2 mb-3">
        <Bot size={18} className="text-[var(--rx-brand)]" /> Agente de Voz IA por tenant
      </h2>
      <p className="text-sm text-[var(--rx-t2)] mb-4">
        Crea un agente ElevenLabs dedicado para tu empresa. Aísla tu base de conocimiento
        y evita mezclar datos con otros tenants.
      </p>

      {checking ? (
        <div className="flex items-center gap-2 text-xs text-[var(--rx-t2)]">
          <Loader2 size={14} className="animate-spin" /> Verificando estado…
        </div>
      ) : agentId ? (
        <div className="flex items-center gap-2 text-sm text-emerald-600">
          <CheckCircle2 size={16} />
          <span className="font-medium">Agente aprovisionado</span>
          <code className="text-[10px] px-2 py-0.5 bg-muted rounded ml-1 truncate max-w-[220px]">{agentId}</code>
        </div>
      ) : (
        <button
          onClick={handleProvision}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold px-4 py-2 transition-colors disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {busy ? 'Aprovisionando…' : 'Aprovisionar mi agente'}
        </button>
      )}
    </div>
  );
};

export default VoiceAgentProvisionCard;
