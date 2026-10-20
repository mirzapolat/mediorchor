import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowUp, Check, ChevronDown, ImagePlus, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { AppLogo } from '@/components/AppLogo';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { PhotoCropper } from '@/components/PhotoCropper';
import { PersonPicker } from '@/components/PersonPicker';
import { MemberImportFields, MemberImportSummary, useMemberImport } from '@/components/MemberImport';
import { Checkbox } from '@/components/RegistrationPageForm';
import { DeadlineInput } from '@/components/DeadlineInput';
import { NoteFieldInput, noteLabelToSave } from '@/components/NoteFieldInput';
import { CoverInput } from '@/components/CoverInput';
import { HeaderBrandingInput } from '@/components/HeaderBrandingInput';
import { TintInput } from '@/components/TintInput';
import { ConditionRows, createCondition, toStoredConditions, withIds, type EditableCondition } from '@/components/ConditionRows';
import { ToggleCard, useConfirmationEmails, type AccessKey } from '@/pages/ProjectSettingsPage';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { config } from '@/lib/config';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { uploadImage } from '@/lib/uploadImage';
import { paletteColor } from '@/lib/groupColors';
import { fromLocalInput, toLocalInput } from '@/lib/registrationDeadline';
import { track } from '@/lib/analytics';
import type { StoredCondition } from '@/lib/absenceConditions';
import type { PersonOption, RegistrationHeaderMode } from '@/types';

// --- the draft ----------------------------------------------------------------

interface DraftGroup {
  key: string;
  name: string;
  color: string;
  responsibles: PersonOption[];
  note: string;
}

interface DraftEvent {
  key: string;
  name: string;
  description: string;
  date: string;
  time: string;
  end_time: string;
  location: string;
}

interface DraftConcert {
  key: string;
  title: string;
  date: string;
  time: string;
  location: string;
  description: string;
}

interface DraftPiece {
  key: string;
  piece_id: string | null;
  name: string;
  composer: string;
}

interface DraftMember {
  first_name: string;
  last_name: string;
  email: string | null;
  group_name: string | null;
}

interface DraftRegistration {
  title: string;
  description: string;
  ask_email: boolean;
  ask_group: boolean;
  closes_at: string | null;
  note_label: string | null;
  auto_transfer: boolean;
  active: boolean;
  cover_url: string | null;
  header_mode: RegistrationHeaderMode;
  header_text: string;
  tint_color: string | null;
}

interface Draft {
  project: { name: string; description: string; image_url: string | null };
  settings: Record<AccessKey | 'require_signup_group', boolean> & { default_group: string };
  groups: { skip: boolean; items: DraftGroup[] };
  events: DraftEvent[];
  members: DraftMember[];
  registration: DraftRegistration | null;
  concerts: DraftConcert[];
  pieces: DraftPiece[];
  audition: { conditions: StoredCondition[] };
}

const key = () => crypto.randomUUID();

const DEFAULT_GROUPS = ['Sopran 1', 'Sopran 2', 'Alt 1', 'Alt 2', 'Tenor 1', 'Tenor 2', 'Bass 1', 'Bass 2'];

const defaultGroups = (): DraftGroup[] =>
  DEFAULT_GROUPS.map((name, i) => ({ key: key(), name, color: paletteColor(i), responsibles: [], note: '' }));

const blankEvent = (): DraftEvent => ({ key: key(), name: '', description: '', date: '', time: '', end_time: '', location: '' });
const blankConcert = (): DraftConcert => ({ key: key(), title: '', date: '', time: '', location: '', description: '' });

// The project settings page's defaults for a new project (sign-ups ask for a
// group, as before).
const newDraft = (): Draft => ({
  project: { name: '', description: '', image_url: null },
  settings: {
    allow_account_access: true,
    allow_participant_pieces: true,
    show_weekend: true,
    show_concerts: true,
    show_surveys: true,
    allow_account_checkin: true,
    allow_guest_checkin: true,
    allow_account_signup: true,
    allow_guest_signup: true,
    require_signup_group: true,
    notify_registration_received: true,
    notify_checkin_confirmation: true,
    default_group: '',
  },
  groups: { skip: false, items: defaultGroups() },
  events: [blankEvent()],
  members: [],
  registration: null,
  concerts: [blankConcert()],
  pieces: [],
  audition: { conditions: [] },
});

const filled = (e: DraftEvent) => Boolean(e.name.trim() || e.description.trim() || e.date || e.time || e.end_time || e.location.trim());
const concertFilled = (c: DraftConcert) => Boolean(c.title.trim() || c.date || c.time || c.location.trim() || c.description.trim());

const SECTIONS = [
  ['project', 'onbProject'],
  ['settings', 'onbSettings'],
  ['groups', 'onbGroups'],
  ['events', 'onbEvents'],
  ['members', 'onbMembers'],
  ['registration', 'onbRegistration'],
  ['concerts', 'onbConcerts'],
  ['pieces', 'onbPieces'],
  ['audition', 'onbAudition'],
] as const satisfies readonly (readonly [string, TranslationKey])[];
type SectionId = (typeof SECTIONS)[number][0];

