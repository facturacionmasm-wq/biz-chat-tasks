import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import PlanSelectionPanel from '@/components/PlanSelectionPanel';
import { Loader2 } from 'lucide-react';

const SubscriptionBlockedPage = () => {
  const { user, signOut, subscriptionStatus } = useAuth();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        await supabase.rpc('ensure_tenant_for_current_user');
        const { data: tid } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
        if (tid) {
          setTenantId(tid as unknown as string);
          const { data: t } = await supabase
            .from('tenants')
            .select('country_code')
            .eq('id', tid as unknown as string)
            .maybeSingle();
          setCountryCode((t as any)?.country_code || 'MX');
        }
      } catch (e) {
        console.warn('[Blocked] resolve tenant failed:', e);
      } finally {
        setResolving(false);
      }
    })();
  }, [user]);

  const planName = subscriptionStatus?.plan_name;
  const trialEnded = subscriptionStatus?.trial_ends_at
    ? new Date(subscriptionStatus.trial_ends_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="min-h-screen bg-background flex items-start justify-center p-4 py-10">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-6">
          {planName && (
            <p className="text-xs text-[var(--rx-t2)] mb-2">
              Plan anterior: <span className="font-semibold text-foreground">{planName}</span>
              {trialEnded && <> · finalizó el {trialEnded}</>}
            </p>
          )}
        </div>

        {resolving ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-[var(--rx-brand)]" size={32} />
          </div>
        ) : (
          <PlanSelectionPanel
            tenantId={tenantId}
            countryCode={countryCode}
            variant="reactivation"
          />
        )}

        <div className="text-center mt-6">
          <button
            onClick={signOut}
            className="text-sm text-[var(--rx-t2)] hover:text-foreground transition-colors underline"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionBlockedPage;
