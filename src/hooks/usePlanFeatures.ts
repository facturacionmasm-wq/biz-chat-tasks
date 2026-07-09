import { useQuery } from '@tanstack/react-query';
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
  const { user, subscriptionStatus, tenantId } = useAuth();
  const isMaster = tenantId === MASTER_TENANT_ID;
  const slug = subscriptionStatus?.plan_slug ?? null;

  const query = useQuery({
    queryKey: ['plan-features', tenantId, slug],
    enabled: !!user && !isMaster && !!slug,
    staleTime: 30 * 60 * 1000, // 30 min
    gcTime: 60 * 60 * 1000,
    refetchOnMount: false,
    queryFn: async () => {
      const { data } = await supabase
        .from('subscription_plans')
        .select('features')
        .eq('slug', slug!)
        .maybeSingle();
      return ((data?.features as any) || {}) as Record<string, any>;
    },
  });

  const features = isMaster ? MASTER_FEATURES : (query.data ?? {});

  // Loading only when we actually need to fetch (not master, and either waiting
  // for tenant/subscription resolution or for the plan-features query itself).
  const loading = isMaster
    ? false
    : (!!user && (!tenantId || !slug || query.isLoading));

  const hasFeature = (key: string) => {
    if (isMaster) return true;
    return Boolean(features?.[key]);
  };

  const supportLevel = (isMaster ? 'dedicated' : (features?.support_level as any)) ?? null;

  return {
    loading,
    planSlug: isMaster ? 'master' : (subscriptionStatus?.plan_slug ?? null),
    planName: isMaster ? 'Master' : (subscriptionStatus?.plan_name ?? null),
    features,
    supportLevel,
    isMaster,
    hasFeature,
    refresh: async () => { await query.refetch(); },
  };
};
