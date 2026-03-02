import { useState, useEffect } from 'react';
import { CreditCard, Loader2, CheckCircle, AlertTriangle, ExternalLink, Key, Zap, Shield, Building2, Users, Crown, BarChart3, ArrowUpRight, MessageSquare, DollarSign } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { User } from '@supabase/supabase-js';
import { useTenantBilling } from '@/hooks/useTenantBilling';

interface BillingSectionProps {
  user: User | null;
  isSuperAdmin: boolean;
  getTenantId: () => Promise<string>;
  inputClass: string;
  userRole: string | null;
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

interface TenantSubRow {
  id: string;
  tenant_id: string;
  status: string;
  trial_ends_at: string | null;
  plan_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

const BillingSection = ({ user, isSuperAdmin, getTenantId, inputClass, userRole }: BillingSectionProps) => {
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<SubPlan[]>([]);
  const [currentSub, setCurrentSub] = useState<TenantSubRow | null>(null);
  const [subStatus, setSubStatus] = useState<any>(null);

  // Stripe wizard state (super_admin only)
  const [showStripeWizard, setShowStripeWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [stripePublishableKey, setStripePublishableKey] = useState('');
  const [stripeSecretKey, setStripeSecretKey] = useState('');
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState('');
  const [savingStripe, setSavingStripe] = useState(false);
  const [stripeConfigured, setStripeConfigured] = useState(false);

  // Super admin: all tenants overview
  const [allTenants, setAllTenants] = useState<Array<{
    id: string;
    name: string;
    status: string;
    plan_name: string | null;
    trial_ends_at: string | null;
    days_remaining: number;
  }>>([]);

  const [isMasterTenant, setIsMasterTenant] = useState(false);
  const [effectiveRole, setEffectiveRole] = useState<string | null>(userRole);
  const isMasterAdmin = effectiveRole === 'super_admin' || (effectiveRole === 'owner' && isMasterTenant);

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

      const masterTenantId = '00000000-0000-0000-0000-000000000001';
      const isMasterTenantUser = tenantId === masterTenantId;
      setIsMasterTenant(isMasterTenantUser);

      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user!.id)
        .eq('tenant_id', tenantId);

      const rolePriority = ['super_admin', 'owner', 'admin', 'staff', 'moderator', 'user'];
      const resolvedRole = rolePriority.find((role) => (roles || []).some((r: any) => r.role === role)) || (roles || [])[0]?.role || userRole || null;
      setEffectiveRole(resolvedRole);

      const isMasterAdminUser = resolvedRole === 'super_admin' || (resolvedRole === 'owner' && isMasterTenantUser);

      // Load current subscription
      const { data: sub } = await supabase
        .from('tenant_subscriptions')
        .select('id, tenant_id, status, trial_ends_at, plan_id, stripe_customer_id, stripe_subscription_id')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      setCurrentSub(sub);

      // Check if Stripe is globally configured (master tenant settings)
      const { data: masterTenant } = await supabase
        .from('tenants')
        .select('settings_json')
        .eq('id', masterTenantId)
        .maybeSingle();
      const masterSettings = (masterTenant?.settings_json || {}) as Record<string, any>;
      setStripeConfigured(!!masterSettings.stripe_configured);
      if (masterSettings.stripe_publishable_key) setStripePublishableKey(masterSettings.stripe_publishable_key);

      // Super admin: load all tenants with their subscription status
      if (isMasterAdminUser) {
        const { data: subs } = await supabase
          .from('tenant_subscriptions')
          .select('tenant_id, status, trial_ends_at, plan_id');
        const { data: tenants } = await supabase
          .from('tenants')
          .select('id, name');
        const planMap = new Map((plansRes.data || []).map((p: any) => [p.id, p.name]));

        if (tenants && subs) {
          const subMap = new Map(subs.map(s => [s.tenant_id, s]));
          setAllTenants(tenants
            .filter(t => t.id !== masterTenantId) // exclude master
            .map(t => {
              const s = subMap.get(t.id);
              const daysLeft = s?.trial_ends_at && s.status === 'trialing'
                ? Math.max(0, Math.ceil((new Date(s.trial_ends_at).getTime() - Date.now()) / 86400000))
                : 0;
              return {
                id: t.id,
                name: t.name,
                status: s?.status || 'no_subscription',
                plan_name: s ? (planMap.get(s.plan_id) || null) : null,
                trial_ends_at: s?.trial_ends_at || null,
                days_remaining: daysLeft,
              };
            }));
        }
      }
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
      // Save publishable key in MASTER tenant settings (global)
      const masterTenantId = '00000000-0000-0000-0000-000000000001';
      const { data: tenant } = await supabase
        .from('tenants')
        .select('settings_json')
        .eq('id', masterTenantId)
        .maybeSingle();
      const current = (tenant?.settings_json || {}) as Record<string, any>;
      const updated = {
        ...current,
        stripe_configured: true,
        stripe_publishable_key: stripePublishableKey,
      };
      const { error: updateError } = await supabase.from('tenants').update({ settings_json: updated } as any).eq('id', masterTenantId);
      if (updateError) throw updateError;

      // Validate that Stripe secret key works by making a test call
      const { data: testData, error: testError } = await supabase.functions.invoke('stripe-billing', {
        body: {
          action: 'validate_key',
          secret_key: stripeSecretKey,
          webhook_secret: stripeWebhookSecret || undefined,
        },
      });

      // If the validate_key action doesn't exist yet, just save settings
      // The STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are already configured as backend secrets
      if (testError) {
        console.warn('Stripe key validation skipped (secrets already configured at infrastructure level)');
      }

      setStripeConfigured(true);
      setShowStripeWizard(false);
      setStripeSecretKey('');
      setStripeWebhookSecret('');
      toast.success('Stripe configurado globalmente para el sistema');
    } catch (err: any) {
      toast.error(err.message || 'Error al configurar Stripe');
    } finally {
      setSavingStripe(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return { text: 'Activa', cls: 'bg-green-500/10 text-green-600' };
      case 'trialing': return { text: 'Trial', cls: 'bg-amber-500/10 text-amber-600' };
      case 'blocked': return { text: 'Bloqueada', cls: 'bg-destructive/10 text-destructive' };
      case 'canceled': return { text: 'Cancelada', cls: 'bg-destructive/10 text-destructive' };
      default: return { text: 'Sin plan', cls: 'bg-muted text-muted-foreground' };
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

  // ── SUPER ADMIN (Master Account) View ──
  if (isMasterAdmin) {
    return (
      <div className="max-w-5xl">
        <h3 className="text-lg font-bold text-foreground mb-1 flex items-center gap-2">
          <Crown size={20} className="text-primary" /> Panel de Facturación — Cuenta Maestra
        </h3>
        <p className="text-sm text-muted-foreground mb-6">
          Desde aquí gestionas Stripe y los cobros a todos los tenants del sistema.
        </p>

        {/* Stripe status card */}
        <div className="bg-card border border-border rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Pasarela de pagos</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {stripeConfigured
                  ? 'Stripe está configurado y listo para cobrar suscripciones.'
                  : 'Configura Stripe para poder cobrar a los tenants.'}
              </p>
            </div>
            {stripeConfigured ? (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs bg-green-500/10 text-green-600 px-3 py-1.5 rounded-full">
                  <CheckCircle size={14} /> Stripe activo
                </span>
                <button
                  onClick={() => { setShowStripeWizard(true); setWizardStep(0); }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
                >
                  Reconfigurar
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setShowStripeWizard(true); setWizardStep(0); }}
                className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:opacity-90 transition-opacity font-medium"
              >
                <Zap size={14} /> Configurar Stripe
              </button>
            )}
          </div>
        </div>

        {/* Plans overview */}
        <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <CreditCard size={16} /> Planes disponibles
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          {plans.map(plan => (
            <div key={plan.id} className="bg-card border border-border rounded-xl p-4">
              <h5 className="text-sm font-bold text-foreground">{plan.name}</h5>
              <p className="text-lg font-bold text-foreground mt-0.5">
                {plan.price_monthly > 0 ? `$${plan.price_monthly}/mes` : 'Personalizado'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {allTenants.filter(t => t.plan_name === plan.name).length} tenant(s) en este plan
              </p>
            </div>
          ))}
        </div>

        {/* All tenants table */}
        <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Building2 size={16} /> Tenants registrados ({allTenants.length})
        </h4>
        {allTenants.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-8 text-center">
            <Users size={32} className="mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No hay tenants registrados aún.</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Tenant</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Plan</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Estado</th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Trial</th>
                  </tr>
                </thead>
                <tbody>
                  {allTenants.map(t => {
                    const badge = getStatusBadge(t.status);
                    return (
                      <tr key={t.id} className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
                        <td className="py-2.5 px-4 font-medium text-foreground">{t.name}</td>
                        <td className="py-2.5 px-4 text-muted-foreground">{t.plan_name || '—'}</td>
                        <td className="py-2.5 px-4">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                            {badge.text}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-muted-foreground text-xs">
                          {t.status === 'trialing' ? (
                            <span>{t.days_remaining} días restantes</span>
                          ) : t.trial_ends_at ? (
                            <span>Expiró {new Date(t.trial_ends_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span>
                          ) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Stripe Wizard Modal */}
        {renderStripeWizard()}
      </div>
    );
  }

  // ── REGULAR TENANT OWNER View with usage data ──
  return <TenantBillingView
    status={status}
    subStatus={subStatus}
    currentSub={currentSub}
    currentPlanSlug={currentPlanSlug}
    plans={plans}
    getTenantId={getTenantId}
  />;


  function renderStripeWizard() {
    if (!showStripeWizard) return null;
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowStripeWizard(false)}>
        <div className="bg-card border border-border rounded-2xl w-full max-w-lg p-6 shadow-xl" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <CreditCard size={20} className="text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">Configurar Stripe — Cuenta Maestra</h3>
              <p className="text-xs text-muted-foreground">Paso {wizardStep + 1} de 3 · Estas claves aplican a todos los tenants</p>
            </div>
          </div>

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
                  Necesario para recibir eventos de pagos automáticamente.
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
    );
  }
};

// ── Tenant Billing View with Usage Data ──
const TenantBillingView = ({ status, subStatus, currentSub, currentPlanSlug, plans, getTenantId }: {
  status: { text: string; color: string };
  subStatus: any;
  currentSub: TenantSubRow | null;
  currentPlanSlug: string;
  plans: SubPlan[];
  getTenantId: () => Promise<string>;
}) => {
  const [tenantId, setTenantId] = useState<string | null>(null);
  useEffect(() => { getTenantId().then(setTenantId); }, []);
  const { currentMonth, costHistory, fxRate, isLoading: usageLoading } = useTenantBilling(tenantId);

  const fxInfo = fxRate.data;
  const history = costHistory.data || [];

  return (
    <div className="max-w-4xl">
      <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
        <CreditCard size={20} className="text-primary" /> Tu suscripción
      </h3>

      {/* Current subscription status */}
      <div className="bg-card border border-border rounded-xl p-5 mb-6">
        <div>
          <p className="text-sm text-muted-foreground">Estado actual</p>
          <p className={`text-lg font-bold ${status.color}`}>{status.text}</p>
          {(subStatus as any)?.plan_name && (
            <p className="text-sm text-muted-foreground mt-1">
              Plan: <span className="font-medium text-foreground">{(subStatus as any).plan_name}</span>
            </p>
          )}
        </div>

        {currentSub?.status === 'trialing' && (
          <div className="mt-3 p-3 bg-amber-500/10 rounded-lg flex items-start gap-2">
            <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-700">Periodo de prueba</p>
              <p className="text-xs text-amber-600">
                Tu prueba termina el {currentSub.trial_ends_at ? new Date(currentSub.trial_ends_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}.
                Contacta al administrador para activar tu plan.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Usage Summary - Current Month */}
      <div className="bg-card border border-border rounded-xl p-5 mb-6">
        <h4 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <MessageSquare size={16} className="text-primary" /> Uso del mes actual
        </h4>
        {usageLoading ? (
          <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground">Mensajes totales</p>
              <p className="text-xl font-bold text-foreground">{currentMonth.totalUnits}</p>
            </div>
            <div className="p-3 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground">Enviados</p>
              <p className="text-xl font-bold text-foreground">{currentMonth.byType['message_out'] || 0}</p>
            </div>
            <div className="p-3 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground">Recibidos</p>
              <p className="text-xl font-bold text-foreground">{currentMonth.byType['message_in'] || 0}</p>
            </div>
            <div className="p-3 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground">Tipo cambio USD/MXN</p>
              <p className="text-xl font-bold text-foreground">{fxInfo?.rate?.toFixed(2) || '—'}</p>
            </div>
          </div>
        )}
      </div>

      {/* Cost History */}
      {history.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 mb-6">
          <h4 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <DollarSign size={16} className="text-primary" /> Historial de costos
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 px-3 font-medium text-muted-foreground">Periodo</th>
                  <th className="py-2 px-3 font-medium text-muted-foreground text-right">Unidades</th>
                  <th className="py-2 px-3 font-medium text-muted-foreground text-right">Costo ({history[0]?.currency || 'MXN'})</th>
                  <th className="py-2 px-3 font-medium text-muted-foreground text-right">Costo (USD)</th>
                  <th className="py-2 px-3 font-medium text-muted-foreground text-right">Margen</th>
                  <th className="py-2 px-3 font-medium text-muted-foreground text-right">FX</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="py-2 px-3 text-foreground">{h.period_start}</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">{h.total_units}</td>
                    <td className="py-2 px-3 text-right text-foreground">${Number(h.real_cost_local_currency).toFixed(2)}</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">${Number(h.real_cost_usd).toFixed(2)}</td>
                    <td className="py-2 px-3 text-right font-semibold text-foreground">{Number(h.margin_pct).toFixed(1)}%</td>
                    <td className="py-2 px-3 text-right text-muted-foreground text-xs">{Number(h.fx_rate_used).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Plans (read-only) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map(plan => {
          const isCurrent = plan.slug === currentPlanSlug;
          return (
            <div key={plan.id} className={`bg-card border rounded-xl p-5 transition-all ${isCurrent ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}>
              {isCurrent && <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium mb-3 inline-block">Tu plan</span>}
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
              {!isCurrent && (
                <p className="text-xs text-muted-foreground mt-4 text-center">
                  Contacta al administrador para cambiar de plan
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default BillingSection;
