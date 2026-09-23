import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, type Session } from '@/lib/api';
import type { AppUser } from '@/types';

interface AuthContextValue {
  session: Session | null;
  user: AppUser | null;
  loading: boolean;
  isAdmin: boolean;
  canManageProjects: boolean;
  canAccessClub: boolean;
  // With two-factor enabled, the first call reports mfaRequired; call again
  // with the 6-digit code.
  signIn: (
    email: string,
    password: string,
    code?: string,
  ) => Promise<{ error: string | null; mfaRequired: boolean }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (uid: string) => {
    // Attach any member rows whose (verified) email matches this account so
    // past guest check-ins/sign-ups connect to the account. Idempotent.
    await api.rpc('claim_my_memberships');
    const { data } = await api.from('app_users').select('*').eq('id', uid).maybeSingle();
    setUser((data as AppUser) ?? null);
  };

  useEffect(() => {
    api.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await loadProfile(data.session.user.id);
      setLoading(false);
    });

    const { data: sub } = api.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        await loadProfile(newSession.user.id);
      } else {
        setUser(null);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user,
      loading,
      isAdmin: Boolean(user?.is_admin),
      canManageProjects: Boolean(user?.is_admin || user?.can_manage_projects),
      canAccessClub: Boolean(user?.is_admin || user?.can_access_club),
      signIn: async (email, password, code) => {
        const { data, error } = await api.auth.signInWithPassword({ email, password, code });
        return { error: error?.message ?? null, mfaRequired: data.mfaRequired };
      },
      signOut: async () => {
        await api.auth.signOut();
        setUser(null);
        setSession(null);
      },
      refreshUser: async () => {
        if (session) await loadProfile(session.user.id);
      },
    }),
    [session, user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
