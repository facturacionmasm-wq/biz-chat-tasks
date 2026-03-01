import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, Building2, Check, Sparkles, Zap, Shield } from 'lucide-react';

interface Plan {
  id: string;
  name: string;
  slug: string;
  price_monthly: number;
  price_yearly: number | null;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  sort_order: number;
}

const PLAN_ICONS: Record<string, typeof Sparkles> = {
  basic: Sparkles,
  pro: Zap,
  enterprise: Shield,
};

const PLAN_COLORS: Record<string, string> = {
  basic: 'border-blue-500/30 bg-blue-500/5',
  pro: 'border-primary/50 bg-primary/5 ring-2 ring-primary/20',
  enterprise: 'border-amber-500/30 bg-amber-500/5',
};

const FEATURE_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp Business',
  voice_agent: 'Agente de Voz IA',
  knowledge_base: 'Base de Conocimiento',
  api_access: 'Acceso API',
  custom_integrations: 'Integraciones Personalizadas',
  priority_support: 'Soporte Prioritario',
};

const LIMIT_LABELS: Record<string, string> = {
  max_users: 'Usuarios',
  max_calls: 'Llamadas/mes',
  max_knowledge_items: 'Artículos KB',
};

const OnboardingPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<'company' | 'plan'>('company');
  const [companyName, setCompanyName] = useState('');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  useEffect(() => {
    const fetchPlans = async () => {
      const { data } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('active', true)
        .order('sort_order');
      if (data) setPlans(data as unknown as Plan[]);
      setLoadingPlans(false);
    };
    fetchPlans();
  }, []);

  const handleCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim() || !user) return;

    setLoading(true);
    try {
      // Get user's tenant
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tenantId) throw new Error('Tenant no encontrado');

      // Update tenant name
      const { error } = await supabase
        .from('tenants')
        .update({ name: companyName.trim() })
        .eq('id', tenantId);
      if (error) throw error;

      setStep('plan');
    } catch (err: any) {
      toast.error(err.message || 'Error al guardar');
    } finally {
      setLoading(false);
    }
  };

  const handlePlanSelect = async () => {
    if (!selectedPlan || !user) return;

    setLoading(true);
    try {
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tenantId) throw new Error('Tenant no encontrado');

      // Create subscription with 15-day trial
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 15);

      const { error: subError } = await supabase
        .from('tenant_subscriptions')
        .insert({
          tenant_id: tenantId,
          plan_id: selectedPlan,
          status: 'trialing',
          trial_ends_at: trialEnd.toISOString(),
          current_period_start: new Date().toISOString(),
          current_period_end: trialEnd.toISOString(),
        });
      if (subError) throw subError;

      // Mark onboarding complete
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ onboarding_completed: true })
        .eq('user_id', user.id);
      if (profileError) throw profileError;

      toast.success('¡Bienvenido! Tu prueba gratuita de 15 días ha comenzado.');
      navigate('/', { replace: true });
    } catch (err: any) {
      toast.error(err.message || 'Error al activar plan');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'company') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Building2 size={32} className="text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Configura tu empresa</h1>
            <p className="text-sm text-muted-foreground mt-2">
              ¿Cómo se llama tu empresa o negocio?
            </p>
          </div>

          <form onSubmit={handleCompanySubmit} className="bg-card border border-border rounded-xl p-6 space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1">
                Nombre de la empresa
              </label>
              <input
                type="text"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                required
                minLength={2}
                placeholder="Ej: Acme Corp"
                autoFocus
                className="w-full bg-secondary rounded-lg px-3 py-2.5 text-sm outline-none border border-border focus:border-primary text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !companyName.trim()}
              className="w-full bg-primary text-primary-foreground font-medium text-sm px-4 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              Continuar
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">Elige tu plan</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Comienza con 15 días de prueba gratuita. Sin compromiso.
          </p>
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                billingCycle === 'monthly'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              Mensual
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                billingCycle === 'yearly'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              Anual <span className="text-emerald-500 ml-1">-17%</span>
            </button>
          </div>
        </div>

        {loadingPlans ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-primary" size={32} />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((plan) => {
              const Icon = PLAN_ICONS[plan.slug] || Sparkles;
              const colorClass = PLAN_COLORS[plan.slug] || '';
              const isSelected = selectedPlan === plan.id;
              const price = billingCycle === 'yearly' && plan.price_yearly
                ? Math.round(plan.price_yearly / 12)
                : plan.price_monthly;

              return (
                <button
                  key={plan.id}
                  onClick={() => setSelectedPlan(plan.id)}
                  className={`relative text-left p-6 rounded-xl border-2 transition-all ${colorClass} ${
                    isSelected
                      ? 'border-primary shadow-lg shadow-primary/10 scale-[1.02]'
                      : 'hover:border-primary/30'
                  }`}
                >
                  {plan.slug === 'pro' && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px] font-bold px-3 py-0.5 rounded-full uppercase tracking-wider">
                      Popular
                    </span>
                  )}

                  <div className="flex items-center gap-2 mb-3">
                    <Icon size={20} className="text-primary" />
                    <span className="font-bold text-foreground">{plan.name}</span>
                  </div>

                  <div className="mb-4">
                    <span className="text-3xl font-bold text-foreground">${price}</span>
                    <span className="text-xs text-muted-foreground">/mes</span>
                    {billingCycle === 'yearly' && plan.price_yearly && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        ${plan.price_yearly}/año facturado anual
                      </p>
                    )}
                  </div>

                  <div className="space-y-2 mb-4">
                    {Object.entries(plan.features).map(([key, enabled]) => (
                      <div key={key} className="flex items-center gap-2 text-xs">
                        <Check
                          size={14}
                          className={enabled ? 'text-emerald-500' : 'text-muted-foreground/30'}
                        />
                        <span className={enabled ? 'text-foreground' : 'text-muted-foreground/50 line-through'}>
                          {FEATURE_LABELS[key] || key}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-border pt-3 space-y-1">
                    {Object.entries(plan.limits).map(([key, value]) => (
                      <p key={key} className="text-[11px] text-muted-foreground">
                        {LIMIT_LABELS[key] || key}:{' '}
                        <span className="font-medium text-foreground">
                          {value === -1 ? 'Ilimitado' : value}
                        </span>
                      </p>
                    ))}
                  </div>

                  {isSelected && (
                    <div className="absolute top-3 right-3 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                      <Check size={12} className="text-primary-foreground" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex justify-center mt-8">
          <button
            onClick={handlePlanSelect}
            disabled={!selectedPlan || loading}
            className="bg-primary text-primary-foreground font-medium text-sm px-8 py-3 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            Comenzar prueba gratuita de 15 días
          </button>
        </div>

        <p className="text-center text-[11px] text-muted-foreground mt-3">
          No se requiere tarjeta de crédito durante el período de prueba.
        </p>
      </div>
    </div>
  );
};

export default OnboardingPage;
