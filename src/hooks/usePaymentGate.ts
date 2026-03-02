import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export const usePaymentGate = () => {
  const { user } = useAuth();
  const [hasPaymentMethod, setHasPaymentMethod] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);

  const checkPaymentMethod = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tenantId) { setHasPaymentMethod(false); setLoading(false); return; }

      const { data, error } = await supabase.functions.invoke('stripe-billing', {
        body: { action: 'check_payment_method', tenant_id: tenantId },
      });

      if (error) throw error;
      setHasPaymentMethod(data?.has_payment_method ?? false);
    } catch (err) {
      console.error('Error checking payment method:', err);
      setHasPaymentMethod(false);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { checkPaymentMethod(); }, [checkPaymentMethod]);

  const redirectToSetup = useCallback(async () => {
    if (!user) return;
    setRedirecting(true);
    try {
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tenantId) throw new Error('Tenant no encontrado');

      const { data, error } = await supabase.functions.invoke('stripe-billing', {
        body: {
          action: 'create_setup_session',
          tenant_id: tenantId,
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
      toast.error(err.message || 'Error al iniciar registro de tarjeta');
      setRedirecting(false);
    }
  }, [user]);

  return { hasPaymentMethod, loading, redirecting, redirectToSetup, refresh: checkPaymentMethod };
};
