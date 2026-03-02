import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export const usePaymentGate = () => {
  const { user } = useAuth();
  const [hasPaymentMethod, setHasPaymentMethod] = useState<boolean | null>(null);
  const [hasActivePackage, setHasActivePackage] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);

  const checkAccess = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tenantId) { setHasPaymentMethod(false); setLoading(false); return; }

      // Check payment method
      const { data: pmData } = await supabase.functions.invoke('stripe-billing', {
        body: { action: 'check_payment_method', tenant_id: tenantId },
      });
      setHasPaymentMethod(pmData?.has_payment_method ?? false);

      // Check active package balances
      const { data: balances } = await supabase
        .from('tenant_package_balances')
        .select('service_type, units_remaining')
        .eq('tenant_id', tenantId)
        .in('status', ['active', 'pending_payment']);

      const activeByType: Record<string, boolean> = {};
      for (const b of (balances || []) as any[]) {
        if (b.units_remaining > 0) {
          activeByType[b.service_type] = true;
        }
      }
      setHasActivePackage(activeByType);
    } catch (err) {
      console.error('Error checking payment access:', err);
      setHasPaymentMethod(false);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { checkAccess(); }, [checkAccess]);

  const canUseService = (serviceType: 'voice' | 'whatsapp'): boolean => {
    // Has active package with remaining units OR has payment method (for pay-as-you-go)
    return hasActivePackage[serviceType] === true || hasPaymentMethod === true;
  };

  const purchasePackage = useCallback(async (packageId: string) => {
    if (!user) return;
    setRedirecting(true);
    try {
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tenantId) throw new Error('Tenant no encontrado');

      const { data, error } = await supabase.functions.invoke('stripe-billing', {
        body: {
          action: 'purchase_package',
          tenant_id: tenantId,
          package_id: packageId,
          email: user.email,
          name: user.user_metadata?.name || user.email,
        },
      });

      if (error) throw error;
      if (data?.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        throw new Error('No se recibió URL de checkout');
      }
    } catch (err: any) {
      toast.error(err.message || 'Error al iniciar compra');
      setRedirecting(false);
    }
  }, [user]);

  return { hasPaymentMethod, hasActivePackage, loading, redirecting, canUseService, purchasePackage, refresh: checkAccess };
};
