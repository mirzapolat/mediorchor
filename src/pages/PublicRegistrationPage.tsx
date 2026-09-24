import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Check, CheckCircle2, LockKeyhole, LogIn, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Avatar } from '@/components/Avatar';
import { PageSpinner } from '@/components/Spinner';
import { AppLogo } from '@/components/AppLogo';
import { Markdown } from '@/lib/markdown';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { config } from '@/lib/config';
import { channels } from '@/lib/branding';
import { isHexColor } from '@/lib/groupColors';
import { cn } from '@/lib/cn';
import { LegalFooter, LegalLink } from '@/components/LegalLinks';
import { useLegalPages } from '@/lib/legalPages';
import { formatDeadlineParts, timeLeft } from '@/lib/registrationDeadline';

type RegistrationInfo =
  | { state: 'invalid' }
  | { state: 'inactive'; title?: string; project_name?: string; header?: string | null; tint?: string | null }
  | {
      state: 'closed';
      title?: string;
      project_name?: string;
      project_image?: string | null;
      cover_url?: string | null;
      closes_at?: string | null;
      header?: string | null;
      tint?: string | null;
    }
  | {
      state: 'active';
      title: string;
      description: string;
      ask_email: boolean;
      ask_group: boolean;
      // The project requires a group (Project settings → sign-up rules);
      // otherwise the group is optional.
      require_group: boolean;
      groups: string[];
      project_name: string;
      project_image: string | null;
      cover_url: string | null;
      closes_at: string | null;
      // Text next to the app logo at the top; null = no header.
      header: string | null;
      // Background tint (#rrggbb); null = accent color.
      tint: string | null;
      allow_guest_signup: boolean;
      allow_account_signup: boolean;
      logged_in: boolean;
      me: { name: string; email: string; photo_url: string | null; participating: boolean } | null;
    };

type SubmitResult = {
  state: 'success' | 'invalid' | 'inactive' | 'closed' | 'invalid_input' | 'not_allowed';
  closes_at?: string | null;
};

// 1 = welcome, 2 = details, 3 = review, 4 = done.
type Step = 1 | 2 | 3 | 4;

