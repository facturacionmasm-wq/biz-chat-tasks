import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { User, Session } from '@supabase/supabase-js';

interface SubscriptionStatus {
  status: string;
  trial_ends_at: string | null;
  plan_slug: string | null;
  plan_name: string | null;
  is_blocked: boolean;
  days_remaining: number;
  stripe_subscription_id?: string | null;
  has_paid_subscription?: boolean;
  is_master_tenant?: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  userRole: string | null;
  profileStatus: string | null;
  onboardingCompleted: boolean | null;
  subscriptionStatus: SubscriptionStatus | null;
  tenantId: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  userRole: null,
  profileStatus: null,
  onboardingCompleted: null,
  subscriptionStatus: null,
  tenantId: null,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);

  /**
   * Fetch user-specific data (tenant, role, profile) after successful authentication.
   * Subscription status is handled by a separate React Query below so it can be
   * shared across the app with a 5-minute staleTime and invalidated on demand.
   */
  const fetchUserData = useCallback(async (userId: string) => {
    try {
      // Self-heal: if the signup trigger never created a tenant/profile
      // for this user, do it on the fly so onboarding can render.
      try {
        await supabase.rpc('ensure_tenant_for_current_user');
      } catch (healErr) {
        console.warn('[RYBIX] ensure_tenant_for_current_user failed:', healErr);
      }

      const { data: resolvedTenantId, error: tenantError } = await supabase.rpc('get_user_tenant_id', { _user_id: userId });
      if (tenantError) {
        console.warn('[RYBIX] get_user_tenant_id failed:', tenantError.message);
      }

      const [rolesResult, profileResult] = await Promise.all([
        resolvedTenantId
          ? supabase.from('user_roles').select('role').eq('user_id', userId).eq('tenant_id', resolvedTenantId)
          : Promise.resolve({ data: [] as Array<{ role: string }>, error: null }),
        supabase.from('profiles').select('onboarding_completed, status').eq('user_id', userId).maybeSingle(),
      ]);

      const roles = (rolesResult.data || []) as Array<{ role: string }>;
      const rolePriority = ['super_admin', 'owner', 'admin', 'staff', 'moderator', 'user'];
      const resolvedRole = rolePriority.find(r => roles.some(row => row.role === r)) || roles[0]?.role || null;

      setTenantId(resolvedTenantId ?? null);
      setUserRole(resolvedRole);
      setProfileStatus(profileResult.data?.status ?? null);
      setOnboardingCompleted(profileResult.data?.onboarding_completed ?? false);
    } catch (err) {
      console.error('[RYBIX] fetchUserData failed:', err);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;

      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (newSession?.user) {
        setTimeout(() => {
          if (mounted) fetchUserData(newSession.user.id);
        }, 0);
      } else {
        setTenantId(null);
        setUserRole(null);
        setProfileStatus(null);
        setOnboardingCompleted(null);
        // Clear cached queries scoped to the previous user/tenant
        queryClient.removeQueries({ queryKey: ['subscription-status'] });
        queryClient.removeQueries({ queryKey: ['plan-features'] });
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchUserData, queryClient]);

  // Subscription status — cached 5 min, shared across the app
  const subscriptionQuery = useQuery({
    queryKey: ['subscription-status', user?.id ?? null],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_tenant_subscription_status', { _user_id: user!.id });
      if (error) throw error;
      return (data as unknown as SubscriptionStatus) ?? null;
    },
  });

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('[RYBIX] signOut error:', err);
    }
  };

  return (
    <AuthContext.Provider value={{
      user, session, loading, userRole,
      profileStatus, onboardingCompleted,
      subscriptionStatus: (subscriptionQuery.data as SubscriptionStatus | null) ?? null,
      tenantId,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
