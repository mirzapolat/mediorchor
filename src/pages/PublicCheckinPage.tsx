import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, LockKeyhole, LogIn, UserRound } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input, Select } from '@/components/Input';
import { PageSpinner } from '@/components/Spinner';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { AppLogo } from '@/components/AppLogo';

type PublicCheckinInfo =
  | { state: 'invalid' }
  | { state: 'stopped'; event_name?: string; project_name?: string }
  | {
      state: 'active';
      event_name: string;
      project_name: string;
      groups: string[];
      allow_guest_checkin: boolean;
      allow_account_checkin: boolean;
      logged_in: boolean;
      me: {
        first_name: string;
        last_name: string;
        group_name: string | null;
        participating: boolean;
      } | null;
    };

type SubmitResult = {
  state: 'success' | 'invalid' | 'stopped' | 'invalid_input' | 'not_allowed';
  recognized?: boolean;
};

export const PublicCheckinPage = () => {
  const { token = '' } = useParams();
  const { t } = useI18n();
  const location = useLocation();
  const { session, user } = useAuth();
  const [info, setInfo] = useState<PublicCheckinInfo | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [groupName, setGroupName] = useState('');
  // With an account and account check-in enabled, the account flow is the
  // default; guests can still switch to the plain form when allowed.
  const [asGuest, setAsGuest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.rpc('get_public_checkin', { p_token: token }).then(({ data, error: rpcError }) => {
      if (cancelled) return;
      setInfo(rpcError ? { state: 'invalid' } : (data as PublicCheckinInfo));
    });
    return () => {
      cancelled = true;
    };
    // Reload once the session is known so `me` / logged_in reflect it.
  }, [token, session?.user.id]);

  const active = info?.state === 'active' ? info : null;
  const accountMode = Boolean(
    active && active.logged_in && active.allow_account_checkin && !asGuest,
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const { data, error: rpcError } = await api.rpc('submit_public_checkin', {
      p_token: token,
      p_first_name: accountMode && active?.me ? active.me.first_name : firstName,
      p_last_name: accountMode && active?.me ? active.me.last_name : lastName,
      p_group_name:
        accountMode && active?.me ? (active.me.group_name ?? '') : groupName,
      p_as_account: accountMode,
    });
    setSubmitting(false);

    if (rpcError) {
      setError(t('checkInSubmitError'));
      return;
    }

    const result = data as SubmitResult;
    if (result.state === 'success') {
      setSubmitted(true);
    } else if (result.state === 'stopped') {
      setInfo({
        state: 'stopped',
        event_name: info && 'event_name' in info ? info.event_name : undefined,
      });
    } else if (result.state === 'invalid') {
      setInfo({ state: 'invalid' });
    } else if (result.state === 'not_allowed') {
      setError(t('checkInNotAllowed'));
    } else {
      setError(t('checkInSubmitError'));
    }
  };

  if (!info) return <PageSpinner />;

  // Prefill the guest form when the account already knows a name.
  const guestFormDisabled = Boolean(active && !active.allow_guest_checkin && !accountMode);

  return (
    <main className="min-h-full px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-xl">
        {active ? (
          <>
            <header className="mb-8 text-center">
              <AppLogo className="mx-auto mb-5 h-12 w-12 sm:h-14 sm:w-14" />
              <h1 className="text-2xl font-bold sm:text-3xl">{t('checkInFormTitle')}</h1>
              <p className="mt-2 text-text-secondary">{active.event_name}</p>
              <p className="mt-0.5 text-sm text-text-tertiary">{active.project_name}</p>
            </header>

            <Card className="p-5 sm:p-7">
              {submitted ? (
                <div className="py-7 text-center" role="status">
                  <CheckCircle2 size={42} className="mx-auto text-success" />
                  <h2 className="mt-4 text-lg font-semibold">{t('checkInSuccess')}</h2>
                </div>
              ) : accountMode && active.me ? (
                // Known member linked to this account: one-tap check-in.
                <form onSubmit={submit} className="space-y-4">
                  <div className="flex items-center gap-3 rounded-md border border-border px-4 py-3">
                    <UserRound size={20} className="text-text-secondary" />
                    <div>
                      <p className="font-medium">
                        {active.me.first_name} {active.me.last_name}
                      </p>
                      {active.me.group_name ? (
                        <p className="text-sm text-text-secondary">{active.me.group_name}</p>
                      ) : null}
                    </div>
                  </div>
                  {error ? (
                    <p className="text-sm text-danger-strong" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? t('loading') : t('submitCheckIn')}
                  </Button>
                  {active.allow_guest_checkin ? (
                    <button
                      type="button"
                      onClick={() => setAsGuest(true)}
                      className="w-full text-sm text-text-secondary hover:text-text underline"
                    >
                      {t('checkInAsGuestInstead')}
                    </button>
                  ) : null}
                </form>
              ) : guestFormDisabled ? (
                <div className="py-7 text-center">
                  <LockKeyhole size={38} className="mx-auto text-text-secondary" />
                  <h2 className="mt-4 text-lg font-semibold">{t('guestCheckInDisabled')}</h2>
                  {active.allow_account_checkin && !active.logged_in ? (
                    <Link
                      to="/login"
                      state={{ from: location.pathname }}
                      className="mt-4 inline-flex items-center gap-2 text-sm font-medium underline"
                    >
                      <LogIn size={15} />
                      {t('signInToCheckIn')}
                    </Link>
                  ) : null}
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-4">
                  {accountMode && !active.me ? (
                    // Logged in but not yet part of this project: checking in
                    // joins it with the entered details.
                    <p className="rounded-md bg-surface-subtle px-3 py-2.5 text-sm text-text-secondary">
                      {t('accountCheckInJoinHint')}
                    </p>
                  ) : null}
                  <Input
                    id="first-name"
                    label={t('firstName')}
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    autoComplete="given-name"
                    maxLength={120}
                    required
                    autoFocus
                  />
                  <Input
                    id="last-name"
                    label={t('lastName')}
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    autoComplete="family-name"
                    maxLength={120}
                    required
                  />
                  <Select
                    id="group-name"
                    label={t('group')}
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    required
                    disabled={active.groups.length === 0}
                  >
                    <option value="">{t('selectGroup')}</option>
                    {active.groups.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </Select>
                  {active.groups.length === 0 ? (
                    <p className="text-sm text-text-secondary">{t('noGroupsAvailable')}</p>
                  ) : null}
                  {error ? (
                    <p className="text-sm text-danger-strong" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={submitting || active.groups.length === 0}
                  >
                    {submitting ? t('loading') : t('submitCheckIn')}
                  </Button>
                  {active.allow_account_checkin && !active.logged_in ? (
                    <p className="text-center text-sm text-text-secondary">
                      <Link
                        to="/login"
                        state={{ from: location.pathname }}
                        className="inline-flex items-center gap-1.5 font-medium underline"
                      >
                        <LogIn size={14} />
                        {t('signInToCheckIn')}
                      </Link>
                    </p>
                  ) : null}
                  {asGuest && user ? (
                    <button
                      type="button"
                      onClick={() => setAsGuest(false)}
                      className="w-full text-sm text-text-secondary hover:text-text underline"
                    >
                      {t('checkInWithAccountInstead')}
                    </button>
                  ) : null}
                </form>
              )}
            </Card>
          </>
        ) : (
          <Card className="p-8 text-center">
            <LockKeyhole size={38} className="mx-auto text-text-secondary" />
            {'event_name' in info && info.event_name ? (
              <p className="mt-5 font-semibold">{info.event_name}</p>
            ) : null}
            <h1 className="mt-2 text-lg font-semibold">
              {info.state === 'stopped' ? t('checkInUnavailable') : t('checkInInvalid')}
            </h1>
          </Card>
        )}
      </div>
    </main>
  );
};
