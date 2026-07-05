import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001';

// Master tenant: full feature access
const MASTER_FEATURES: Record<string, any> = {
  whatsapp: true,
  knowledge_base: true,
  voice_agent: true,
  api_access: true,
  custom_integrations: true,
  priority_support: true,
  support_level: 'dedicated',
  direct_support: true,
};

export interface PlanFeaturesState {
  loading: boolean;
  planSlug: string | null;
  planName: string | null;
  features: Record<string, any>;
  supportLevel: 'standard' | 'priority' | 'dedicated' | null;
  isMaster: boolean;
  hasFeature: (key: string) => boolean;
  refresh: () => Promise<void>;
}

export const usePlanFeatures = (): PlanFeaturesState => {
  const { user, subscriptionStatus } = useAuth();
  const [features, setFeatures] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [isMaster, setIsMaster] = useState(false);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (tenantId === MASTER_TENANT_ID) {
        setIsMaster(true);
        setFeatures(MASTER_FEATURES);
        setLoading(false);
        return;
      }
      const slug = subscriptionStatus?.plan_slug;
      if (!slug) { setFeatures({}); setLoading(false); return; }
      const { data } = await supabase
        .from('subscription_plans')
        .select('features')
        .eq('slug', slug)
        .maybeSingle();
      setFeatures(((data?.features as any) || {}) as Record<string, any>);
    } catch (e) {
      console.error('[usePlanFeatures] load failed', e);
      setFeatures({});
    } finally {
      setLoading(false);
    }
  }, [user, subscriptionStatus?.plan_slug]);

  useEffect(() => { load(); }, [load]);

  const hasFeature = (key: string) => {
    if (isMaster) return true;
    return Boolean(features?.[key]);
  };

  const supportLevel = (isMaster ? 'dedicated' : (features?.support_level as any)) ?? null;

  return {
    loading,
    planSlug: isMaster ? 'master' : (subscriptionStatus?.plan_slug ?? null),
    planName: isMaster ? 'Master' : (subscriptionStatus?.plan_name ?? null),
    features: isMaster ? MASTER_FEATURES : features,
    supportLevel,
    isMaster,
    hasFeature,
    refresh: load,
  };
};
