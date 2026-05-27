import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, Building2, Check, Sparkles, Zap, Shield, Globe, MapPin } from 'lucide-react';

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

// ── Country / Region config ──

interface CountryOption {
  code: string;
  name: string;
  flag: string;
  region: string;
  currency: string;
  timezone: string;
}

const COUNTRIES: CountryOption[] = [
  { code: 'MX', name: 'México', flag: '🇲🇽', region: 'LATAM', currency: 'MXN', timezone: 'America/Mexico_City' },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴', region: 'LATAM', currency: 'COP', timezone: 'America/Bogota' },
  { code: 'AR', name: 'Argentina', flag: '🇦🇷', region: 'LATAM', currency: 'ARS', timezone: 'America/Argentina/Buenos_Aires' },
  { code: 'CL', name: 'Chile', flag: '🇨🇱', region: 'LATAM', currency: 'CLP', timezone: 'America/Santiago' },
  { code: 'PE', name: 'Perú', flag: '🇵🇪', region: 'LATAM', currency: 'PEN', timezone: 'America/Lima' },
  { code: 'EC', name: 'Ecuador', flag: '🇪🇨', region: 'LATAM', currency: 'USD', timezone: 'America/Guayaquil' },
  { code: 'US', name: 'Estados Unidos', flag: '🇺🇸', region: 'NA', currency: 'USD', timezone: 'America/New_York' },
  { code: 'ES', name: 'España', flag: '🇪🇸', region: 'EU', currency: 'EUR', timezone: 'Europe/Madrid' },
];

// ── Plan display config ──

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

// ── Currency formatting helper ──
const CURRENCY_SYMBOLS: Record<string, string> = {
  MXN: 'MX$', COP: 'COP$', ARS: 'AR$', CLP: 'CL$', PEN: 'S/', USD: '$', EUR: '€',
};

interface LocalizedPrice {
  plan_id: string;
  base_price: number;
  currency: string;
}

const OnboardingPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<'company' | 'country' | 'plan'>('company');
  const [companyName, setCompanyName] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<CountryOption | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [localizedPrices, setLocalizedPrices] = useState<LocalizedPrice[]>([]);
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

  // Fetch localized pricing when country changes
  useEffect(() => {
    if (!selectedCountry) return;
    const fetchPricing = async () => {
      const { data } = await supabase
        .from('global_plan_pricing')
        .select('plan_id, base_price, currency')
        .eq('country_code', selectedCountry.code)
        .eq('active', true);
      setLocalizedPrices((data || []) as LocalizedPrice[]);
    };
    fetchPricing();
  }, [selectedCountry]);

  const getLocalizedPrice = (planId: string, fallbackPrice: number): { price: number; currency: string; symbol: string } => {
    const local = localizedPrices.find(p => p.plan_id === planId);
    if (local) {
      return { price: local.base_price, currency: local.currency, symbol: CURRENCY_SYMBOLS[local.currency] || '$' };
    }
    const currency = selectedCountry?.currency || 'MXN';
    return { price: fallbackPrice, currency, symbol: CURRENCY_SYMBOLS[currency] || '$' };
  };

  const handleCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim() || !user) return;

    setLoading(true);
    try {
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tenantId) throw new Error('Tenant no encontrado');

      const { error } = await supabase
        .from('tenants')
        .update({ name: companyName.trim() } as any)
        .eq('id', tenantId);
      if (error) throw error;

      setStep('country');
    } catch (err: any) {
      toast.error(err.message || 'Error al guardar');
    } finally {
      setLoading(false);
    }
  };

  const handleCountrySubmit = async () => {
    if (!selectedCountry || !user) return;

    setLoading(true);
    try {
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tenantId) throw new Error('Tenant no encontrado');

      const { error } = await supabase
        .from('tenants')
        .update({
          country_code: selectedCountry.code,
          region: selectedCountry.region,
          currency: selectedCountry.currency,
          timezone: selectedCountry.timezone,
        } as any)
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

  // ── Step indicators ──
  const StepIndicator = () => {
    const steps = ['Empresa', 'País', 'Plan'];
    const currentIdx = step === 'company' ? 0 : step === 'country' ? 1 : 2;
    return (
      <div className="flex items-center justify-center gap-2 mb-6">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              i <= currentIdx ? 'bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground' : 'bg-[var(--rx-s2)] text-[var(--rx-t2)]'
            }`}>
              {i < currentIdx ? <Check size={14} /> : i + 1}
            </div>
            <span className={`text-xs font-medium hidden sm:inline ${i <= currentIdx ? 'text-foreground' : 'text-[var(--rx-t2)]'}`}>{s}</span>
            {i < steps.length - 1 && <div className={`w-8 h-px ${i < currentIdx ? 'bg-[var(--rx-brand)]' : 'bg-border'}`} />}
          </div>
        ))}
      </div>
    );
  };

  // ── STEP 1: Company name ──
  if (step === 'company') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <StepIndicator />
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-[var(--rx-brand)] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Building2 size={32} className="text-[var(--rx-brand)]-foreground" />
            </div>
            <h1 className="rx-page-title">Configura tu empresa</h1>
            <p className="text-sm text-[var(--rx-t2)] mt-2">
              ¿Cómo se llama tu empresa o negocio?
            </p>
          </div>

          <form onSubmit={handleCompanySubmit} className="rx-panel">
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
                className="w-full bg-[var(--rx-s2)] rounded-lg px-3 py-2.5 text-sm outline-none border border-[var(--rx-b1)] focus:border-primary text-foreground placeholder:text-[var(--rx-t2)]"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !companyName.trim()}
              className="w-full bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground font-medium text-sm px-4 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              Continuar
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── STEP 2: Country / Region selection ──
  if (step === 'country') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <StepIndicator />
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-[var(--rx-brand)] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Globe size={32} className="text-[var(--rx-brand)]-foreground" />
            </div>
            <h1 className="rx-page-title">¿Dónde operas?</h1>
            <p className="text-sm text-[var(--rx-t2)] mt-2">
              Selecciona tu país para asignar precios y moneda local automáticamente.
            </p>
          </div>

          <div className="rx-panel">
            <div className="grid grid-cols-2 gap-2">
              {COUNTRIES.map(c => {
                const isSelected = selectedCountry?.code === c.code;
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => setSelectedCountry(c)}
                    className={`relative flex items-center gap-2.5 p-3 rounded-xl border-2 text-left transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-[var(--rx-b1)] hover:border-primary/30 hover:bg-[var(--rx-s2)]/50'
                    }`}
                  >
                    <span className="text-2xl">{c.flag}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                      <p className="text-[10px] text-[var(--rx-t2)]">{c.currency} · {c.region}</p>
                    </div>
                    {isSelected && (
                      <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-[var(--rx-brand)] rounded-full flex items-center justify-center">
                        <Check size={10} className="text-[var(--rx-brand)]-foreground" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {selectedCountry && (
              <div className="bg-[var(--rx-s2)]/50 rounded-lg p-3 flex items-center gap-2">
                <MapPin size={14} className="text-[var(--rx-brand)] shrink-0" />
                <p className="text-xs text-[var(--rx-t2)]">
                  Moneda: <span className="font-semibold text-foreground">{selectedCountry.currency}</span> · 
                  Región: <span className="font-semibold text-foreground">{selectedCountry.region}</span> · 
                  Zona horaria: <span className="font-semibold text-foreground">{selectedCountry.timezone.split('/').pop()}</span>
                </p>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep('company')}
                className="px-4 py-2.5 rounded-lg border border-[var(--rx-b1)] text-sm font-medium text-[var(--rx-t2)] hover:text-foreground hover:bg-[var(--rx-s2)] transition-colors"
              >
                Atrás
              </button>
              <button
                type="button"
                onClick={handleCountrySubmit}
                disabled={loading || !selectedCountry}
                className="flex-1 bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground font-medium text-sm px-4 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                Continuar
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── STEP 3: Plan selection (with localized pricing) ──
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <StepIndicator />
        <div className="text-center mb-8">
          <h1 className="rx-page-title">Elige tu plan</h1>
          <p className="text-sm text-[var(--rx-t2)] mt-2">
            Comienza con 15 días de prueba gratuita. Sin compromiso.
          </p>
          {selectedCountry && (
            <p className="text-xs text-[var(--rx-t2)] mt-1 flex items-center justify-center gap-1">
              <span>{selectedCountry.flag}</span> Precios en {selectedCountry.currency}
            </p>
          )}
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
                ? Math.round(localized.price * 0.83) // ~17% discount
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
                    <span className="text-xs text-[var(--rx-t2)]">/{billingCycle === 'yearly' ? 'mes' : 'mes'}</span>
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
            onClick={() => setStep('country')}
            className="px-4 py-3 rounded-lg border border-[var(--rx-b1)] text-sm font-medium text-[var(--rx-t2)] hover:text-foreground hover:bg-[var(--rx-s2)] transition-colors"
          >
            Atrás
          </button>
          <button
            onClick={handlePlanSelect}
            disabled={!selectedPlan || loading}
            className="bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground font-medium text-sm px-8 py-3 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            Comenzar prueba gratuita de 15 días
          </button>
        </div>

        <p className="text-center text-[11px] text-[var(--rx-t2)] mt-3">
          No se requiere tarjeta de crédito durante el período de prueba.
        </p>
      </div>
    </div>
  );
};

export default OnboardingPage;
