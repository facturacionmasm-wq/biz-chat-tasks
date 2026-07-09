import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePlanFeatures } from '@/hooks/usePlanFeatures';
import { toast } from 'sonner';

const OWNER_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export const usePaymentGate = () => {
  const { hasFeature, isMaster: planIsMaster, loading: planLoading } = usePlanFeatures();
  const { user, tenantId } = useAuth();
  const [redirecting, setRedirecting] = useState(false);

  const isOwnerTenant = tenantId === OWNER_TENANT_ID;

  const paymentMethodQuery = useQuery({
    queryKey: ['payment-method', tenantId],
    enabled: !!user && !!tenantId && !isOwnerTenant,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.functions.invoke('stripe-billing', {
        body: { action: 'check_payment_method', tenant_id: tenantId },
      });
      return !!data?.has_payment_method;
    },
  });

  const packageBalancesQuery = useQuery({
    queryKey: ['tenant-package-balances', tenantId],
    enabled: !!user && !!tenantId && !isOwnerTenant,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from('tenant_package_balances')
        .select('service_type, units_remaining')
        .eq('tenant_id', tenantId!)
        .in('status', ['active', 'pending_payment']);
      const activeByType: Record<string, boolean> = {};
      for (const b of (data || []) as any[]) {
        if (b.units_remaining > 0) activeByType[b.service_type] = true;
      }
      return activeByType;
    },
  });

  const hasPaymentMethod = isOwnerTenant ? true : (paymentMethodQuery.data ?? null);
  const hasActivePackage = isOwnerTenant
    ? { voice: true, whatsapp: true }
    : (packageBalancesQuery.data ?? {});

  // Loading: waiting for tenant to resolve, or for underlying queries
  const loading = !user
    ? false
    : (!tenantId || (!isOwnerTenant && (paymentMethodQuery.isLoading || packageBalancesQuery.isLoading)));

  const canUseService = (serviceType: 'voice' | 'whatsapp'): boolean => {
    if (planIsMaster || isOwnerTenant) return true;
    if (serviceType === 'voice') {
      if (planLoading) return false;
      if (!hasFeature('voice_agent')) return false;
    }
    return hasActivePackage[serviceType] === true || hasPaymentMethod === true;
  };

  const resolveDisplayName = useCallback(async () => {
    if (!user) return 'Cliente';
    const { data: profile } = await supabase
      .from('profiles').select('name').eq('user_id', user.id).maybeSingle();
    return profile?.name
      || user.user_metadata?.name
      || (user.email ? user.email.split('@')[0] : 'Cliente');
  }, [user]);

  const purchasePackage = useCallback(async (packageId: string) => {
    if (!user || !tenantId) return;
    setRedirecting(true);
    try {
      const displayName = await resolveDisplayName();
      const { data, error } = await supabase.functions.invoke('stripe-billing', {
        body: {
          action: 'purchase_package',
          tenant_id: tenantId,
          package_id: packageId,
          email: user.email,
          name: displayName,
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
  }, [user, tenantId, resolveDisplayName]);

  const setupCard = useCallback(async (serviceType: 'voice' | 'whatsapp') => {
    if (!user || !tenantId) return;
    setRedirecting(true);
    try {
      const displayName = await resolveDisplayName();
      const { data, error } = await supabase.functions.invoke('stripe-billing', {
        body: {
          action: 'create_setup_session',
          tenant_id: tenantId,
          email: user.email,
          name: displayName,
          service_type: serviceType,
        },
      });
      if (error) throw error;
      if (data?.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        throw new Error('No se recibió URL de checkout');
      }
    } catch (err: any) {
      toast.error(err.message || 'Error al registrar tarjeta');
      setRedirecting(false);
    }
  }, [user, tenantId, resolveDisplayName]);

  const voicePlanBlocked = !planIsMaster && !isOwnerTenant && !planLoading && !hasFeature('voice_agent');

  const refresh = useCallback(async () => {
    await Promise.all([paymentMethodQuery.refetch(), packageBalancesQuery.refetch()]);
  }, [paymentMethodQuery, packageBalancesQuery]);

  return {
    hasPaymentMethod,
    hasActivePackage,
    loading,
    redirecting,
    canUseService,
    purchasePackage,
    setupCard,
    refresh,
    isOwnerTenant,
    voicePlanBlocked,
  };
};
