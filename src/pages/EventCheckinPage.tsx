import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Image,
  Lock,
  Maximize2,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Square,
  Trash2,
  UserRound,
  UserRoundCheck,
  X,
} from 'lucide-react';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { OverflowMenu } from '@/components/OverflowMenu';
import { cn } from '@/lib/cn';
import { PageSpinner } from '@/components/Spinner';
import { useEventContext } from '@/layouts/eventContext';
import { useI18n } from '@/lib/i18n';
import { localeOf } from '@shared/languages';
import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import type { AttendanceStatus, CheckinSubmission, EventCheckin, Member } from '@/types';
import { GroupPill } from '@/components/GroupPill';
import { useAuth } from '@/hooks/useAuth';

type CheckinStatus = Extract<AttendanceStatus, 'attended' | 'excused'>;
type CopyFeedback = 'link' | 'image' | 'error' | null;
type MemberOption = { member: Member; similarity: number | null };

const normalizeName = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const levenshteinDistance = (left: string, right: string) => {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    previous = current;
  }
  return previous[right.length];
};

const normalizedDistance = (left: string, right: string) =>
  levenshteinDistance(left, right) / Math.max(1, left.length, right.length);

const getMemberSimilarity = (submission: CheckinSubmission, member: Member) => {
  const submittedFirst = normalizeName(submission.first_name);
  const submittedLast = normalizeName(submission.last_name);
  const memberFirst = normalizeName(member.first_name);
  const memberLast = normalizeName(member.last_name);

  const componentDistance =
    normalizedDistance(submittedFirst, memberFirst) * 0.42 +
    normalizedDistance(submittedLast, memberLast) * 0.58;
  const fullNameDistance = normalizedDistance(
    `${submittedFirst} ${submittedLast}`,
    `${memberFirst} ${memberLast}`,
  );
  let similarity = 1 - Math.min(componentDistance, fullNameDistance);

  const submittedGroup = normalizeName(submission.group_name);
  const memberGroup = normalizeName(member.group_name ?? '');
  if (submittedGroup && submittedGroup === memberGroup) similarity = Math.min(1, similarity + 0.06);

  return similarity;
};

const createToken = () => {
  const webCrypto = window.crypto;
  const randomUUID = (webCrypto as Crypto & { randomUUID?: () => string }).randomUUID;
  if (randomUUID) return randomUUID.call(webCrypto);
  const bytes = webCrypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const qrSvgToPng = (svg: SVGSVGElement) =>
  new Promise<Blob>((resolve, reject) => {
    const source = new XMLSerializer().serializeToString(svg);
    const objectUrl = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
    const image = new window.Image();

    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 1200;
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Canvas is unavailable'));
        return;
      }

      context.fillStyle = '#ffffff'; // theme-ok: downloaded QR image, always on white
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 88, 88, 1024, 1024);
      URL.revokeObjectURL(objectUrl);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('PNG creation failed'))),
        'image/png',
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('QR image could not be loaded'));
    };
    image.src = objectUrl;
  });

// An action of an unrecognized check-in: icon and word, or only the icon
// (with `label` for screen readers).
const MobileActionButton = ({ onClick, label, children }: { onClick: () => void; label?: string; children: ReactNode }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    className={cn(
      'flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface text-xs font-medium text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text',
      label ? 'w-10' : 'px-2',
    )}
  >
    {children}
  </button>
);

// One check-in: name, group and time on one line (never wraps).
// `accountLabel`: marks an unrecognized check-in made with an account (it is
// linked to the member it gets assigned to).
const SubmissionLine = ({ row, time, accountLabel }: { row: CheckinSubmission; time: string; accountLabel?: string }) => (
  <div className="flex min-w-0 items-center gap-2">
    <span className="min-w-0 flex-1 truncate text-base font-medium" title={`${row.first_name} ${row.last_name}`}>
      {row.first_name} {row.last_name}
    </span>
    {accountLabel && row.user_id ? (
      <span className="inline-flex flex-shrink-0 items-center gap-1 rounded bg-surface-muted px-1.5 py-px text-[10px] font-semibold text-text-secondary">
        <UserRound size={10} />
        {accountLabel}
      </span>
    ) : null}
    {row.group_name ? (
      <span className="min-w-0 max-w-[40%] flex-shrink truncate">
        <GroupPill name={row.group_name} />
      </span>
    ) : null}
    <span className="flex-shrink-0 text-xs tabular-nums text-text-tertiary">{time}</span>
  </div>
);

