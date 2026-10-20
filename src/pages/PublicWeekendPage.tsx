import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BedDouble, Hourglass, LinkIcon, Lock, LogIn, RefreshCw, Tent, UserRound, type LucideIcon } from 'lucide-react';
import { dayCount, nightCount, type NightRange } from '@shared/weekendNights';
import { AppLogo } from '@/components/AppLogo';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { LegalFooter } from '@/components/LegalLinks';
import { PageSpinner } from '@/components/Spinner';
import { Toast, useToast } from '@/components/Toast';
import { WeekendNightPicker } from '@/components/WeekendNightPicker';
import { RoomGrid } from '@/components/WeekendRoomGrid';
import { PersonDialog } from '@/pages/WeekendRoomsPage';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import { config } from '@/lib/config';
import { useI18n } from '@/lib/i18n';
import { loadGuestKey, saveGuestKey, weekendDates, type RoomPerson, type RoomsStatus, type RoomsView } from '@/lib/weekends';

interface LinkWeekend {
  id: string;
  project_id: string;
  title: string;
  starts_on: string | null;
  ends_on: string | null;
  location: string;
  days: number | null;
  rooms_status: RoomsStatus;
}

type LinkInfo =
  | { state: 'invalid' }
  | {
      state: 'ok';
      weekend: LinkWeekend;
      project: { name: string; image_url: string | null };
      account: { name: string; listed: boolean; pending: boolean } | null;
      guest: { name: string; pending: boolean } | null;
    };

type JoinResult =
  | { state: 'ok' | 'pending'; project_id: string; weekend_id: string; guest_key?: string }
  | { state: 'needs_nights' }
  | { state: 'account_required' };