// Public sign-up page of a registration form. Laid out like an event page
// (cover + title + key facts on the left/top, the registration card next to
// it), in the app's own tokens so it follows branding and dark mode.
export const PublicRegistrationPage = () => {
  const { token = '' } = useParams();
  const { t, lang } = useI18n();
  const legal = useLegalPages();
  const location = useLocation();
  const { session } = useAuth();
  const [info, setInfo] = useState<RegistrationInfo | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [groupName, setGroupName] = useState('');
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  // Logged-in visitors may opt out of the account flow and register as guest.
  const [asGuest, setAsGuest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.rpc('get_public_registration', { p_token: token }).then(({ data, error: rpcError }) => {
      if (cancelled) return;
      const next = rpcError ? ({ state: 'invalid' } as RegistrationInfo) : (data as RegistrationInfo);
      setInfo(next);
      // Prefill from the account when signing up while logged in.
      if (next.state === 'active' && next.me) {
        const name = next.me.name.trim();
        const lastSpace = name.lastIndexOf(' ');
        setFirstName((v) => v || (lastSpace > 0 ? name.slice(0, lastSpace) : name));
        setLastName((v) => v || (lastSpace > 0 ? name.slice(lastSpace + 1) : ''));
        setEmail((v) => v || next.me!.email);
      }
    });
    return () => {
      cancelled = true;
    };
    // Reload once the session is known so `me` / logged_in reflect it.
  }, [token, session?.user.id]);

  const active = info?.state === 'active' ? info : null;
  // Logged-in visitors register with their account when the project allows it.
  const accountMode = Boolean(active && active.logged_in && active.allow_account_signup && !asGuest);
  const guestBlocked = Boolean(active && !active.allow_guest_signup && !accountMode);

  // The page stays open in a tab: close the form when the deadline passes
  // (the server refuses late submissions either way).
  useEffect(() => {
    if (!active?.closes_at || step === 4) return;
    const ms = Date.parse(active.closes_at) - Date.now();
    if (ms > 2 ** 31 - 1) return;
    const close = () =>
      setInfo({
        state: 'closed',
        title: active.title,
        project_name: active.project_name,
        project_image: active.project_image,
        cover_url: active.cover_url,
        closes_at: active.closes_at,
        header: active.header,
        tint: active.tint,
      });
    if (!(ms > 0)) {
      close();
      return;
    }
    const timer = window.setTimeout(close, ms);
    return () => window.clearTimeout(timer);
  }, [active, step]);

  const dataValid = useMemo(() => {
    if (!active) return false;
    if (!firstName.trim() || !lastName.trim()) return false;
    if (active.ask_email && !accountMode && !email.trim()) return false;
    if (active.require_group && !groupName.trim()) return false;
    return true;
  }, [active, accountMode, firstName, lastName, email, groupName]);

  const submit = async () => {
    setSubmitting(true);
    setError('');
    const { data, error: rpcError } = await api.rpc('submit_public_registration', {
      p_token: token,
      p_first_name: firstName,
      p_last_name: lastName,
      p_email: email,
      p_group_name: groupName,
      p_as_account: accountMode,
    });
    setSubmitting(false);

    if (rpcError) {
      setError(t('registrationSubmitError'));
      return;
    }
    const result = data as SubmitResult;
    if (result.state === 'success') {
      setStep(4);
    } else if (result.state === 'inactive') {
      setInfo({
        state: 'inactive',
        title: active?.title,
        project_name: active?.project_name,
        header: active?.header,
        tint: active?.tint,
      });
    } else if (result.state === 'closed') {
      setInfo({
        state: 'closed',
        title: active?.title,
        project_name: active?.project_name,
        project_image: active?.project_image,
        cover_url: active?.cover_url,
        closes_at: result.closes_at ?? active?.closes_at,
        header: active?.header,
        tint: active?.tint,
      });
    } else if (result.state === 'invalid') {
      setInfo({ state: 'invalid' });
    } else if (result.state === 'not_allowed') {
      setError(t('registrationNotAllowed'));
    } else {
      setError(t('registrationSubmitError'));
    }
  };

  if (!info) return <PageSpinner />;

  // Unknown link: nothing to show about the page itself.
  if (info.state === 'invalid' || ((info.state === 'inactive' || info.state === 'closed') && !info.title)) {
    return (
      <Shell>
        <div className="mx-auto max-w-md">
          <RegistrationCard label={t('registrationCardTitle')}>
            <Notice
              icon={LockKeyhole}
              title={info.state === 'invalid' ? t('registrationInvalid') : t('registrationUnavailable')}
            />
          </RegistrationCard>
        </div>
      </Shell>
    );
  }

  const title = active?.title ?? ('title' in info ? info.title! : '');
  const projectName = active?.project_name ?? ('project_name' in info ? (info.project_name ?? '') : '');
  const closedInfo = info.state === 'closed' ? info : null;
  const projectImage = active?.project_image ?? closedInfo?.project_image ?? null;
  const coverUrl = active?.cover_url ?? closedInfo?.cover_url ?? null;
  const closesAt = active?.closes_at ?? (info.state === 'closed' ? (info.closes_at ?? null) : null);
  const signInLink =
    active && !active.logged_in && active.allow_account_signup ? (
      <Link
        to="/login"
        state={{ from: location.pathname }}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary underline-offset-4 transition-colors hover:text-text hover:underline"
      >
        <LogIn size={14} />
        {t('signInToRegister')}
      </Link>
    ) : null;

  let card: ReactNode;
  if (info.state === 'closed') {
    // The deadline itself is shown next to the calendar tile above.
    card = <Notice icon={LockKeyhole} title={t('registrationClosedTitle')} text={t('registrationClosedHint')} />;
  } else if (info.state === 'inactive') {
    card = <Notice icon={LockKeyhole} title={t('registrationUnavailable')} />;
  } else if (active && guestBlocked) {
    card = (
      <div className="space-y-4">
        <Notice icon={LockKeyhole} title={t('guestSignupDisabled')} />
        {active.allow_account_signup ? <p className="text-center">{signInLink}</p> : null}
      </div>
    );
  } else if (active && step === 1) {
    card = (
      <div className="space-y-4">
        <p className="text-text-secondary">{t('registrationWelcome')}</p>
        {accountMode && active.me ? (
          <div className="flex items-center gap-3">
            <Avatar name={active.me.name || active.me.email} photoUrl={active.me.photo_url} size={36} />
            <div className="min-w-0">
              <p className="truncate font-medium">{active.me.name || active.me.email}</p>
              <p className="truncate text-sm text-text-secondary">{active.me.email}</p>
            </div>
          </div>
        ) : null}
        <Button className="h-11 w-full text-base" onClick={() => setStep(2)}>
          {accountMode ? t('registerWithAccount') : t('registerNow')}
        </Button>
        {signInLink ? <p className="text-center">{signInLink}</p> : null}
        {accountMode && active.allow_guest_signup ? (
          <button
            type="button"
            onClick={() => setAsGuest(true)}
            className="w-full text-sm text-text-secondary underline-offset-4 hover:text-text hover:underline"
          >
            {t('continueAsGuestInstead')}
          </button>
        ) : null}
        {asGuest && active.logged_in && active.allow_account_signup ? (
          <button
            type="button"
            onClick={() => setAsGuest(false)}
            className="w-full text-sm text-text-secondary underline-offset-4 hover:text-text hover:underline"
          >
            {t('continueWithAccountInstead')}
          </button>
        ) : null}
      </div>
    );
  } else if (active && step === 2) {
    card = (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (dataValid) setStep(3);
        }}
        className="space-y-4"
      >
        {accountMode ? (
          <p className="rounded-lg bg-surface-subtle px-3 py-2.5 text-sm text-text-secondary">
            {t('dataFromAccountHint')}
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label={t('firstName')}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            maxLength={120}
            required
            autoFocus={!accountMode}
            // Account sign-ups use the account's data; only the group is
            // chosen per project.
            disabled={accountMode}
          />
          <Input
            label={t('lastName')}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
            maxLength={120}
            required
            disabled={accountMode}
          />
        </div>
        {active.ask_email || accountMode ? (
          <Input
            type="email"
            label={t('email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            maxLength={200}
            required
            // The account's address is authoritative for account sign-ups.
            disabled={accountMode}
          />
        ) : null}
        {active.ask_group ? (
          <Select
            label={active.require_group ? t('group') : `${t('group')} (${t('optional')})`}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            required={active.require_group}
            disabled={active.groups.length === 0}
          >
            <option value="">{active.require_group ? t('selectGroup') : t('noGroupChoice')}</option>
            {active.groups.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </Select>
        ) : null}
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" className="h-11 flex-1" onClick={() => setStep(1)}>
            {t('back')}
          </Button>
          <Button type="submit" className="h-11 flex-1" disabled={!dataValid}>
            {t('next')}
          </Button>
        </div>
      </form>
    );
  } else if (active && step === 3) {
    const rows: [string, string][] = [
      [t('firstName'), firstName],
      [t('lastName'), lastName],
      ...(active.ask_email || accountMode ? [[t('email'), email || '—'] as [string, string]] : []),
      ...(active.ask_group ? [[t('group'), groupName || '—'] as [string, string]] : []),
    ];
    card = (
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">{t('reviewHint')}</p>
        <dl className="divide-y divide-border rounded-lg border border-border text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 px-3.5 py-2.5">
              <dt className="text-text-secondary">{label}</dt>
              <dd className="min-w-0 truncate font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs leading-relaxed text-text-tertiary">
          {t('privacyNotice')}
          {legal && legal.privacy.mode !== 'none' ? (
            <>
              {' '}
              {t('privacyReadMore')}{' '}
              <LegalLink kind="privacy" className="underline underline-offset-2 hover:text-text-secondary" />.
            </>
          ) : null}
        </p>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={acceptPrivacy}
            onChange={(e) => setAcceptPrivacy(e.target.checked)}
            className="mt-0.5 accent-black"
          />
          <span>{t('acceptPrivacy')}</span>
        </label>
        {error ? (
          <p className="text-sm text-danger-strong" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" className="h-11 flex-1" onClick={() => setStep(2)}>
            {t('back')}
          </Button>
          <Button type="button" className="h-11 flex-1" disabled={!acceptPrivacy || submitting} onClick={submit}>
            {submitting ? t('loading') : t('submitRegistration')}
          </Button>
        </div>
      </div>
    );
  } else {
    card = (
      <div className="py-4 text-center" role="status">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success-strong">
          <Check size={28} strokeWidth={2.5} />
        </span>
        <h2 className="mt-4 text-lg font-semibold">{t('registrationDoneTitle')}</h2>
        <p className="mt-1 text-sm text-text-secondary">{t('registrationSuccess')}</p>
      </div>
    );
  }

  const cardLabel =
    active && step === 2
      ? t('enterYourData')
      : active && step === 3
        ? t('reviewYourData')
        : t('registrationCardTitle');
  const showSteps = Boolean(active && !guestBlocked && (step === 2 || step === 3));
  const left = closesAt && info.state === 'active' ? timeLeft(closesAt, lang) : null;

  return (
    <Shell header={'header' in info ? info.header : undefined} tint={'tint' in info ? info.tint : null}>
      {/* With a cover: cover left, content right (stacked on phones). Without
          one: a single centered column. */}
      <div
        className={cn(
          coverUrl
            ? 'grid gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-10 lg:gap-14'
            : 'mx-auto max-w-2xl',
        )}
      >
        {coverUrl ? (
          <aside className="md:sticky md:top-8 md:self-start">
            <img
              src={coverUrl}
              alt=""
              className="mx-auto aspect-square w-full max-w-md rounded-2xl border border-border object-cover shadow-lg md:max-w-none"
            />
          </aside>
        ) : null}

        <div className="min-w-0 space-y-7">
          <div className="space-y-5">
            {left ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-tint/15 px-2.5 py-1 text-xs font-semibold text-text">
                <span className="h-1.5 w-1.5 rounded-full bg-tint" />
                {t('registrationEndsIn').replace('{left}', left)}
              </span>
            ) : null}
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{title}</h1>
            <div className="space-y-3.5">
              {closesAt ? <DeadlineFact iso={closesAt} closed={info.state === 'closed'} /> : null}
              {projectName ? (
                <Fact
                  tile={<ProjectIcon name={projectName} image={projectImage} />}
                  title={projectName}
                  subtitle={t('projectLabel')}
                />
              ) : null}
            </div>
          </div>

          <RegistrationCard
            label={cardLabel}
            aside={
              showSteps ? (
                <StepBars step={step} />
              ) : step === 4 ? (
                <CheckCircle2 size={16} className="text-success" />
              ) : null
            }
          >
            {card}
          </RegistrationCard>

          {active?.description.trim() && step !== 4 ? (
            <section>
              <SectionLabel>{t('aboutRegistration')}</SectionLabel>
              <Markdown source={active.description} className="space-y-3 leading-relaxed text-text-secondary" />
            </section>
          ) : null}
        </div>
      </div>
    </Shell>
  );
};

// Page frame: a soft accent glow behind the content and the app mark on top.
// `header`: text next to the app logo (undefined = the app name), null = none.
// `tint`: color of the background glow (#rrggbb), null = the accent color.
const Shell = ({
  header,
  tint,
  children,
}: {
  header?: string | null;
  tint?: string | null;
  children: ReactNode;
}) => (
  <main
    className="relative min-h-full overflow-hidden"
    style={tint && isHexColor(tint) ? ({ '--c-tint': channels(tint) } as CSSProperties) : undefined}
  >
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-gradient-to-b from-tint/10 to-transparent"
    />
    <div
      aria-hidden
      className="pointer-events-none absolute -top-48 left-1/2 h-[440px] w-[680px] -translate-x-1/2 rounded-full bg-tint/15 blur-3xl"
    />
    <div className="relative mx-auto w-full max-w-5xl px-4 pb-16 pt-5 sm:px-6 sm:pt-6">
      {header === null ? (
        <div className="h-4 sm:h-8" />
      ) : (
        <header className="mb-8 flex items-center justify-center gap-2 text-sm font-semibold text-text-secondary sm:mb-12">
          <AppLogo className="h-6 w-6" />
          {header ?? config.appName}
        </header>
      )}
      {children}
      <LegalFooter className="mt-12" />
    </div>
  </main>
);

// The project's icon as the fact tile; its initial when it has none.
const ProjectIcon = ({ name, image }: { name: string; image: string | null }) =>
  image ? (
    <img src={image} alt="" className="h-11 w-11 flex-shrink-0 rounded-lg border border-border object-cover" />
  ) : (
    <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-accent text-base font-bold text-paper">
      {name.trim().charAt(0).toUpperCase() || '·'}
    </span>
  );

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <h2 className="mb-3 border-b border-border pb-2 text-sm font-semibold text-text-secondary">{children}</h2>
);

// One key fact next to an icon tile ("Anmeldung bis …", project).
const Fact = ({
  icon: Icon,
  tile,
  title,
  subtitle,
}: {
  icon?: LucideIcon;
  tile?: ReactNode;
  title: string;
  subtitle?: string;
}) => (
  <div className="flex items-center gap-3.5">
    {tile ?? (
      <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-surface">
        {Icon ? <Icon size={19} className="text-text-secondary" /> : null}
      </span>
    )}
    <div className="min-w-0">
      <p className="truncate font-medium">{title}</p>
      {subtitle ? <p className="truncate text-sm text-text-secondary">{subtitle}</p> : null}
    </div>
  </div>
);

// Deadline as a small calendar tile (month band + day), like an event date.
const DeadlineFact = ({ iso, closed }: { iso: string; closed: boolean }) => {
  const { t, lang } = useI18n();
  const parts = formatDeadlineParts(iso, lang);
  return (
    <Fact
      tile={
        <span className="flex h-11 w-11 flex-shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface text-center">
          <span className="bg-surface-muted py-px text-[10px] font-semibold uppercase leading-4 text-text-secondary">
            {parts.month}
          </span>
          <span className="flex flex-1 items-center justify-center text-base font-semibold leading-none">
            {parts.day}
          </span>
        </span>
      }
      title={(closed ? t('registrationEndedAt') : t('registrationUntil')).replace('{date}', parts.date)}
      subtitle={t('atTime').replace('{time}', parts.time)}
    />
  );
};

const RegistrationCard = ({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: ReactNode;
  children: ReactNode;
}) => (
  <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
    <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-subtle px-5 py-3">
      <h2 className="text-sm font-semibold text-text-secondary">{label}</h2>
      {aside}
    </div>
    <div className="p-5 sm:p-6">{children}</div>
  </section>
);

const StepBars = ({ step }: { step: Step }) => (
  <span className="flex items-center gap-1" aria-hidden>
    {[1, 2, 3].map((s) => (
      <span
        key={s}
        className={cn(
          'h-1.5 rounded-full transition-all duration-200',
          s === step ? 'w-5' : 'w-1.5',
          s <= step ? 'bg-black' : 'bg-border-strong',
        )}
      />
    ))}
  </span>
);

const Notice = ({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text?: string;
}) => (
  <div className="py-3 text-center">
    <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted">
      <Icon size={22} className="text-text-secondary" />
    </span>
    <p className="mt-3 font-semibold">{title}</p>
    {text ? <p className="mt-1 text-sm text-text-secondary">{text}</p> : null}
  </div>
);
