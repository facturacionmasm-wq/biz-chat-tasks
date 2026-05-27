import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

interface SubscriptionStatus {
  status: string;
  trial_ends_at: string | null;
  plan_slug: string | null;
  plan_name: string | null;
  is_blocked: boolean;
  days_remaining: number;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  userRole: string | null;
  profileStatus: string | null;
  onboardingCompleted: boolean | null;
  subscriptionStatus: SubscriptionStatus | null;
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
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);

  /**
   * Fetch user-specific data from Supabase after successful authentication.
   * All errors are caught and logged — they must never propagate to React's render cycle.
   */
  const fetchUserData = useCallback(async (userId: string) => {
    try {
      const { data: tenantId, error: tenantError } = await supabase.rpc('get_user_tenant_id', { _user_id: userId });

      if (tenantError) {
        console.warn('[RYBIX] get_user_tenant_id failed:', tenantError.message);
      }

      const [rolesResult, profileResult, subResult] = await Promise.all([
        tenantId
          ? supabase.from('user_roles').select('role').eq('user_id', userId).eq('tenant_id', tenantId)
          : Promise.resolve({ data: [] as Array<{ role: string }>, error: null }),
        supabase.from('profiles').select('onboarding_completed, status').eq('user_id', userId).maybeSingle(),
        supabase.rpc('get_tenant_subscription_status', { _user_id: userId }),
      ]);

      const roles = (rolesResult.data || []) as Array<{ role: string }>;
      const rolePriority = ['super_admin', 'owner', 'admin', 'staff', 'moderator', 'user'];
      const resolvedRole = rolePriority.find(r => roles.some(row => row.role === r)) || roles[0]?.role || null;

      setUserRole(resolvedRole);
      setProfileStatus(profileResult.data?.status ?? null);
      setOnboardingCompleted(profileResult.data?.onboarding_completed ?? null);

      if (subResult.data) {
        setSubscriptionStatus(subResult.data as unknown as SubscriptionStatus);
      }
    } catch (err) {
      // Log but DO NOT re-throw — a fetch error should never crash the app
      console.error('[RYBIX] fetchUserData failed:', err);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    /**
     * onAuthStateChange fires an INITIAL_SESSION event immediately on mount
     * (Supabase v2), so we don't need a separate getSession() call.
     * Using only one listener avoids duplicate fetchUserData calls and
     * the race condition they caused.
     */
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;

      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (newSession?.user) {
        // Defer to avoid blocking the auth state change callback
        setTimeout(() => {
          if (mounted) fetchUserData(newSession.user.id);
        }, 0);
      } else {
        setUserRole(null);
        setProfileStatus(null);
        setOnboardingCompleted(null);
        setSubscriptionStatus(null);
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchUserData]);

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
      profileStatus, onboardingCompleted, subscriptionStatus, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
