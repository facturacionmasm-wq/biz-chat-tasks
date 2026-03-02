import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
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

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setTimeout(() => fetchUserData(session.user.id), 0);
      } else {
        setUserRole(null);
        setProfileStatus(null);
        setOnboardingCompleted(null);
        setSubscriptionStatus(null);
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserData(session.user.id);
      }
      setLoading(false);
    });

    // Clear session on browser close if "remember me" is off
    const handleBeforeUnload = () => {
      const remember = localStorage.getItem('rybix_remember_me');
      if (remember === 'false') {
        // Move token to sessionStorage-like behavior by clearing on close
        supabase.auth.signOut();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  const fetchUserData = async (userId: string) => {
    const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: userId });

    const [rolesResult, profileResult, subResult] = await Promise.all([
      tenantId
        ? supabase.from('user_roles').select('role').eq('user_id', userId).eq('tenant_id', tenantId)
        : Promise.resolve({ data: [] as Array<{ role: string }>, error: null }),
      supabase.from('profiles').select('onboarding_completed, status').eq('user_id', userId).maybeSingle(),
      supabase.rpc('get_tenant_subscription_status', { _user_id: userId }),
    ]);

    const roles = (rolesResult.data || []) as Array<{ role: string }>;
    const rolePriority = ['super_admin', 'owner', 'admin', 'staff', 'moderator', 'user'];
    const resolvedRole = rolePriority.find((role) => roles.some((r) => r.role === role)) || roles[0]?.role || null;

    setUserRole(resolvedRole);
    setProfileStatus(profileResult.data?.status ?? null);
    setOnboardingCompleted(profileResult.data?.onboarding_completed ?? null);

    if (subResult.data) {
      setSubscriptionStatus(subResult.data as unknown as SubscriptionStatus);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, userRole, profileStatus, onboardingCompleted, subscriptionStatus, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
