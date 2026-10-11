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
import { hasRole, permissionsFor, type Permissions } from '@/lib/roles';

// The permission flags come from the account's role (src/lib/roles.ts).
interface AuthContextValue extends Permissions {
  session: Session | null;
  user: AppUser | null;
  loading: boolean;
  // A participant who takes part in exactly one project: the app is just that
  // project (no dashboard or project list), plus the account settings.
  soleProjectId: string | null;
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
  const [soleProjectId, setSoleProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false);

  const loadProfile = async (uid: string) => {
    // Attach any member rows whose (verified) email matches this account so
    // past guest check-ins/sign-ups connect to the account. Idempotent.
    await api.rpc('claim_my_memberships');
    const { data } = await api.from('app_users').select('*').eq('id', uid).maybeSingle();
    const profile = (data as AppUser) ?? null;
    // Participants only see the projects they take part in. The admin can
    // turn the single-project view off (app_settings.single_project_focus).
    let sole: string | null = null;
    if (profile && !hasRole(profile.role, 'section_lead')) {
      const [{ data: settings }, { data: projects }] = await Promise.all([
        api.from('app_settings').select('single_project_focus').eq('id', 1).maybeSingle(),
        api.from('projects').select('id'),
      ]);
      const list = (projects as { id: string }[] | null) ?? [];
      const focus = (settings as { single_project_focus?: boolean } | null)?.single_project_focus ?? true;
      if (focus && list.length === 1) sole = list[0].id;
    }
    setSoleProjectId(sole);
    setUser(profile);
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
      if (newSession) {
        // The profile loads before the session is published, so pages never
        // render signed in without it (the dashboard layout, the start page).
        const { data } = await api.auth.getSession();
        setMfaSetupRequired(data.mfaSetupRequired);
        if (!data.mfaSetupRequired) await loadProfile(newSession.user.id);
        setSession(newSession);
      } else {
        setSession(null);
        setUser(null);
        setSoleProjectId(null);
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
      soleProjectId,
      ...permissionsFor(user?.role),
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
        setSoleProjectId(null);
        setSession(null);
      },
      refreshUser: async () => {
        if (session) await loadProfile(session.user.id);
      },
    }),
    [session, user, loading, soleProjectId, mfaSetupRequired],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
