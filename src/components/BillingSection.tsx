import { useState, useEffect } from 'react';
import { CreditCard, Loader2, CheckCircle, AlertTriangle, ExternalLink, Key, Zap, Shield } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { User } from '@supabase/supabase-js';

interface BillingSectionProps {
  user: User | null;
  isSuperAdmin: boolean;
  getTenantId: () => Promise<string>;
  inputClass: string;
}

interface SubPlan {
  id: string;
  name: string;
  slug: string;
  price_monthly: number;
  price_yearly: number | null;
  features: any;
  limits: any;
}

interface TenantSub {
  status: string;
  trial_ends_at: string | null;
  plan_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

const BillingSection = ({ user, isSuperAdmin, getTenantId, inputClass }: BillingSectionProps) => {
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<SubPlan[]>([]);
  const [currentSub, setCurrentSub] = useState<TenantSub | null>(null);
  const [subStatus, setSubStatus] = useState<any>(null);

  // Stripe wizard state
  const [showStripeWizard, setShowStripeWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [stripePublishableKey, setStripePublishableKey] = useState('');
  const [stripeSecretKey, setStripeSecretKey] = useState('');
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState('');
  const [savingStripe, setSavingStripe] = useState(false);
  const [stripeConfigured, setStripeConfigured] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadBillingData();
  }, [user]);