export const EventCheckinPage = () => {
  const { project, event, reloadCheckinWarnings } = useEventContext();
  const { lang, t } = useI18n();
  const { user } = useAuth();
  // What one may do with unrecognized check-ins: the project's setting holds
  // for Stimmeltern, higher roles may do all (the server checks the same).
  const checkinRight = user?.role === 'section_lead' ? project.section_lead_checkin : 'create';
  const canAssign = checkinRight !== 'none';
  const canCreate = checkinRight === 'create';
  const [checkin, setCheckin] = useState<EventCheckin | null>(null);
  const [submissions, setSubmissions] = useState<CheckinSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [assigningSubmission, setAssigningSubmission] = useState<CheckinSubmission | null>(null);
  const [creatingFromSubmission, setCreatingFromSubmission] = useState<CheckinSubmission | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);
  const qrContainerRef = useRef<HTMLDivElement>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  const loadSubmissions = useCallback(async () => {
    const { data } = await api
      .from('checkin_submissions')
      .select('*')
      .eq('event_id', event.id)
      .order('submitted_at', { ascending: false });
    setSubmissions((data as CheckinSubmission[] | null) ?? []);
  }, [event.id]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: existing }, submissionsResult] = await Promise.all([
      api.from('event_checkins').select('*').eq('event_id', event.id).maybeSingle(),
      api
        .from('checkin_submissions')
        .select('*')
        .eq('event_id', event.id)
        .order('submitted_at', { ascending: false }),
    ]);

    let session = existing as EventCheckin | null;
    if (!session) {
      const { data: created } = await api
        .from('event_checkins')
        .upsert({ event_id: event.id }, { onConflict: 'event_id' })
        .select()
        .single();
      session = created as EventCheckin | null;
    }

    setCheckin(session);
    setSubmissions((submissionsResult.data as CheckinSubmission[] | null) ?? []);
    setLoading(false);
  }, [event.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadSubmissions();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [loadSubmissions]);

  useEffect(
    () => () => {
      if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    },
    [],
  );

  // Starting the check-in briefly pulses the fullscreen button, nudging
  // toward showing the QR code big on the projector/tablet.
  const [nudgeFullscreen, setNudgeFullscreen] = useState(false);
  useEffect(() => {
    if (!nudgeFullscreen) return;
    const timer = window.setTimeout(() => setNudgeFullscreen(false), 3600);
    return () => window.clearTimeout(timer);
  }, [nudgeFullscreen]);

  const updateCheckin = async (patch: Partial<EventCheckin>) => {
    if (!checkin) return;
    setBusy(true);
    const { data } = await api
      .from('event_checkins')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('event_id', event.id)
      .select()
      .single();
    if (data) setCheckin(data as EventCheckin);
    setBusy(false);
  };

  // Start/stop, from the button or by clicking the QR code. Starting outside
  // fullscreen nudges toward the fullscreen view.
  const toggleActive = () => {
    if (!checkin) return;
    if (!checkin.is_active) track('checkin-start');
    setNudgeFullscreen(!checkin.is_active && !fullscreenOpen);
    void updateCheckin({ is_active: !checkin.is_active });
  };

  const reset = async () => {
    await updateCheckin({ token: createToken() });
  };

  const removeSubmission = async (submissionId: string) => {
    setSubmissions((current) => current.filter((row) => row.id !== submissionId));
    const { error } = await api.from('checkin_submissions').delete().eq('id', submissionId);
    if (error) {
      void loadSubmissions();
    } else {
      void reloadCheckinWarnings();
    }
  };

  const showCopyFeedback = (feedback: Exclude<CopyFeedback, null>) => {
    setCopyFeedback(feedback);
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setCopyFeedback(null), 2500);
  };
  const closeFullscreen = useCallback(() => setFullscreenOpen(false), []);

  const unrecognized = useMemo(() => submissions.filter((row) => !row.recognized), [submissions]);
  const recognized = useMemo(() => submissions.filter((row) => row.recognized), [submissions]);
  // A rehearsal's check-ins all happen on its day: the time is enough.
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(localeOf(lang), { timeStyle: 'short' }), [lang]);

  if (loading) return <PageSpinner />;
  if (!checkin) return null;

  const publicUrl = `${window.location.origin}/check-in/${checkin.token}`;
  const logoSrc = checkin.show_logo ? project.image_url : null;
  const qrImageSettings = logoSrc
    ? { src: logoSrc, height: 52, width: 52, excavate: true }
    : undefined;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      track('checkin-share', { kind: 'link' });
      showCopyFeedback('link');
    } catch {
      showCopyFeedback('error');
    }
  };
  const copyImage = async () => {
    try {
      const svg = qrContainerRef.current?.querySelector('svg');
      if (!svg || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('Image clipboard is unavailable');
      }
      const png = await qrSvgToPng(svg);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      track('checkin-share', { kind: 'image' });
      showCopyFeedback('image');
    } catch {
      showCopyFeedback('error');
    }
  };

  const shareButtons = [
    { icon: Copy, label: t('copyLinkShort'), onClick: () => void copyLink(), nudge: false },
    { icon: Image, label: t('copyImageShort'), onClick: () => void copyImage(), nudge: false },
    {
      icon: Maximize2,
      label: t('fullscreenShort'),
      onClick: () => {
        track('checkin-share', { kind: 'fullscreen' });
        setNudgeFullscreen(false);
        setFullscreenOpen(true);
      },
      nudge: nudgeFullscreen,
    },
  ];

  return (
    <>
      <h1 className="sr-only">{t('checkIn')}</h1>
      {/* Phones: the code card first, then the numbers and the lists. Wide
          screens: the code stays beside the lists. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start">
        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5 lg:sticky lg:top-6">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                checkin.is_active ? 'bg-success-soft text-success-strong' : 'bg-surface-muted text-text-tertiary',
              )}
              role="status"
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  checkin.is_active ? 'animate-pulse bg-success' : 'bg-text-tertiary',
                )}
              />
              {checkin.is_active ? t('checkInActive') : t('checkInStopped')}
            </span>
            <div className="ml-auto">
              <OverflowMenu
                label={t('configuration')}
                items={[
                  { icon: Settings2, label: t('configuration'), onSelect: () => setConfigOpen(true) },
                  { icon: RotateCcw, label: t('newCheckinCode'), onSelect: () => void reset(), disabled: busy, separated: true },
                ]}
              />
            </div>
          </div>

          {/* An active code sits on paper (light in dark mode too) so it scans
              well. Tapping it starts/stops the check-in, like the button below. */}
          <button
            type="button"
            onClick={toggleActive}
            disabled={busy}
            aria-label={checkin.is_active ? t('stopCheckIn') : t('startCheckIn')}
            title={checkin.is_active ? t('stopCheckIn') : t('startCheckIn')}
            className="mx-auto mt-4 block w-full max-w-[200px] rounded-xl sm:max-w-[280px] transition-transform active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:cursor-wait"
          >
            <div ref={qrContainerRef} className="relative rounded-xl border border-border bg-paper p-4">
              <QRCodeSVG
                value={publicUrl}
                size={264}
                level="H"
                marginSize={0}
                imageSettings={qrImageSettings}
                className={cn('h-auto w-full', !checkin.is_active && 'opacity-15')}
              />
              {!checkin.is_active ? (
                <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                  <span className="flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-white shadow-sm">
                    <Lock size={24} />
                  </span>
                </div>
              ) : null}
            </div>
          </button>

          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            title={publicUrl}
            className="mx-auto mt-3 block max-w-[280px] truncate text-center text-xs text-text-tertiary underline-offset-2 hover:text-text hover:underline"
          >
            {publicUrl.replace(/^https?:\/\//, '')}
          </a>

          <Button
            variant={checkin.is_active ? 'accent' : 'primary'}
            disabled={busy}
            onClick={toggleActive}
            className="mt-4 h-11 w-full"
          >
            {checkin.is_active ? <Square size={15} /> : <Play size={16} />}
            {checkin.is_active ? t('stopCheckIn') : t('startCheckIn')}
          </Button>

          <div className="mt-2 grid grid-cols-3 gap-2">
            {shareButtons.map(({ icon: Icon, label, onClick, nudge }) => (
              <button
                key={label}
                type="button"
                onClick={onClick}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-1 rounded-lg border border-border text-xs font-medium text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text',
                  nudge && 'nudge-pulse',
                )}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
          {copyFeedback ? (
            <p
              className={cn('mt-3 text-center text-sm', copyFeedback === 'error' ? 'text-danger-strong' : 'text-text-secondary')}
              role="status"
            >
              {copyFeedback === 'link' ? t('linkCopied') : copyFeedback === 'image' ? t('imageCopied') : t('clipboardError')}
            </p>
          ) : null}
        </section>

        <div className="min-w-0 space-y-6">
          {unrecognized.length > 0 ? (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-danger-strong">
                <AlertTriangle size={13} />
                {t('unrecognizedCheckIns')} · {unrecognized.length}
              </h2>
              <ul className="space-y-2">
                {unrecognized.map((row) => (
                  <li key={row.id} className="rounded-2xl border border-border bg-surface p-3">
                    <SubmissionLine
                      row={row}
                      time={timeFormatter.format(new Date(row.submitted_at))}
                      accountLabel={t('checkinWithAccount')}
                    />
                    {canAssign ? (
                      <div className={cn('mt-3 grid gap-1.5', canCreate ? 'grid-cols-[1fr_1fr_auto]' : 'grid-cols-[1fr_auto]')}>
                        <MobileActionButton onClick={() => setAssigningSubmission(row)}>
                          <UserRoundCheck size={15} />
                          {t('assignCheckInShort')}
                        </MobileActionButton>
                        {canCreate ? (
                          <MobileActionButton onClick={() => setCreatingFromSubmission(row)}>
                            <Plus size={15} />
                            {t('saveAsNewMemberShort')}
                          </MobileActionButton>
                        ) : null}
                        <MobileActionButton onClick={() => removeSubmission(row.id)} label={t('delete')}>
                          <Trash2 size={15} />
                        </MobileActionButton>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
              {t('successfulCheckIns')} · {recognized.length}
            </h2>
            {recognized.length === 0 ? (
              <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-4 py-10 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-muted text-text-tertiary">
                  <CheckCircle2 size={20} />
                </span>
                <p className="mt-3 font-semibold">{t('noSuccessfulCheckIns')}</p>
              </div>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                {recognized.map((row) => (
                  <li key={row.id} className="px-3 py-2.5 sm:px-4">
                    <SubmissionLine row={row} time={timeFormatter.format(new Date(row.submitted_at))} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <CheckinConfigModal
        open={configOpen}
        value={checkin.attendance_status}
        showLogo={checkin.show_logo}
        hasLogo={Boolean(project.image_url)}
        busy={busy}
        onClose={() => setConfigOpen(false)}
        onSave={async (status, showLogo) => {
          await updateCheckin({ attendance_status: status, show_logo: showLogo });
          setConfigOpen(false);
        }}
      />

      {fullscreenOpen ? (
        <FullscreenQrCode
          eventName={event.name}
          publicUrl={publicUrl}
          active={checkin.is_active}
          busy={busy}
          logoSrc={logoSrc}
          onToggle={toggleActive}
          onClose={closeFullscreen}
        />
      ) : null}

      <AssignCheckinModal
        submission={assigningSubmission}
        projectId={event.project_id}
        onClose={() => setAssigningSubmission(null)}
        onAssigned={async () => {
          setAssigningSubmission(null);
          await Promise.all([loadSubmissions(), reloadCheckinWarnings()]);
        }}
      />

      <CreateMemberFromCheckinModal
        submission={creatingFromSubmission}
        onClose={() => setCreatingFromSubmission(null)}
        onCreated={async () => {
          setCreatingFromSubmission(null);
          await Promise.all([loadSubmissions(), reloadCheckinWarnings()]);
        }}
      />
    </>
  );
};

// Saves an unrecognized check-in submission as a brand new project member and
// assigns the submission to it. The data is prefilled but editable before saving.
const CreateMemberFromCheckinModal = ({
  submission,
  onClose,
  onCreated,
}: {
  submission: CheckinSubmission | null;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) => {
  const { t } = useI18n();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [groupName, setGroupName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!submission) return;
    setFirst(submission.first_name);
    setLast(submission.last_name);
    setGroupName(submission.group_name ?? '');
    setError('');
    setSaving(false);
  }, [submission]);

  const valid = first.trim() && last.trim();

  const save = async () => {
    if (!submission || !valid) return;
    setSaving(true);
    setError('');
    // One server call: the member and the assignment are saved together.
    const { error: rpcError } = await api.rpc('create_member_from_checkin', {
      p_submission_id: submission.id,
      p_first_name: first.trim(),
      p_last_name: last.trim(),
      p_group_name: groupName.trim(),
    });
    setSaving(false);
    if (rpcError) {
      setError(t('assignmentError'));
      return;
    }
    await onCreated();
  };

  return (
    <Modal
      open={Boolean(submission)}
      title={t('saveAsNewMember')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button disabled={!valid || saving} onClick={save}>
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label={t('firstName')} value={first} onChange={(e) => setFirst(e.target.value)} autoFocus />
          <Input label={t('lastName')} value={last} onChange={(e) => setLast(e.target.value)} />
        </div>
        <Input label={t('group')} value={groupName} onChange={(e) => setGroupName(e.target.value)} />
        {error ? (
          <p className="text-sm text-danger-strong" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
};

const AssignCheckinModal = ({
  submission,
  projectId,
  onClose,
  onAssigned,
}: {
  submission: CheckinSubmission | null;
  projectId: string;
  onClose: () => void;
  onAssigned: () => Promise<void>;
}) => {
  const { t } = useI18n();
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!submission) return;
    let cancelled = false;
    setLoading(true);
    setQuery('');
    setError('');
    api
      .from('members')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'active')
      .order('last_name')
      .order('first_name')
      .then(({ data }) => {
        if (cancelled) return;
        setMembers((data as Member[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, submission]);

  const suggestedMembers = useMemo<MemberOption[]>(() => {
    if (!submission) return [];
    return members
      .map((member) => ({ member, similarity: getMemberSimilarity(submission, member) }))
      .filter((option) => option.similarity >= 0.55)
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, 6);
  }, [members, submission]);

  const visibleMembers = useMemo<MemberOption[]>(() => {
    const normalizedQuery = normalizeName(query);
    if (!normalizedQuery) return suggestedMembers;
    return members
      .filter((member) =>
        normalizeName(`${member.first_name} ${member.last_name} ${member.group_name ?? ''}`)
          .includes(normalizedQuery),
      )
      .map((member) => ({ member, similarity: null }));
  }, [members, query, suggestedMembers]);

  const assign = async (member: Member) => {
    if (!submission) return;
    setAssigningId(member.id);
    setError('');
    const { error: rpcError } = await api.rpc('assign_checkin_submission', {
      p_submission_id: submission.id,
      p_member_id: member.id,
    });
    setAssigningId(null);
    if (rpcError) {
      setError(t('assignmentError'));
      return;
    }
    await onAssigned();
  };

  return (
    <Modal open={Boolean(submission)} title={t('assignCheckIn')} onClose={onClose}>
      {submission ? (
        <>
          <div className="rounded-md border border-border bg-surface-subtle px-3 py-2 text-sm">
            <span className="font-medium">
              {submission.first_name} {submission.last_name}
            </span>
            <span className="text-text-secondary"> · {submission.group_name}</span>
          </div>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search')}
            autoFocus
          />
          {error ? (
            <p className="text-sm text-danger-strong" role="alert">
              {error}
            </p>
          ) : null}
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="spinner" role="status" aria-label={t('loading')} />
            </div>
          ) : visibleMembers.length > 0 ? (
            <div>
              {!query.trim() ? (
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                  {t('suggestedMembers')}
                </p>
              ) : null}
              <div className="max-h-[360px] overflow-y-auto rounded-md border border-border">
                {visibleMembers.map(({ member, similarity }) => (
                  <button
                    key={member.id}
                    type="button"
                    disabled={assigningId !== null}
                    onClick={() => assign(member)}
                    className="flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-surface-muted disabled:cursor-wait disabled:opacity-60"
                  >
                    <Avatar
                      name={`${member.first_name} ${member.last_name}`}
                      photoUrl={member.photo_url}
                      size={34}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {member.first_name} {member.last_name}
                      </span>
                      <span className="mt-0.5 block truncate text-sm">
                        <GroupPill name={member.group_name} />
                      </span>
                    </span>
                    <span className="flex-shrink-0 text-xs font-medium text-text-secondary">
                      {assigningId === member.id
                        ? t('loading')
                        : similarity !== null
                          ? `${Math.round(similarity * 100)}% ${t('similarity')}`
                          : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState icon={Search} message={t('noMatchingMembers')} />
          )}
        </>
      ) : null}
    </Modal>
  );
};

const FullscreenQrCode = ({
  eventName,
  publicUrl,
  active,
  busy,
  logoSrc,
  onToggle,
  onClose,
}: {
  eventName: string;
  publicUrl: string;
  active: boolean;
  busy: boolean;
  logoSrc: string | null;
  onToggle: () => void;
  onClose: () => void;
}) => {
  const { t } = useI18n();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-white px-6 pt-12 pb-[max(3rem,env(safe-area-inset-bottom))] text-center"
      role="dialog"
      aria-modal="true"
      aria-label={t('showFullscreen')}
    >
      <div className="dot-field" aria-hidden="true" />
      <button
        type="button"
        onClick={onClose}
        autoFocus
        aria-label={t('close')}
        className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-surface-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
      >
        <X size={24} />
      </button>

      <h2 className="mb-8 max-w-3xl text-3xl font-bold sm:text-4xl">{eventName}</h2>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-label={active ? t('stopCheckIn') : t('startCheckIn')}
        title={active ? t('stopCheckIn') : t('startCheckIn')}
        className="rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:cursor-wait"
      >
        <div className="relative rounded-2xl border border-border bg-paper p-6 shadow-sm sm:p-8">
          <QRCodeSVG
            value={publicUrl}
            size={640}
            level="H"
            marginSize={0}
            imageSettings={logoSrc ? { src: logoSrc, height: 120, width: 120, excavate: true } : undefined}
            className={`h-auto w-[min(60vw,60vh)] max-w-[640px] ${active ? '' : 'opacity-15'}`}
          />
          {!active ? (
            <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
              <span className="flex h-20 w-20 items-center justify-center rounded-2xl border border-border bg-white shadow-sm">
                <Lock size={34} />
              </span>
            </div>
          ) : null}
        </div>
      </button>
      <div
        className={`mt-7 inline-flex items-center gap-2 text-lg font-semibold ${
          active ? 'text-success-strong' : 'text-text-secondary'
        }`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${active ? 'bg-success' : 'bg-text-tertiary'}`} />
        {active ? t('checkInActive') : t('checkInStopped')}
      </div>
    </div>,
    document.body,
  );
};

const CheckinConfigModal = ({
  open,
  value,
  showLogo,
  hasLogo,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  value: CheckinStatus;
  showLogo: boolean;
  hasLogo: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (status: CheckinStatus, showLogo: boolean) => Promise<void>;
}) => {
  const { t } = useI18n();
  const [status, setStatus] = useState<CheckinStatus>(value);
  const [logo, setLogo] = useState(showLogo);

  useEffect(() => {
    if (open) {
      setStatus(value);
      setLogo(showLogo);
    }
  }, [open, value, showLogo]);

  return (
    <Modal
      open={open}
      title={t('configureCheckIn')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button disabled={busy} onClick={() => onSave(status, logo)}>
            {t('save')}
          </Button>
        </>
      }
    >
      <fieldset>
        <legend className="mb-3 text-sm font-medium">{t('checkInResult')}</legend>
        <div className="space-y-2">
          {(['attended', 'excused'] as const).map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-4 py-3 hover:bg-surface-subtle"
            >
              <input
                type="radio"
                name="checkin-status"
                value={option}
                checked={status === option}
                onChange={() => setStatus(option)}
                className="accent-black"
              />
              <span className="font-medium">
                {option === 'attended' ? t('attended') : t('excused')}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {hasLogo ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border px-4 py-3 hover:bg-surface-subtle">
          <input
            type="checkbox"
            checked={logo}
            onChange={(e) => setLogo(e.target.checked)}
            className="mt-0.5 accent-black"
          />
          <span className="block text-sm font-medium">{t('showLogoInQr')}</span>
        </label>
      ) : null}
    </Modal>
  );
};
