import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, Check, Sparkles, Zap, Shield } from 'lucide-react';
import SatisfactionGuaranteeBadge from '@/components/SatisfactionGuaranteeBadge';

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

interface LocalizedPrice {
  plan_id: string;
  base_price: number;
  currency: string;
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

const CURRENCY_SYMBOLS: Record<string, string> = {
  MXN: 'MX$', COP: 'COP$', ARS: 'AR$', CLP: 'CL$', PEN: 'S/', USD: '$', EUR: '€',
};

const COUNTRY_CURRENCY: Record<string, string> = {
  MX: 'MXN', CO: 'COP', AR: 'ARS', CL: 'CLP', PE: 'PEN', EC: 'USD', US: 'USD', ES: 'EUR',
};

const COUNTRY_FLAG: Record<string, string> = {
  MX: '🇲🇽', CO: '🇨🇴', AR: '🇦🇷', CL: '🇨🇱', PE: '🇵🇪', EC: '🇪🇨', US: '🇺🇸', ES: '🇪🇸',
};

interface PlanSelectionPanelProps {
  tenantId: string | null;
  countryCode?: string | null;
  variant?: 'onboarding' | 'reactivation';
}

const PlanSelectionPanel = ({
  tenantId,
  countryCode,
  variant = 'onboarding',
}: PlanSelectionPanelProps) => {
  const { user } = useAuth();
  const country = (countryCode || 'MX').toUpperCase();
  const currency = COUNTRY_CURRENCY[country] || 'MXN';
  const flag = COUNTRY_FLAG[country] || '🌐';

  const [plans, setPlans] = useState<Plan[]>([]);
  const [localizedPrices, setLocalizedPrices] = useState<LocalizedPrice[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('active', true)
        .order('sort_order');
      if (data) setPlans(data as unknown as Plan[]);
      setLoadingPlans(false);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('global_plan_pricing')
        .select('plan_id, base_price, currency')
        .eq('country_code', country)
        .eq('active', true);
      setLocalizedPrices((data || []) as LocalizedPrice[]);
    })();
  }, [country]);

  const getLocalizedPrice = (planId: string, fallbackPrice: number) => {
    const local = localizedPrices.find(p => p.plan_id === planId);
    if (local) {
      return { price: local.base_price, currency: local.currency, symbol: CURRENCY_SYMBOLS[local.currency] || '$' };
    }
    return { price: fallbackPrice, currency, symbol: CURRENCY_SYMBOLS[currency] || '$' };
  };

  const handlePlanSelect = async () => {
    if (!selectedPlan || !user || !tenantId) return;
    setLoading(true);
    try {
      await supabase.rpc('ensure_tenant_for_current_user');
      const chosen = plans.find(p => p.id === selectedPlan);
      const { data: profileRow } = await supabase
        .from('profiles').select('name').eq('user_id', user.id).maybeSingle();
      const displayName = profileRow?.name
        || (user.user_metadata as any)?.name
        || (user.email ? user.email.split('@')[0] : 'Cliente');
      if (!chosen) throw new Error('No se pudo resolver el plan');

      const { data: checkout, error: checkoutErr } = await supabase.functions.invoke('stripe-billing', {
        body: {
          action: 'create_subscription_checkout',
          tenant_id: tenantId,
          email: user.email,
          name: displayName,
          plan_slug: chosen.slug,
          plan_id: chosen.id,
          billing_period: billingCycle,
        },
      });
      if (checkoutErr) throw checkoutErr;
      if (!checkout?.checkout_url) throw new Error('Stripe no devolvió una URL de checkout');

      toast.success('Redirigiendo al pago seguro con Stripe…');
      window.location.href = checkout.checkout_url;
    } catch (err: any) {
      toast.error(err.message || 'Error al iniciar el checkout');
      setLoading(false);
    }
  };

  const heading = variant === 'reactivation' ? 'Reactiva tu suscripción' : 'Elige tu plan';
  const subheading = variant === 'reactivation'
    ? 'Elige un plan para reactivar el acceso completo a la plataforma. Cancela cuando quieras.'
    : 'Suscripción mensual, cancela cuando quieras. Se requiere método de pago para activar tu cuenta.';

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="text-center mb-6">
        <h1 className="rx-page-title">{heading}</h1>
        <p className="text-sm text-[var(--rx-t2)] mt-2">{subheading}</p>
        <p className="text-xs text-[var(--rx-t2)] mt-1 flex items-center justify-center gap-1">
          <span>{flag}</span> Precios en {currency}
        </p>
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setBillingCycle('monthly')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              billingCycle === 'monthly'
                ? 'bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground'
                : 'bg-[var(--rx-s2)] text-[var(--rx-t2)] hover:text-foreground'
            }`}
          >
            Mensual
          </button>
          <button
            onClick={() => setBillingCycle('yearly')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              billingCycle === 'yearly'
                ? 'bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground'
                : 'bg-[var(--rx-s2)] text-[var(--rx-t2)] hover:text-foreground'
            }`}
          >
            Anual <span className="text-emerald-500 ml-1">-17%</span>
          </button>
        </div>
      </div>

      <SatisfactionGuaranteeBadge className="mb-6" />

      {loadingPlans ? (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-[var(--rx-brand)]" size={32} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const Icon = PLAN_ICONS[plan.slug] || Sparkles;
            const colorClass = PLAN_COLORS[plan.slug] || '';
            const isSelected = selectedPlan === plan.id;
            const localized = getLocalizedPrice(plan.id, plan.price_monthly);
            const price = billingCycle === 'yearly' && plan.price_yearly
              ? Math.round(localized.price * 0.83)
              : localized.price;

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
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground text-[10px] font-bold px-3 py-0.5 rounded-full uppercase tracking-wider">
                    Popular
                  </span>
                )}

                <div className="flex items-center gap-2 mb-3">
                  <Icon size={20} className="text-[var(--rx-brand)]" />
                  <span className="font-bold text-foreground">{plan.name}</span>
                </div>

                <div className="mb-4">
                  <span className="text-3xl font-bold text-foreground">{localized.symbol}{price.toLocaleString()}</span>
                  <span className="text-xs text-[var(--rx-t2)]">/mes</span>
                  {billingCycle === 'yearly' && (
                    <p className="text-[10px] text-[var(--rx-t2)] mt-0.5">
                      {localized.symbol}{Math.round(price * 12).toLocaleString()}/año facturado anual
                    </p>
                  )}
                </div>

                <div className="space-y-2 mb-4">
                  {Object.entries(plan.features).map(([key, enabled]) => (
                    <div key={key} className="flex items-center gap-2 text-xs">
                      <Check
                        size={14}
                        className={enabled ? 'text-emerald-500' : 'text-[var(--rx-t2)]/30'}
                      />
                      <span className={enabled ? 'text-foreground' : 'text-[var(--rx-t2)]/50 line-through'}>
                        {FEATURE_LABELS[key] || key}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="border-t border-[var(--rx-b1)] pt-3 space-y-1">
                  {Object.entries(plan.limits).map(([key, value]) => (
                    <p key={key} className="text-[11px] text-[var(--rx-t2)]">
                      {LIMIT_LABELS[key] || key}:{' '}
                      <span className="font-medium text-foreground">
                        {value === -1 ? 'Ilimitado' : value}
                      </span>
                    </p>
                  ))}
                </div>

                {isSelected && (
                  <div className="absolute top-3 right-3 w-5 h-5 bg-[var(--rx-brand)] rounded-full flex items-center justify-center">
                    <Check size={12} className="text-[var(--rx-brand)]-foreground" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-center gap-3 mt-8">
        <button
          onClick={handlePlanSelect}
          disabled={!selectedPlan || loading || !tenantId}
          className="bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground font-medium text-sm px-8 py-3 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
        >
          {loading && <Loader2 size={16} className="animate-spin" />}
          Continuar al pago seguro
        </button>
      </div>

      <p className="text-center text-[11px] text-[var(--rx-t2)] mt-3">
        Pago procesado por Stripe. Cancela cuando quieras. Cobertura de garantía de 30 días.
      </p>
    </div>
  );
};

export default PlanSelectionPanel;