  const loadBillingData = async () => {
    setLoading(true);
    try {
      const [plansRes, statusRes, tenantId] = await Promise.all([
        supabase.from('subscription_plans').select('*').eq('active', true).order('sort_order'),
        supabase.rpc('get_tenant_subscription_status', { _user_id: user!.id }),
        getTenantId(),
      ]);

      setPlans((plansRes.data || []) as SubPlan[]);
      if (statusRes.data) setSubStatus(statusRes.data);

      // Load current subscription
      const { data: sub } = await supabase
        .from('tenant_subscriptions')
        .select('status, trial_ends_at, plan_id, stripe_customer_id, stripe_subscription_id')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      setCurrentSub(sub);

      // Check if Stripe is configured for this tenant
      const { data: tenant } = await supabase
        .from('tenants')
        .select('settings_json')
        .eq('id', tenantId)
        .maybeSingle();
      const settings = (tenant?.settings_json || {}) as Record<string, any>;
      setStripeConfigured(!!settings.stripe_configured);
      if (settings.stripe_publishable_key) setStripePublishableKey(settings.stripe_publishable_key);
    } catch (err: any) {
      toast.error('Error al cargar datos de suscripción');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStripeConfig = async () => {
    if (!stripePublishableKey.startsWith('pk_')) {
      toast.error('La publishable key debe empezar con pk_');
      return;
    }
    if (!stripeSecretKey.startsWith('sk_') && !stripeSecretKey.startsWith('rk_')) {
      toast.error('La secret key debe empezar con sk_ o rk_');
      return;
    }
    setSavingStripe(true);
    try {
      const tenantId = await getTenantId();

      // Save publishable key in tenant settings (public)
      const { data: tenant } = await supabase
        .from('tenants')
        .select('settings_json')
        .eq('id', tenantId)
        .maybeSingle();
      const current = (tenant?.settings_json || {}) as Record<string, any>;
      const updated = {
        ...current,
        stripe_configured: true,
        stripe_publishable_key: stripePublishableKey,
      };
      await supabase.from('tenants').update({ settings_json: updated } as any).eq('id', tenantId);

      // Save secret keys via edge function (stored securely)
      const { error } = await supabase.functions.invoke('credential-vault', {
        body: {
          action: 'store',
          credentials: {
            stripe_secret_key: stripeSecretKey,
            stripe_webhook_secret: stripeWebhookSecret || undefined,
          },
        },
      });
      if (error) throw error;

      setStripeConfigured(true);
      setShowStripeWizard(false);
      setStripeSecretKey('');
      setStripeWebhookSecret('');
      toast.success('Stripe configurado correctamente');
    } catch (err: any) {
      toast.error(err.message || 'Error al configurar Stripe');
    } finally {
      setSavingStripe(false);
    }
  };

  const getDaysRemaining = () => {
    if (!subStatus) return 0;
    return (subStatus as any).days_remaining || 0;
  };

  const getStatusLabel = () => {
    if (!subStatus) return { text: 'Sin suscripción', color: 'text-muted-foreground' };
    const s = (subStatus as any).status;
    if (s === 'active') return { text: 'Activa', color: 'text-green-600' };
    if (s === 'trialing') return { text: `Prueba (${getDaysRemaining()} días)`, color: 'text-amber-600' };
    if (s === 'blocked') return { text: 'Bloqueada', color: 'text-destructive' };
    if (s === 'canceled') return { text: 'Cancelada', color: 'text-destructive' };
    return { text: s, color: 'text-muted-foreground' };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const status = getStatusLabel();
  const currentPlanSlug = (subStatus as any)?.plan_slug;

  return (
    <div className="max-w-4xl">
      <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
        <CreditCard size={20} className="text-primary" /> Suscripción y facturación
      </h3>

      {/* Current subscription status */}
      <div className="bg-card border border-border rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Estado actual</p>
            <p className={`text-lg font-bold ${status.color}`}>{status.text}</p>
            {(subStatus as any)?.plan_name && (
              <p className="text-sm text-muted-foreground mt-1">
                Plan: <span className="font-medium text-foreground">{(subStatus as any).plan_name}</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {stripeConfigured ? (
              <span className="flex items-center gap-1.5 text-xs bg-green-500/10 text-green-600 px-3 py-1.5 rounded-full">
                <CheckCircle size={14} /> Stripe activo
              </span>
            ) : (
              isSuperAdmin && (
                <button
                  onClick={() => { setShowStripeWizard(true); setWizardStep(0); }}
                  className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-full hover:opacity-90 transition-opacity"
                >
                  <Zap size={14} /> Configurar Stripe
                </button>
              )
            )}
          </div>
        </div>

        {currentSub?.status === 'trialing' && (
          <div className="mt-3 p-3 bg-amber-500/10 rounded-lg flex items-start gap-2">
            <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-700">Periodo de prueba</p>
              <p className="text-xs text-amber-600">
                Tu prueba termina el {currentSub.trial_ends_at ? new Date(currentSub.trial_ends_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}.
                {!stripeConfigured && isSuperAdmin && ' Configura Stripe para activar pagos antes de que expire.'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Plans grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {plans.map(plan => {
          const isCurrent = plan.slug === currentPlanSlug;
          return (
            <div key={plan.id} className={`bg-card border rounded-xl p-5 transition-all ${isCurrent ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/30'}`}>
              {isCurrent && <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium mb-3 inline-block">Plan actual</span>}
              <h4 className="text-lg font-bold text-foreground">{plan.name}</h4>
              <p className="text-2xl font-bold text-foreground mt-1">
                {plan.price_monthly > 0 ? `$${plan.price_monthly}/mes` : 'Contactar'}
              </p>
              {plan.features && typeof plan.features === 'object' && (
                <ul className="mt-4 space-y-2">
                  {Object.entries(plan.features as Record<string, any>).map(([key, val]) => (
                    <li key={key} className="text-sm text-muted-foreground flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                      {typeof val === 'string' ? val : key}
                    </li>
                  ))}
                </ul>
              )}
              <button
                className={`w-full mt-4 text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
                  isCurrent
                    ? 'bg-secondary text-secondary-foreground'
                    : 'bg-primary text-primary-foreground hover:opacity-90'
                }`}
                disabled={isCurrent}
              >
                {isCurrent ? 'Plan activo' : stripeConfigured ? 'Cambiar plan' : 'Contactar ventas'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Stripe Configuration Wizard - Super Admin only */}
      {showStripeWizard && isSuperAdmin && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowStripeWizard(false)}>
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <CreditCard size={20} className="text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">Configurar Stripe</h3>
                <p className="text-xs text-muted-foreground">Paso {wizardStep + 1} de 3</p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="flex gap-1 mb-6">
              {[0, 1, 2].map(i => (
                <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= wizardStep ? 'bg-primary' : 'bg-muted'}`} />
              ))}
            </div>

            {wizardStep === 0 && (
              <div className="space-y-4 animate-fade-in">
                <div className="bg-secondary/50 rounded-xl p-4">
                  <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-2">
                    <ExternalLink size={14} /> ¿Dónde obtener las credenciales?
                  </h4>
                  <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal pl-4">
                    <li>Ve a <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">dashboard.stripe.com/apikeys</a></li>
                    <li>Copia tu <strong>Publishable key</strong> (empieza con pk_)</li>
                    <li>Copia tu <strong>Secret key</strong> (empieza con sk_ o rk_)</li>
                    <li>Opcional: crea un webhook y copia el <strong>Signing secret</strong></li>
                  </ol>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block flex items-center gap-1">
                    <Key size={12} /> Publishable Key
                  </label>
                  <input
                    className={inputClass}
                    value={stripePublishableKey}
                    onChange={e => setStripePublishableKey(e.target.value.trim())}
                    placeholder="pk_live_... o pk_test_..."
                  />
                </div>
                <button
                  onClick={() => {
                    if (!stripePublishableKey.startsWith('pk_')) {
                      toast.error('La key debe empezar con pk_');
                      return;
                    }
                    setWizardStep(1);
                  }}
                  className="w-full bg-primary text-primary-foreground text-sm px-4 py-2.5 rounded-lg hover:opacity-90 font-medium"
                >
                  Siguiente
                </button>
              </div>
            )}

            {wizardStep === 1 && (
              <div className="space-y-4 animate-fade-in">
                <div className="bg-amber-500/10 rounded-xl p-4 flex items-start gap-2">
                  <Shield size={16} className="text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-700">
                    La secret key se almacena de forma segura y encriptada. Nunca se expone en el frontend.
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block flex items-center gap-1">
                    <Key size={12} /> Secret Key
                  </label>
                  <input
                    type="password"
                    className={inputClass}
                    value={stripeSecretKey}
                    onChange={e => setStripeSecretKey(e.target.value.trim())}
                    placeholder="sk_live_... o rk_live_..."
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setWizardStep(0)} className="flex-1 bg-secondary text-secondary-foreground text-sm px-4 py-2.5 rounded-lg hover:opacity-90">
                    Atrás
                  </button>
                  <button
                    onClick={() => {
                      if (!stripeSecretKey.startsWith('sk_') && !stripeSecretKey.startsWith('rk_')) {
                        toast.error('La key debe empezar con sk_ o rk_');
                        return;
                      }
                      setWizardStep(2);
                    }}
                    className="flex-1 bg-primary text-primary-foreground text-sm px-4 py-2.5 rounded-lg hover:opacity-90 font-medium"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}

            {wizardStep === 2 && (
              <div className="space-y-4 animate-fade-in">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block flex items-center gap-1">
                    <Key size={12} /> Webhook Signing Secret <span className="text-muted-foreground/60">(opcional)</span>
                  </label>
                  <input
                    type="password"
                    className={inputClass}
                    value={stripeWebhookSecret}
                    onChange={e => setStripeWebhookSecret(e.target.value.trim())}
                    placeholder="whsec_..."
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Necesario para recibir eventos de pagos automáticamente. Puedes configurarlo después.
                  </p>
                </div>

                <div className="bg-secondary/50 rounded-xl p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-2">Resumen</h4>
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <p>✓ Publishable Key: <span className="text-foreground font-mono">{stripePublishableKey.slice(0, 12)}...{stripePublishableKey.slice(-4)}</span></p>
                    <p>✓ Secret Key: <span className="text-foreground font-mono">{stripeSecretKey.slice(0, 7)}...{stripeSecretKey.slice(-4)}</span></p>
                    <p>{stripeWebhookSecret ? '✓' : '○'} Webhook Secret: {stripeWebhookSecret ? 'Configurado' : 'No configurado'}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button onClick={() => setWizardStep(1)} className="flex-1 bg-secondary text-secondary-foreground text-sm px-4 py-2.5 rounded-lg hover:opacity-90">
                    Atrás
                  </button>
                  <button
                    onClick={handleSaveStripeConfig}
                    disabled={savingStripe}
                    className="flex-1 bg-primary text-primary-foreground text-sm px-4 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-40 font-medium flex items-center justify-center gap-2"
                  >
                    {savingStripe && <Loader2 size={14} className="animate-spin" />}
                    Activar Stripe
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingSection;
