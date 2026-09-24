import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, type ApiError, type MfaChallenge, type Session } from '@/lib/api';
import type { AppUser } from '@/types';

interface AuthContextValue {
  session: Session | null;
  user: AppUser | null;
  loading: boolean;
  isAdmin: boolean;
  canManageProjects: boolean;
  canAccessClub: boolean;
  // The admin requires 2FA for this account and none is set up yet: the app
  // shows only the setup until refreshSession() reports it done.
  mfaSetupRequired: boolean;
  refreshSession: () => Promise<void>;
  // With two-factor enabled the password only opens a challenge (mfa), to
  // be answered with api.auth.completeSignIn.
  signIn: (email: string, password: string) => Promise<{ error: ApiError | null; mfa: MfaChallenge | null }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false);

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
      setMfaSetupRequired(data.mfaSetupRequired);
      // Blocked until 2FA is set up; the profile loads afterwards.
      if (data.session && !data.mfaSetupRequired) await loadProfile(data.session.user.id);
      setLoading(false);
    });

    const { data: sub } = api.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        const { data } = await api.auth.getSession();
        setMfaSetupRequired(data.mfaSetupRequired);
        if (!data.mfaSetupRequired) await loadProfile(newSession.user.id);
      } else {
        setUser(null);
        setMfaSetupRequired(false);
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
      mfaSetupRequired,
      refreshSession: async () => {
        const { data } = await api.auth.getSession();
        setMfaSetupRequired(data.mfaSetupRequired);
        if (data.session && !data.mfaSetupRequired) await loadProfile(data.session.user.id);
      },
      signIn: async (email, password) => {
        const { data, error } = await api.auth.signInWithPassword({ email, password });
        return { error, mfa: data.mfa };
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
    [session, user, loading, mfaSetupRequired],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
