import { useEffect, useState } from 'react';
import { CreditCard, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const DISMISS_KEY = 'trial_card_banner_dismissed_at';

/**
 * Persistent banner shown when the tenant is on `trialing` status and
 * has NOT registered a payment method yet. Prevents silent trial expiry
 * after the user cancels the initial Stripe SetupIntent flow.
 */
const TrialCardBanner = () => {
  const { user, subscriptionStatus } = useAuth();
  const [hasPaymentMethod, setHasPaymentMethod] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    const at = typeof window !== 'undefined' ? window.localStorage.getItem(DISMISS_KEY) : null;
    if (!at) return false;
    // Re-show every 24h
    return Date.now() - Number(at) < 24 * 60 * 60 * 1000;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user || subscriptionStatus?.status !== 'trialing') return;
      try {
        const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
        if (!tenantId || cancelled) return;
        const { data } = await supabase.functions.invoke('stripe-billing', {
          body: { action: 'check_payment_method', tenant_id: tenantId },
        });
        if (!cancelled) setHasPaymentMethod(!!data?.has_payment_method);
      } catch (err) {
        console.warn('[TrialCardBanner] check_payment_method failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [user, subscriptionStatus?.status]);

  const handleAddCard = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tenantId) throw new Error('Tenant no encontrado');
      const { data: profile } = await supabase
        .from('profiles').select('name').eq('user_id', user.id).maybeSingle();
      const displayName = profile?.name || (user.email ? user.email.split('@')[0] : 'Cliente');
      const { data, error } = await supabase.functions.invoke('stripe-billing', {
        body: {
          action: 'create_setup_session',
          tenant_id: tenantId,
          email: user.email,
          name: displayName,
          service_type: 'onboarding',
          return_to: '/',
        },
      });
      if (error) throw error;
      if (data?.checkout_url) window.location.href = data.checkout_url;
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo iniciar el registro de tarjeta');
      setBusy(false);
    }
  };

  if (
    !user ||
    dismissed ||
    subscriptionStatus?.status !== 'trialing' ||
    hasPaymentMethod !== false
  ) return null;

  const daysLeft = subscriptionStatus?.days_remaining ?? 0;

  return (
    <div className="mx-3 sm:mx-5 mt-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3 shadow-soft">
      <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-600 flex items-center justify-center shrink-0">
        <CreditCard size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">
          Agrega una tarjeta para no perder acceso al terminar tu prueba
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {daysLeft > 0
            ? `Te quedan ${daysLeft} día${daysLeft === 1 ? '' : 's'} de prueba. Registra un método de pago para continuar sin interrupciones.`
            : 'Tu prueba está por terminar. Registra un método de pago para continuar sin interrupciones.'}
        </p>
        <div className="mt-2 flex gap-2 flex-wrap">
          <button
            onClick={handleAddCard}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-3 py-1.5 transition-colors disabled:opacity-60"
          >
            {busy ? 'Redirigiendo…' : 'Agregar tarjeta'}
          </button>
        </div>
      </div>
      <button
        aria-label="Descartar"
        onClick={() => {
          window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
          setDismissed(true);
        }}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default TrialCardBanner;