const sectionLabel = (id: SectionId) => SECTIONS.find(([s]) => s === id)![1];

const COUNTS: Array<[string, TranslationKey]> = [
  ['groups', 'onbCountGroups'],
  ['events', 'onbCountEvents'],
  ['members', 'onbCountMembers'],
  ['registration', 'onbCountRegistration'],
  ['concerts', 'onbCountConcerts'],
  ['pieces', 'onbCountPieces'],
  ['audition', 'onbCountAudition'],
];

// --- the page -------------------------------------------------------------------

// Setting up a new project on one calm page: nine numbered sections from top
// to bottom (only the name is needed), a jump list at the side (desktop) or
// on top (phones), the draft saved privately for this account while typing,
// and "Projekt erstellen" always at hand. Everything is created at once on
// the server — or nothing.
const Onboarding = () => {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<{ section: SectionId | null; message: string } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = useRef(false);

  // The private draft (this account only), or a fresh one.
  useEffect(() => {
    if (!user) return;
    void api
      .from('onboarding_drafts')
      .select('data')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        const stored = (data as { data: Partial<Draft> } | null)?.data;
        setDraft(stored?.project ? { ...newDraft(), ...stored } : newDraft());
      });
  }, [user]);

  useEffect(() => {
    if (!dirty.current || !draft || !user) return;
    setSaved('saving');
    const timer = window.setTimeout(async () => {
      const { error: saveError } = await api
        .from('onboarding_drafts')
        .upsert({ user_id: user.id, data: draft, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      setSaved(saveError ? 'error' : 'saved');
    }, 900);
    return () => window.clearTimeout(timer);
  }, [draft, user]);

  const update = useCallback((patch: Partial<Draft>) => {
    dirty.current = true;
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }, []);

  if (!draft) return <PageSpinner />;

  const groupNames = draft.groups.items.map((g) => g.name.trim()).filter(Boolean);
  const counts: Record<string, number> = {
    groups: groupNames.length,
    events: draft.events.filter(filled).length,
    members: draft.members.length,
    registration: draft.registration ? 1 : 0,
    concerts: draft.concerts.filter(concertFilled).length,
    pieces: draft.pieces.length,
    audition: draft.audition.conditions.length ? 1 : 0,
  };

  // Problems the page can tell before asking the server.
  const problems: { section: SectionId; message: string }[] = [];
  if (!draft.project.name.trim()) problems.push({ section: 'project', message: t('onbNeedName') });
  draft.events.forEach(
    (e, i) => filled(e) && !e.name.trim() && problems.push({ section: 'events', message: t('onbRowNeedsTitle').replace('{n}', String(i + 1)) }),
  );
  draft.concerts.forEach(
    (c, i) =>
      concertFilled(c) && !c.title.trim() && problems.push({ section: 'concerts', message: t('onbRowNeedsTitle').replace('{n}', String(i + 1)) }),
  );
  if (draft.registration && !draft.registration.title.trim()) problems.push({ section: 'registration', message: t('onbFormNeedsTitle') });
  const lowerGroups = new Set(groupNames.map((g) => g.toLowerCase()));
  if (lowerGroups.size !== groupNames.length) problems.push({ section: 'groups', message: t('onbGroupTwice') });
  if (draft.members.some((m) => m.group_name && !lowerGroups.has(m.group_name.toLowerCase()))) {
    problems.push({ section: 'members', message: t('onbMemberGroupMissing') });
  }

  const create = async () => {
    if (problems.length) return setError({ section: problems[0].section, message: problems[0].message });
    setCreating(true);
    setError(null);
    const { data, error: rpcError } = await api.rpc('onboarding_create', {
      p_draft: {
        ...draft,
        events: draft.events.filter(filled),
        concerts: draft.concerts.filter(concertFilled),
        groups: { items: draft.groups.items.map((g) => ({ ...g, responsibles: g.responsibles.map((p) => ({ id: p.id })) })) },
      },
    });
    setCreating(false);
    if (rpcError) {
      const section = (/^onboarding_([a-z]+)/.exec(rpcError.code ?? '')?.[1] ?? null) as SectionId | null;
      return setError({ section, message: rpcError.message });
    }
    const result = data as { project_id: string; summary: Record<string, number> };
    track('project-created', { via: 'onboarding' });
    navigate(`/projects/${result.project_id}`, { state: { created: result.summary } });
  };

  const discard = async () => {
    setConfirmDiscard(false);
    if (user) await api.from('onboarding_drafts').delete().eq('user_id', user.id);
    navigate('/projects');
  };

  const createButton = (
    <Button onClick={() => void create()} disabled={creating || !draft.project.name.trim()}>
      {creating ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
      {t('onbCreate')}
    </Button>
  );

  return (
    <div className="min-h-full bg-bg">
      <header className="sticky top-0 z-30 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <AppLogo className="h-5 w-5 flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate font-semibold">{draft.project.name.trim() || t('onbTitle')}</span>
          <span className="hidden text-xs text-text-tertiary sm:inline" aria-live="polite">
            {saved === 'saving' ? t('formSaving') : saved === 'saved' ? t('onbDraftSaved') : saved === 'error' ? t('saveFailed') : ''}
          </span>
          <Button variant="secondary" className="max-sm:hidden" onClick={() => setConfirmDiscard(true)}>
            {t('onbDiscard')}
          </Button>
          {createButton}
        </div>
      </header>

      <div className="mx-auto max-w-6xl gap-10 px-4 pb-24 lg:grid lg:grid-cols-[190px_minmax(0,1fr)]">
        {/* Where things are: at the side on desktop, a compact row on phones. */}
        <nav aria-label={t('onbSectionsNav')} className="lg:sticky lg:top-20 lg:self-start lg:pt-8">
          <ol className="-mx-4 flex gap-1.5 overflow-x-auto px-4 py-3 [scrollbar-width:none] lg:mx-0 lg:flex-col lg:gap-0.5 lg:p-0">
            {SECTIONS.map(([id, label], i) => (
              <li key={id} className="flex-shrink-0">
                <a
                  href={`#onb-${id}`}
                  className="flex h-9 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-sm text-text-secondary hover:bg-surface-muted hover:text-text max-lg:border max-lg:border-border max-lg:bg-surface"
                >
                  <span className="text-xs tabular-nums text-text-tertiary">{i + 1}</span>
                  {t(label)}
                </a>
              </li>
            ))}
            <li className="flex-shrink-0">
              <a
                href="#onb-summary"
                className="flex h-9 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium hover:bg-surface-muted max-lg:border max-lg:border-border max-lg:bg-surface"
              >
                <Check size={13} />
                {t('onbSummary')}
              </a>
            </li>
          </ol>
        </nav>

        <main className="min-w-0 space-y-4 pt-4 lg:pt-8">
          <p className="text-sm text-text-secondary">{t('onbIntro')}</p>
          <ProjectSection draft={draft} update={update} />
          <SettingsSection draft={draft} update={update} groupNames={groupNames} />
          <GroupsSection draft={draft} update={update} />
          <EventsSection draft={draft} update={update} />
          <MembersSection draft={draft} update={update} groupNames={groupNames} />
          <RegistrationSection draft={draft} update={update} />
          <ConcertsSection draft={draft} update={update} />
          <PiecesSection draft={draft} update={update} />
          <AuditionSection draft={draft} update={update} />

          <section id="onb-summary" className="scroll-mt-20 rounded-2xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('onbSummary')}</h2>
            <p className="mt-2 font-medium">
              {COUNTS.filter(([k]) => counts[k] > 0)
                .map(([k, label]) => t(label).replace('{n}', String(counts[k])))
                .join(' · ') || t('onbOnlyProject')}
            </p>
            {COUNTS.some(([k]) => counts[k] === 0) && (
              <p className="mt-1 text-sm text-text-tertiary">
                {t('onbLaterHint').replace(
                  '{areas}',
                  COUNTS.filter(([k]) => counts[k] === 0)
                    .map(([k]) => t(sectionLabel(k as SectionId)))
                    .join(', '),
                )}
              </p>
            )}
            {problems.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {problems.map((p, i) => (
                  <li key={i}>
                    <a href={`#onb-${p.section}`} className="inline-flex items-center gap-1.5 text-danger hover:underline">
                      <AlertTriangle size={13} />
                      {p.message}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {error && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error.section ? (
                  <a href={`#onb-${error.section}`} className="hover:underline">
                    {t('onbErrorIn').replace('{section}', t(sectionLabel(error.section)))}: {error.message}
                  </a>
                ) : (
                  `${t('onbCreateFailed')} ${error.message}`
                )}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              <p className="text-xs text-text-tertiary">{t('onbCreateHint')}</p>
              {createButton}
            </div>
          </section>
          <button type="button" onClick={() => setConfirmDiscard(true)} className="text-sm text-text-tertiary hover:text-text sm:hidden">
            {t('onbDiscard')}
          </button>
        </main>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title={t('onbDiscard')}
        message={t('onbDiscardConfirm')}
        confirmLabel={t('onbDiscard')}
        destructive
        onConfirm={() => void discard()}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  );
};

interface SectionProps {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
}

const Section = ({ id, hint, optional = true, children }: { id: SectionId; hint: TranslationKey; optional?: boolean; children: ReactNode }) => {
  const { t } = useI18n();
  const index = SECTIONS.findIndex(([s]) => s === id);
  return (
    <section id={`onb-${id}`} className="scroll-mt-20 rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-start gap-3">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold tabular-nums text-text-secondary">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 font-semibold">
            {t(SECTIONS[index][1])}
            {optional && <span className="text-xs font-normal text-text-tertiary">{t('optional')}</span>}
          </h2>
          <p className="text-sm text-text-secondary">{t(hint)}</p>
        </div>
      </div>
      {children}
    </section>
  );
};

// Small icon button of a repeating row (move, remove).
const RowButton = ({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text disabled:opacity-30 max-md:h-11 max-md:w-11"
  >
    {children}
  </button>
);

const move = <T,>(list: T[], index: number, by: number) => {
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item);
  return next;
};

const AddRow = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="mt-2 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-strong text-sm text-text-secondary hover:bg-surface-subtle hover:text-text"
  >
    <Plus size={14} />
    {label}
  </button>
);

// 1 · name, description, image — and how it will look.
const ProjectSection = ({ draft, update }: SectionProps) => {
  const { t } = useI18n();
  const [picked, setPicked] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const p = draft.project;
  const set = (patch: Partial<Draft['project']>) => update({ project: { ...p, ...patch } });
  const upload = async (file: File) => {
    setPicked(null);
    setUploading(true);
    const { url } = await uploadImage('projects/new', file);
    setUploading(false);
    if (url) set({ image_url: url });
  };
  const name = p.name.trim() || t('onbNamePlaceholder');
  return (
    <Section id="project" hint="onbProjectHint" optional={false}>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="space-y-3">
          <Input label={t('projectName')} value={p.name} maxLength={200} required autoFocus onChange={(e) => set({ name: e.target.value })} />
          <Textarea
            label={`${t('description')} (${t('optional')})`}
            rows={2}
            maxLength={2000}
            value={p.description}
            onChange={(e) => set({ description: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm text-text-secondary hover:bg-surface-muted">
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
              {t('projectImage')}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => setPicked(e.target.files?.[0] ?? null)} />
            </label>
            {p.image_url && (
              <button type="button" onClick={() => set({ image_url: null })} className="text-sm text-text-secondary underline">
                {t('remove')}
              </button>
            )}
          </div>
        </div>
        {/* The real look: the sidebar header and a project list entry. */}
        <div aria-hidden className="space-y-2 rounded-xl bg-surface-subtle p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{t('onbPreview')}</p>
          <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5">
            <Avatar name={name} photoUrl={p.image_url} size={28} square />
            <span className="truncate text-sm font-semibold">{name}</span>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-2.5">
            <Avatar name={name} photoUrl={p.image_url} size={36} square />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{name}</span>
              <span className="block truncate text-xs text-text-tertiary">{p.description.trim() || config.appName}</span>
            </span>
          </div>
        </div>
      </div>
      <PhotoCropper file={picked} shape="square" format="png" onCancel={() => setPicked(null)} onConfirm={(file) => void upload(file)} />
    </Section>
  );
};

// 2 · the settings page's switches, same words, same defaults.
const SettingsSection = ({ draft, update, groupNames }: SectionProps & { groupNames: string[] }) => {
  const { t } = useI18n();
  const emailAvailable = useConfirmationEmails();
  const s = draft.settings;
  const set = (patch: Partial<Draft['settings']>) => update({ settings: { ...s, ...patch } });
  const toggle = (k: AccessKey, value: boolean) => set({ [k]: value } as Partial<Draft['settings']>);
  return (
    <Section id="settings" hint="onbSettingsHint">
      <div className="grid gap-3 lg:grid-cols-2">
        <ToggleCard
          title={t('participantsSettings')}
          hint={t('participantsSettingsHint')}
          toggles={[
            ['allow_account_access', 'allowAccountAccess', 'allowAccountAccessHint'],
            ['allow_participant_pieces', 'allowParticipantPieces', 'allowParticipantPiecesHint'],
            ['show_weekend', 'showWeekend', 'showWeekendHint'],
            ['show_concerts', 'showConcerts', 'showConcertsHint'],
            ['show_surveys', 'showSurveys', 'showSurveysHint'],
          ]}
          values={s}
          onToggle={toggle}
        />
        <ToggleCard
          title={t('checkinSettings')}
          hint={t('checkinSettingsHint')}
          toggles={[
            ['allow_account_checkin', 'allowAccountCheckin', 'allowAccountCheckinHint'],
            ['allow_guest_checkin', 'allowGuestCheckin', 'allowGuestCheckinHint'],
          ]}
          values={s}
          onToggle={toggle}
        />
        <ToggleCard
          title={t('signupSettings')}
          hint={t('signupSettingsHint')}
          toggles={[
            ['allow_account_signup', 'allowAccountSignup', 'allowAccountSignupHint'],
            ['allow_guest_signup', 'allowGuestSignup', 'allowGuestSignupHint'],
          ]}
          values={s}
          onToggle={toggle}
        >
          <label className="flex cursor-pointer items-center justify-between gap-4 border-t border-border pt-4">
            <span>
              <span className="block font-medium">{t('requireSignupGroup')}</span>
              <span className="mt-0.5 block text-sm text-text-secondary">
                {groupNames.length ? t('requireSignupGroupHint') : t('requireSignupGroupNoGroups')}
              </span>
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 flex-shrink-0 accent-black"
              checked={s.require_signup_group}
              onChange={(e) => set({ require_signup_group: e.target.checked })}
            />
          </label>
          <div className="space-y-2 border-t border-border pt-4">
            <Select label={t('defaultGroup')} value={s.default_group} disabled={groupNames.length === 0} onChange={(e) => set({ default_group: e.target.value })}>
              <option value="">{t('noDefaultGroup')}</option>
              {groupNames.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
            <p className="text-sm text-text-secondary">{t('defaultGroupHint')}</p>
          </div>
        </ToggleCard>
        <ToggleCard
          title={t('projectEmailSettings')}
          hint={t('projectEmailSettingsHint')}
          toggles={[
            ['notify_registration_received', 'notifyRegistrationReceived', 'notifyRegistrationReceivedHint'],
            ['notify_checkin_confirmation', 'notifyCheckinConfirmation', 'notifyCheckinConfirmationHint'],
          ]}
          values={s}
          onToggle={toggle}
          unavailable={(k) => emailAvailable[k] === false}
          unavailableHint={t('projectEmailOffByAdmin')}
        />
      </div>
    </Section>
  );
};

// 3 · the eight choir groups to start with: rename, colour, sort, remove,
// add — or none at all. Who looks after a group, and a note, fold out.
const GroupsSection = ({ draft, update }: SectionProps) => {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const items = draft.groups.items;
  // Renames and removals carry over to imported members.
  const setItems = (next: DraftGroup[]) => {
    const renamed = new Map<string, string | null>();
    for (const old of items) {
      const now = next.find((g) => g.key === old.key);
      if (!now) renamed.set(old.name.toLowerCase(), null);
      else if (now.name !== old.name) renamed.set(old.name.toLowerCase(), now.name);
    }
    const members = renamed.size
      ? draft.members.map((m) =>
          m.group_name && renamed.has(m.group_name.toLowerCase())
            ? { ...m, group_name: renamed.get(m.group_name.toLowerCase()) ?? null }
            : m,
        )
      : draft.members;
    update({ groups: { skip: next.length === 0 && draft.groups.skip, items: next }, members });
  };
  const patch = (k: string, p: Partial<DraftGroup>) => setItems(items.map((g) => (g.key === k ? { ...g, ...p } : g)));
  return (
    <Section id="groups" hint="onbGroupsHint">
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong px-4 py-4 text-center text-sm text-text-secondary">
          {t('onbNoGroups')}
          <button type="button" onClick={() => update({ groups: { skip: false, items: defaultGroups() } })} className="ml-2 font-medium underline">
            {t('onbRestoreGroups')}
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {items.map((g, i) => (
            <li key={g.key}>
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <label
                  className="relative h-6 w-6 flex-shrink-0 cursor-pointer rounded-full border border-border"
                  style={{ backgroundColor: g.color }}
                  title={t('groupColor')}
                >
                  <input
                    type="color"
                    value={g.color}
                    onChange={(e) => patch(g.key, { color: e.target.value })}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label={`${t('groupColor')}: ${g.name}`}
                  />
                </label>
                <input
                  value={g.name}
                  maxLength={120}
                  aria-label={t('groupName')}
                  onChange={(e) => patch(g.key, { name: e.target.value })}
                  className="h-9 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm hover:border-border focus:border-black focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setOpen(open === g.key ? null : g.key)}
                  aria-expanded={open === g.key}
                  className="flex h-9 items-center gap-1 rounded-md px-2 text-xs text-text-secondary hover:bg-surface-muted"
                >
                  {g.responsibles.length > 0 ? t('onbResponsibleCount').replace('{n}', String(g.responsibles.length)) : t('groupResponsibles')}
                  <ChevronDown size={13} className={cn('transition-transform', open === g.key && 'rotate-180')} />
                </button>
                <RowButton label={t('moveUp')} disabled={i === 0} onClick={() => setItems(move(items, i, -1))}>
                  <ArrowUp size={14} />
                </RowButton>
                <RowButton label={t('moveDown')} disabled={i === items.length - 1} onClick={() => setItems(move(items, i, 1))}>
                  <ArrowDown size={14} />
                </RowButton>
                <RowButton label={`${t('remove')}: ${g.name}`} onClick={() => setItems(items.filter((x) => x.key !== g.key))}>
                  <X size={14} />
                </RowButton>
              </div>
              {open === g.key && (
                <div className="space-y-2 border-t border-border bg-surface-subtle px-3 py-3">
                  <p className="text-xs text-text-tertiary">{t('groupResponsiblesHint')}</p>
                  <PersonPicker
                    projectId={null}
                    value={g.responsibles}
                    onChange={(responsibles) => patch(g.key, { responsibles })}
                    label={t('groupResponsibles')}
                  />
                  <Textarea label={t('groupNote')} rows={2} maxLength={4000} value={g.note} onChange={(e) => patch(g.key, { note: e.target.value })} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <AddRow label={t('newGroup')} onClick={() => setItems([...items, { key: key(), name: '', color: paletteColor(items.length), responsibles: [], note: '' }])} />
      {items.length > 0 && (
        <button
          type="button"
          onClick={() => update({ groups: { skip: true, items: [] }, members: draft.members.map((m) => ({ ...m, group_name: null })) })}
          className="mt-2 text-sm text-text-secondary underline"
        >
          {t('onbNoGroupsButton')}
        </button>
      )}
    </Section>
  );
};

// 4 · Proben as compact rows (as on the Proben page).
const EventsSection = ({ draft, update }: SectionProps) => {
  const { t } = useI18n();
  const set = (events: DraftEvent[]) => update({ events });
  const patch = (k: string, p: Partial<DraftEvent>) => set(draft.events.map((e) => (e.key === k ? { ...e, ...p } : e)));
  return (
    <Section id="events" hint="onbEventsHint">
      <ul className="space-y-2">
        {draft.events.map((e, i) => (
          <li key={e.key} className="rounded-xl border border-border p-2">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_9rem_6rem_6rem_auto]">
              <Input
                aria-label={t('eventName')}
                placeholder={t('eventName')}
                value={e.name}
                maxLength={200}
                onChange={(ev) => patch(e.key, { name: ev.target.value })}
                className={cn(filled(e) && !e.name.trim() && 'border-danger')}
              />
              <Input type="date" aria-label={t('date')} value={e.date} onChange={(ev) => patch(e.key, { date: ev.target.value })} />
              <Input type="time" aria-label={t('startTime')} value={e.time} onChange={(ev) => patch(e.key, { time: ev.target.value })} />
              <Input type="time" aria-label={t('endTime')} value={e.end_time} disabled={!e.time} onChange={(ev) => patch(e.key, { end_time: ev.target.value })} />
              <div className="flex">
                <RowButton label={t('moveUp')} disabled={i === 0} onClick={() => set(move(draft.events, i, -1))}>
                  <ArrowUp size={14} />
                </RowButton>
                <RowButton label={t('moveDown')} disabled={i === draft.events.length - 1} onClick={() => set(move(draft.events, i, 1))}>
                  <ArrowDown size={14} />
                </RowButton>
                <RowButton label={t('remove')} onClick={() => set(draft.events.filter((x) => x.key !== e.key))}>
                  <Trash2 size={14} />
                </RowButton>
              </div>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Input
                aria-label={t('eventLocation')}
                placeholder={`${t('eventLocation')} (${t('optional')})`}
                value={e.location}
                maxLength={200}
                onChange={(ev) => patch(e.key, { location: ev.target.value })}
              />
              <Input
                aria-label={t('eventDescription')}
                placeholder={`${t('eventDescription')} (${t('optional')})`}
                value={e.description}
                maxLength={500}
                onChange={(ev) => patch(e.key, { description: ev.target.value })}
              />
            </div>
          </li>
        ))}
      </ul>
      <AddRow label={t('newEvent')} onClick={() => set([...draft.events, blankEvent()])} />
    </Section>
  );
};

// 5 · the members page's import, compact. Groups the project doesn't have
// need a decision; "create" adds them to section 3.
const MembersSection = ({ draft, update, groupNames }: SectionProps & { groupNames: string[] }) => {
  const { t } = useI18n();
  const [importing, setImporting] = useState(draft.members.length === 0);
  const imp = useMemberImport({ active: importing, projectId: null, groups: groupNames, explicitGroups: true });
  const take = () => {
    const result = imp.drafts();
    const items = [...draft.groups.items];
    for (const name of result.groups) {
      if (!items.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
        items.push({ key: key(), name, color: paletteColor(items.length), responsibles: [], note: '' });
      }
    }
    update({ members: result.members, groups: { skip: false, items } });
    setImporting(false);
  };
  return (
    <Section id="members" hint="onbMembersHint">
      {draft.members.length > 0 && !importing ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-subtle px-3 py-3 text-sm">
          <span>{t('onbMembersTaken').replace('{n}', String(draft.members.length))}</span>
          <span className="flex gap-2">
            <Button variant="secondary" className="h-8 px-3" onClick={() => setImporting(true)}>
              {t('onbMembersReplace')}
            </Button>
            <Button variant="secondary" className="h-8 px-3" onClick={() => update({ members: [] })}>
              {t('remove')}
            </Button>
          </span>
        </div>
      ) : (
        <div className="space-y-3">
          <MemberImportFields imp={imp} />
          {imp.undecidedGroups.length > 0 && (
            <p className="text-sm text-danger">{t('onbDecideGroups').replace('{groups}', imp.undecidedGroups.join(', '))}</p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <MemberImportSummary imp={imp} />
            <Button onClick={take} disabled={!imp.canImport || imp.undecidedGroups.length > 0}>
              {t('onbMembersTake')}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
};

const blankRegistration = (t: (k: TranslationKey) => string): DraftRegistration => ({
  title: t('onbRegistrationDefaultTitle'),
  description: '',
  ask_email: true,
  ask_group: true,
  closes_at: null,
  note_label: null,
  auto_transfer: false,
  active: false,
  cover_url: null,
  header_mode: 'app',
  header_text: '',
  tint_color: null,
});

// 6 · an optional first registration form (inactive unless chosen).
const RegistrationSection = ({ draft, update }: SectionProps) => {
  const { t } = useI18n();
  const r = draft.registration;
  const set = (patch: Partial<DraftRegistration>) => r && update({ registration: { ...r, ...patch } });
  return (
    <Section id="registration" hint="onbRegistrationHint">
      {!r ? (
        <AddRow label={t('onbRegistrationAdd')} onClick={() => update({ registration: blankRegistration(t) })} />
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={t('registrationTitle')} value={r.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />
            <div>
              <p className="mb-1.5 text-sm font-medium">{t('onbDeadline')}</p>
              <DeadlineInput value={toLocalInput(r.closes_at)} onChange={(v) => set({ closes_at: fromLocalInput(v) })} />
            </div>
          </div>
          <Textarea label={t('registrationDescription')} rows={2} value={r.description} onChange={(e) => set({ description: e.target.value })} />
          <div className="grid gap-2 sm:grid-cols-3">
            <Checkbox checked={r.ask_email} onChange={(ask_email) => set({ ask_email })} label={t('askEmail')} />
            <Checkbox checked={r.ask_group} onChange={(ask_group) => set({ ask_group })} label={t('askGroup')} />
            <Checkbox checked={r.auto_transfer} onChange={(auto_transfer) => set({ auto_transfer })} label={t('autoTransfer')} />
          </div>
          <NoteFieldInput
            source="form"
            label={r.note_label}
            onChange={(label) => set({ note_label: label === null ? null : noteLabelToSave(label, t('noteFieldDefault')) })}
          />
          <details className="rounded-xl border border-border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-text-secondary">{t('onbDesign')}</summary>
            <div className="mt-3 space-y-4">
              <CoverInput value={r.cover_url} onChange={(cover_url) => set({ cover_url })} />
              <HeaderBrandingInput
                mode={r.header_mode}
                text={r.header_text}
                onChange={(p) => set({ header_mode: p.header_mode ?? r.header_mode, header_text: p.header_text ?? r.header_text })}
              />
              <TintInput value={r.tint_color} onChange={(tint_color) => set({ tint_color })} />
            </div>
          </details>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <Checkbox checked={r.active} onChange={(active) => set({ active })} label={t('onbRegistrationActive')} hint={t('onbRegistrationActiveHint')} />
            <button type="button" onClick={() => update({ registration: null })} className="text-sm text-text-secondary underline">
              {t('remove')}
            </button>
          </div>
        </div>
      )}
    </Section>
  );
};

// 7 · concerts, unpublished; dress code, programme and recordings later.
const ConcertsSection = ({ draft, update }: SectionProps) => {
  const { t } = useI18n();
  const set = (concerts: DraftConcert[]) => update({ concerts });
  const patch = (k: string, p: Partial<DraftConcert>) => set(draft.concerts.map((c) => (c.key === k ? { ...c, ...p } : c)));
  return (
    <Section id="concerts" hint="onbConcertsHint">
      <ul className="space-y-2">
        {draft.concerts.map((c) => (
          <li key={c.key} className="rounded-xl border border-border p-2">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_9rem_6rem_auto]">
              <Input
                aria-label={t('concertTitle')}
                placeholder={t('concertTitle')}
                value={c.title}
                maxLength={200}
                onChange={(e) => patch(c.key, { title: e.target.value })}
                className={cn(concertFilled(c) && !c.title.trim() && 'border-danger')}
              />
              <Input type="date" aria-label={t('date')} value={c.date} onChange={(e) => patch(c.key, { date: e.target.value })} />
              <Input type="time" aria-label={t('startTime')} value={c.time} onChange={(e) => patch(c.key, { time: e.target.value })} />
              <RowButton label={t('remove')} onClick={() => set(draft.concerts.filter((x) => x.key !== c.key))}>
                <Trash2 size={14} />
              </RowButton>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Input
                aria-label={t('eventLocation')}
                placeholder={`${t('eventLocation')} (${t('optional')})`}
                value={c.location}
                maxLength={300}
                onChange={(e) => patch(c.key, { location: e.target.value })}
              />
              <Input
                aria-label={t('concertDescription')}
                placeholder={`${t('onbShortDescription')} (${t('optional')})`}
                value={c.description}
                maxLength={2000}
                onChange={(e) => patch(c.key, { description: e.target.value })}
              />
            </div>
          </li>
        ))}
      </ul>
      <AddRow label={t('newConcert')} onClick={() => set([...draft.concerts, blankConcert()])} />
    </Section>
  );
};

// 8 · pieces: from the collection, or new ones (they join the collection).
const PiecesSection = ({ draft, update }: SectionProps) => {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<{ id: string; name: string; composer: string }[]>([]);
  const [query, setQuery] = useState('');
  const [fresh, setFresh] = useState({ name: '', composer: '' });
  useEffect(() => {
    void api
      .from('pieces')
      .select('id, name, composer')
      .eq('archived', false)
      .order('name')
      .then(({ data }) => setCatalog((data as { id: string; name: string; composer: string }[] | null) ?? []));
  }, []);
  const matches = useMemo(() => {
    const chosen = new Set(draft.pieces.map((p) => p.piece_id).filter(Boolean));
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter((p) => !chosen.has(p.id) && `${p.name} ${p.composer}`.toLowerCase().includes(q)).slice(0, 8);
  }, [query, catalog, draft.pieces]);
  const set = (pieces: DraftPiece[]) => update({ pieces });
  const inputClass =
    'h-10 min-w-0 flex-1 rounded-md border border-border bg-white px-3 text-sm focus:border-black focus:outline-none max-md:min-h-11';
  return (
    <Section id="pieces" hint="onbPiecesHint">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1.5 text-sm font-medium">{t('onbFromLibrary')}</p>
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('onbSearchPieces')}
              aria-label={t('onbFromLibrary')}
              className={cn(inputClass, 'w-full pl-9')}
            />
          </div>
          {matches.length > 0 && (
            <ul className="mt-1 rounded-xl border border-border bg-surface p-1">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      set([...draft.pieces, { key: key(), piece_id: p.id, name: p.name, composer: p.composer }]);
                      setQuery('');
                    }}
                    className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-surface-hover"
                  >
                    <Plus size={13} className="text-text-tertiary" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="truncate text-xs text-text-tertiary">{p.composer}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">{t('onbNewPiece')}</p>
          <div className="flex gap-2">
            <input
              value={fresh.name}
              maxLength={200}
              placeholder={t('title')}
              aria-label={t('title')}
              onChange={(e) => setFresh({ ...fresh, name: e.target.value })}
              className={inputClass}
            />
            <input
              value={fresh.composer}
              maxLength={200}
              placeholder={t('composer')}
              aria-label={t('composer')}
              onChange={(e) => setFresh({ ...fresh, composer: e.target.value })}
              className={inputClass}
            />
            <Button
              variant="secondary"
              disabled={!fresh.name.trim()}
              aria-label={t('add')}
              onClick={() => {
                set([...draft.pieces, { key: key(), piece_id: null, name: fresh.name.trim(), composer: fresh.composer.trim() }]);
                setFresh({ name: '', composer: '' });
              }}
            >
              <Plus size={15} />
            </Button>
          </div>
          <p className="mt-1 text-xs text-text-tertiary">{t('onbNewPieceHint')}</p>
        </div>
      </div>
      {draft.pieces.length > 0 && (
        <ol className="mt-3 divide-y divide-border rounded-xl border border-border">
          {draft.pieces.map((p, i) => (
            <li key={p.key} className="flex items-center gap-2 px-2 py-1.5 text-sm">
              <span className="w-6 text-center text-xs tabular-nums text-text-tertiary">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{p.name}</span>
                {p.composer && <span className="ml-2 text-xs text-text-tertiary">{p.composer}</span>}
              </span>
              {!p.piece_id && (
                <span className="rounded bg-surface-muted px-1.5 py-px text-[10px] font-semibold text-text-secondary">{t('onbNewBadge')}</span>
              )}
              <RowButton label={t('moveUp')} disabled={i === 0} onClick={() => set(move(draft.pieces, i, -1))}>
                <ArrowUp size={14} />
              </RowButton>
              <RowButton label={t('moveDown')} disabled={i === draft.pieces.length - 1} onClick={() => set(move(draft.pieces, i, 1))}>
                <ArrowDown size={14} />
              </RowButton>
              <RowButton label={t('remove')} onClick={() => set(draft.pieces.filter((x) => x.key !== p.key))}>
                <X size={14} />
              </RowButton>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
};

// 9 · the audition rule, with the Fehlzeiten page's condition editor.
const AuditionSection = ({ draft, update }: SectionProps) => {
  const { t } = useI18n();
  const [rows, setRows] = useState<EditableCondition[]>(() => withIds(draft.audition.conditions));
  const set = (next: EditableCondition[]) => {
    setRows(next);
    update({ audition: { conditions: toStoredConditions(next) } });
  };
  const metric: Record<string, TranslationKey> = {
    attended: 'metricAttended',
    excused: 'metricExcused',
    absent: 'metricUnexcused',
    missed: 'metricMissed',
  };
  const comparison: Record<string, string> = { gte: '≥', gt: '>', eq: '=', lt: '<', lte: '≤' };
  const sentence = rows
    .map((c, i) => `${i ? ` ${c.connector === 'or' ? t('or') : t('and')} ` : ''}${t(metric[c.metric])} ${comparison[c.comparison]} ${c.value}`)
    .join('');
  return (
    <Section id="audition" hint="onbAuditionHint">
      <ConditionRows conditions={rows} onChange={set} />
      <Button variant="secondary" className="mt-3" onClick={() => set([...rows, createCondition()])}>
        <Plus size={16} />
        {t('addCondition')}
      </Button>
      <p className="mt-3 text-sm text-text-secondary">
        {rows.length ? t('onbAuditionSentence').replace('{conditions}', sentence) : t('onbAuditionNone')}
      </p>
    </Section>
  );
};

export const ProjectOnboardingPage = () => {
  const { canManageProjects } = useAuth();
  if (!canManageProjects) return <Navigate to="/projects" replace />;
  return <Onboarding />;
};

// Shown once on the new project's page after the set-up: what was created,
// and that everything left out can be set up there later.
export const CreatedSummary = ({ summary, onClose }: { summary: Record<string, number>; onClose: () => void }) => {
  const { t } = useI18n();
  const text = COUNTS.filter(([k]) => (summary[k] ?? 0) > 0)
    .map(([k, label]) => t(label).replace('{n}', String(summary[k])))
    .join(' · ');
  return (
    <div role="status" className="mb-5 flex items-start gap-3 rounded-2xl border border-success/40 bg-success-soft px-4 py-3 text-sm">
      <Check size={16} className="mt-0.5 flex-shrink-0 text-success-strong" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{t('onbCreated')}</span> {text}
        <span className="block text-text-secondary">{t('onbCreatedHint')}</span>
      </span>
      <button type="button" onClick={onClose} aria-label={t('close')} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface-hover">
        <X size={14} />
      </button>
    </div>
  );
};