// The shared link to a weekend's room choice ("/zimmer/:token"): continue
// with an account (signing in first if needed) or as a guest by name. Only
// people on the weekend's list choose a room: whoever is found goes on (days
// are asked for when the list has no booked period); whoever isn't is put on
// the list as unresolved and waits here until the managers assign them.
// Guests choose right here; their key stays in this browser to come back.
export const PublicWeekendPage = () => {
  const { t, lang } = useI18n();
  const { token = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [step, setStep] = useState<'start' | 'guest' | 'nights'>('start');
  // The guest form asks for days only when the list doesn't know them.
  const [askNights, setAskNights] = useState(false);
  const [guestKey, setGuestKey] = useState<string | null>(() => loadGuestKey(token));
  const [name, setName] = useState('');
  const [nights, setNights] = useState<NightRange>([0, 0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await api.rpc('weekend_link_info', { p_token: token, p_guest_key: loadGuestKey(token) });
    const next = (data as LinkInfo | null) ?? { state: 'invalid' };
    setInfo(next);
    if (next.state === 'ok') {
      setNights([0, nightCount(next.weekend) - 1]);
      // A key this weekend doesn't know (anymore) is dropped.
      if (!next.guest && loadGuestKey(token)) {
        saveGuestKey(token, null);
        setGuestKey(null);
      }
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load, user?.id]);

  if (!info) return <PageSpinner />;

  const shell = (title: string | null, body: ReactNode) => (
    <main className="min-h-full">
      <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-5 sm:px-6 sm:pt-8">
        <header className="mb-6 flex items-center justify-center gap-2 text-sm font-semibold text-text-secondary">
          <AppLogo className="h-6 w-6" />
          {config.appName}
        </header>
        {title && info.state === 'ok' && (
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-surface-muted text-chart-3">
              <Tent size={22} />
            </span>
            <div className="min-w-0">
              <h1 className="break-words text-2xl font-bold leading-tight tracking-tight">{title}</h1>
              <p className="mt-0.5 text-sm text-text-secondary">
                {[info.project.name, weekendDates(info.weekend, lang), info.weekend.location].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
        )}
        {body}
        <LegalFooter className="mt-10" />
      </div>
    </main>
  );

  if (info.state === 'invalid') {
    return shell(null, <Notice icon={LinkIcon} title={t('weekendLinkInvalid')} text={t('weekendLinkInvalidHint')} />);
  }

  const { weekend } = info;
  const inApp = `/projects/${weekend.project_id}/weekend/${weekend.id}/rooms`;

  const waiting = (onLeave?: () => void) =>
    shell(
      weekend.title,
      <Notice icon={Hourglass} title={t('weekendLinkPending')} text={t('weekendLinkPendingHint')}>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="secondary" onClick={() => void load()}>
            <RefreshCw size={16} />
            {t('weekendLinkCheckAgain')}
          </Button>
          {onLeave && (
            <Button variant="secondary" onClick={onLeave}>
              {t('weekendLinkNotYou')}
            </Button>
          )}
        </div>
      </Notice>,
    );
  const forgetGuest = () => {
    saveGuestKey(token, null);
    setGuestKey(null);
    void load();
  };

  if (guestKey && info.guest?.pending) return waiting(forgetGuest);
  if (user && info.account?.pending) return waiting();

  if (guestKey && info.guest) {
    return shell(
      weekend.title,
      <GuestRooms
        weekendId={weekend.id}
        guestKey={guestKey}
        name={info.guest.name}
        onLeave={forgetGuest}
      />,
    );
  }

  if (weekend.rooms_status === 'hidden') {
    return shell(weekend.title, <Notice icon={Lock} title={t('weekendLinkNotOpen')} text={t('weekendLinkNotOpenHint')} />);
  }

  const join = async (mode: 'account' | 'guest', withNights: boolean) => {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await api.rpc('weekend_link_join', {
      p_token: token,
      p_mode: mode,
      p_name: mode === 'guest' ? name.trim() : null,
      p_night_from: withNights ? nights[0] : null,
      p_night_to: withNights ? nights[1] : null,
    });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    const result = data as JoinResult;
    if (result.state === 'needs_nights') {
      if (mode === 'guest') return setAskNights(true);
      return setStep('nights');
    }
    if (result.state === 'account_required') return setError(t('weekendLinkUseAccount'));
    track('weekend-link-join', { mode, result: result.state });
    if (result.guest_key) {
      saveGuestKey(token, result.guest_key);
      setGuestKey(result.guest_key);
    }
    if (result.state === 'ok' && !result.guest_key) return navigate(inApp);
    await load();
  };

  const hasNights = dayCount(weekend) > 1;
  // New people join only while the rooms are open.
  const open = weekend.rooms_status === 'open';

  if (step === 'guest' || step === 'nights') {
    const guest = step === 'guest';
    const submit = (e: FormEvent) => {
      e.preventDefault();
      void join(guest ? 'guest' : 'account', !guest || askNights);
    };
    return shell(
      weekend.title,
      <form onSubmit={submit} className="space-y-5 rounded-2xl border border-border bg-surface p-4 sm:p-6">
        <button
          type="button"
          onClick={() => {
            setStep('start');
            setAskNights(false);
            setError(null);
          }}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text">
          <ArrowLeft size={15} />
          {t('back')}
        </button>
        <div>
          <h2 className="text-lg font-semibold">{guest ? t('weekendLinkGuestTitle') : t('weekendLinkNightsTitle')}</h2>
          <p className="mt-0.5 text-sm text-text-secondary">{guest ? t('weekendLinkGuestHint') : t('weekendLinkNightsHint')}</p>
        </div>
        {guest && (
          <Input
            label={t('name')}
            value={name}
            maxLength={200}
            required
            autoFocus
            autoComplete="name"
            onChange={(e) => {
              setName(e.target.value);
              // Another name may be found with its period.
              setAskNights(false);
            }}
          />
        )}
        {hasNights && (!guest || askNights) && (
          <div>
            <p className="mb-1.5 text-sm font-medium">{t('weekendLinkDays')}</p>
            {guest && <p className="mb-2 text-xs text-text-tertiary">{t('weekendLinkDaysNeeded')}</p>}
            <WeekendNightPicker weekend={weekend} value={nights} onChange={setNights} />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy || (guest && !name.trim())}>
          <BedDouble size={16} />
          {guest && !askNights && hasNights ? t('weekendLinkContinue') : t('weekendLinkToRooms')}
        </Button>
      </form>,
    );
  }

  return shell(
    weekend.title,
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">{t('weekendLinkIntro')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice
          icon={UserRound}
          title={user ? t('weekendLinkAsAccount').replace('{name}', info.account?.name ?? '') : t('weekendLinkWithAccount')}
          text={t('weekendLinkWithAccountHint')}
        >
          {user ? (
            <Button
              className="w-full"
              disabled={busy || (!open && !info.account?.listed)}
              onClick={() => (info.account?.listed ? navigate(inApp) : void join('account', false))}
            >
              {t('weekendLinkContinue')}
            </Button>
          ) : (
            <Link to="/login" state={{ from: location.pathname }} className="block">
              <Button className="w-full">
                <LogIn size={16} />
                {t('signIn')}
              </Button>
            </Link>
          )}
        </Choice>
        <Choice icon={Tent} title={t('weekendLinkAsGuest')} text={t('weekendLinkAsGuestHint')}>
          <Button variant="secondary" className="w-full" disabled={!open} onClick={() => setStep('guest')}>
            {t('weekendLinkContinue')}
          </Button>
        </Choice>
      </div>
      {!open && <p className="rounded-xl bg-info-soft px-3 py-2 text-sm">{t('weekendLinkLocked')}</p>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>,
  );
};

// A guest's room choice on the link: the rooms as participants see them,
// with the guest's key instead of an account.
const GuestRooms = ({ weekendId, guestKey, name, onLeave }: { weekendId: string; guestKey: string; name: string; onLeave: () => void }) => {
  const { t } = useI18n();
  const [view, setView] = useState<RoomsView | null | undefined>(undefined);
  const [person, setPerson] = useState<RoomPerson | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const access = useMemo(() => ({ p_guest_key: guestKey }), [guestKey]);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await api.rpc('weekend_rooms_view', access);
    setView(rpcError ? null : (data as RoomsView));
  }, [access]);
  useEffect(() => {
    void load();
  }, [load]);

  if (view === undefined) return <PageSpinner />;
  if (view === null) return <Notice icon={Lock} title={t('weekendLinkNotOpen')} text={t('weekendLinkNotOpenHint')} />;

  const choose = async (roomId: string | null) => {
    setBusy(true);
    setError(null);
    const previous = view.me?.room_id ?? null;
    const { data, error: rpcError } = await api.rpc('weekend_choose_room', { ...access, p_room_id: roomId });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    if ((data as { state: string }).state === 'full') {
      setError(t('roomFullNow'));
      return load();
    }
    await load();
    toast.show(roomId ? t('roomChosen') : t('roomLeft'), () =>
      void api.rpc('weekend_choose_room', { ...access, p_room_id: previous }).then(load),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-surface px-4 py-3 text-sm">
        <span className="min-w-0 truncate">{t('weekendLinkYouAre').replace('{name}', name)}</span>
        <button type="button" onClick={onLeave} className="text-xs text-text-secondary underline hover:text-text">
          {t('weekendLinkNotYou')}
        </button>
      </div>
      {!view.can_choose && <p className="rounded-xl bg-info-soft px-3 py-2 text-sm">{t('roomsFrozen')}</p>}
      {view.can_choose && !view.me?.room_id && view.rooms.length > 0 && (
        <p className="rounded-xl border border-accent/50 bg-accent/10 px-3 py-2 text-sm">{t('roomPickHint')}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <RoomGrid view={view} busy={busy} onChoose={(roomId) => void choose(roomId)} onPerson={setPerson} />
      <p className="text-xs text-text-tertiary">{t('weekendLinkGuestKeyHint')}</p>
      <PersonDialog weekendId={weekendId} person={person} onClose={() => setPerson(null)} access={access} />
      <Toast toast={toast.toast} onClose={toast.hide} />
    </div>
  );
};

const Choice = ({ icon: Icon, title, text, children }: { icon: LucideIcon; title: string; text: string; children: ReactNode }) => (
  <div className="flex flex-col rounded-2xl border border-border bg-surface p-4">
    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-muted text-text-secondary">
      <Icon size={18} />
    </span>
    <p className="mt-3 font-semibold">{title}</p>
    <p className="mb-4 mt-0.5 flex-1 text-sm text-text-secondary">{text}</p>
    {children}
  </div>
);

const Notice = ({ icon: Icon, title, text, children }: { icon: LucideIcon; title: string; text: string; children?: ReactNode }) => (
  <div className="flex flex-col items-center rounded-2xl border border-dashed border-border-strong px-6 py-12 text-center">
    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
      <Icon size={22} />
    </span>
    <p className="mt-3 font-semibold">{title}</p>
    <p className="mt-1 max-w-sm text-sm text-text-secondary">{text}</p>
    {children}
  </div>
);
