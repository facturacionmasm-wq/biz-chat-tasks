import { Sparkles, Phone, ArrowRight, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface Props {
  serviceName?: string;
  requiredPlan?: 'pro' | 'enterprise';
  /** When provided, the CTA invokes stripe-billing change_plan directly */
  planSlug?: string;
  returnTo?: string;
}

const PlanUpgradeCard = ({
  serviceName = 'Agente de Voz IA',
  requiredPlan = 'pro',
  planSlug,
  returnTo = '/calls',
}: Props) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const planLabel = requiredPlan === 'pro' ? 'Pro' : 'Enterprise';

  const targetSlug = planSlug || requiredPlan; // fallback: use requiredPlan as slug

  const handleUpgrade = async () => {
    if (!user) { navigate('/settings?tab=billing'); return; }
    setBusy(true);
    try {
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tenantId) throw new Error('Tenant no encontrado');
      const { data: profile } = await supabase
        .from('profiles').select('name').eq('user_id', user.id).maybeSingle();
      const displayName = profile?.name || (user.email ? user.email.split('@')[0] : 'Cliente');

      const { data, error } = await supabase.functions.invoke('stripe-billing', {
        body: {
          action: 'change_plan',
          tenant_id: tenantId,
          plan_slug: targetSlug,
          email: user.email,
          name: displayName,
        },
      });
      if (error) throw error;

      if (data?.requires_payment_method) {
        toast.info('Registra una tarjeta para activar el plan.');
        const { data: setup } = await supabase.functions.invoke('stripe-billing', {
          body: {
            action: 'create_setup_session',
            tenant_id: tenantId,
            email: user.email,
            name: displayName,
            service_type: 'onboarding',
            return_to: returnTo,
          },
        });
        if (setup?.checkout_url) window.location.href = setup.checkout_url;
        return;
      }

      toast.success('Plan actualizado.');
      setTimeout(() => window.location.reload(), 800);
    } catch (err: any) {
      console.error('[PlanUpgradeCard] upgrade failed', err);
      toast.error('No se pudo actualizar el plan. Intenta desde Configuración.');
      navigate('/settings?tab=billing');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[70vh] p-4">
      <div className="w-full max-w-xl bg-card border border-border rounded-3xl p-8 text-center shadow-sm">
        <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Phone size={30} className="text-primary" />
        </div>
        <h2 className="text-2xl font-bold mb-2">{serviceName} no incluido en tu plan</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Actualiza a <span className="font-semibold text-foreground">{planLabel}</span> para activar el {serviceName} y todas las funciones avanzadas.
        </p>

        <div className="bg-muted/40 rounded-2xl p-5 text-left space-y-2 mb-6">
          <div className="flex items-center gap-2 text-sm"><Check size={16} className="text-emerald-500" /> Llamadas ilimitadas con IA</div>
          <div className="flex items-center gap-2 text-sm"><Check size={16} className="text-emerald-500" /> Transferencia y agenda automática</div>
          <div className="flex items-center gap-2 text-sm"><Check size={16} className="text-emerald-500" /> Números Twilio dedicados</div>
          <div className="flex items-center gap-2 text-sm"><Check size={16} className="text-emerald-500" /> Soporte prioritario</div>
        </div>

        <Button size="lg" className="w-full rounded-full" onClick={handleUpgrade} disabled={busy}>
          {busy ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Sparkles size={16} className="mr-2" />}
          Actualiza a {planLabel} para activar el {serviceName}
          <ArrowRight size={16} className="ml-2" />
        </Button>
        <button
          className="mt-3 text-xs text-muted-foreground hover:text-foreground underline"
          onClick={() => navigate('/settings?tab=billing')}
        >
          Ver todos los planes
        </button>
      </div>
    </div>
  );
};

export default PlanUpgradeCard;
