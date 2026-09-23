import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  UserRoundCheck,
  UserX,
  X,
} from 'lucide-react';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { RowActionButton } from '@/components/RowActionButton';
import { PageSpinner } from '@/components/Spinner';
import { useEventContext } from '@/layouts/eventContext';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import type { AttendanceStatus, CheckinSubmission, EventCheckin, Member } from '@/types';
import { GroupPill } from '@/components/GroupPill';

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

      context.fillStyle = '#ffffff';
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

export const EventCheckinPage = () => {
  const { project, event, reloadCheckinWarnings } = useEventContext();
  const { lang, t } = useI18n();
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
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [lang],
  );
  const columns = useMemo<Column<CheckinSubmission>[]>(
    () => [
      {
        id: 'name',
        header: t('name'),
        accessor: (row) => `${row.last_name} ${row.first_name}`,
        render: (row) => `${row.first_name} ${row.last_name}`,
      },
      {
        id: 'group',
        header: t('group'),
        accessor: (row) => row.group_name,
        render: (row) => <GroupPill name={row.group_name} />,
      },
      {
        id: 'submitted',
        header: t('submittedAt'),
        accessor: (row) => row.submitted_at,
        render: (row) => (
          <span className="text-text-secondary whitespace-nowrap">
            {dateFormatter.format(new Date(row.submitted_at))}
          </span>
        ),
        className: 'w-px',
      },
    ],
    [dateFormatter, t],
  );

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
      showCopyFeedback('image');
    } catch {
      showCopyFeedback('error');
    }
  };

  return (
    <>
      <h1 className="sr-only">{t('checkIn')}</h1>
      <div className="flex flex-col gap-3 mb-8 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="secondary" onClick={() => setConfigOpen(true)} className="sm:flex-shrink-0">
          <Settings2 size={16} />
          {t('configuration')}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={busy} onClick={reset}>
            <RotateCcw size={16} />
            {t('clearFilters')}
          </Button>
          <Button
            variant={checkin.is_active ? 'accent' : 'primary'}
            disabled={busy}
            onClick={() => updateCheckin({ is_active: !checkin.is_active })}
          >
            {checkin.is_active ? <Square size={15} /> : <Play size={16} />}
            {checkin.is_active ? t('stopCheckIn') : t('startCheckIn')}
          </Button>
        </div>
      </div>

      <section className="flex flex-col items-center text-center py-4 mb-12">
        <div ref={qrContainerRef} className="relative rounded-xl border border-border bg-white p-5 shadow-sm">
          <QRCodeSVG
            value={publicUrl}
            size={264}
            level="H"
            marginSize={0}
            imageSettings={qrImageSettings}
            className={`h-auto w-[264px] max-w-full ${checkin.is_active ? '' : 'opacity-15'}`}
          />
          {!checkin.is_active ? (
            <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white border border-border shadow-sm">
                <Lock size={24} />
              </span>
            </div>
          ) : null}
        </div>
        <div
          className={`mt-5 inline-flex items-center gap-2 text-sm font-medium ${
            checkin.is_active ? 'text-[#16803b]' : 'text-text-secondary'
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${checkin.is_active ? 'bg-[#16a34a]' : 'bg-text-tertiary'}`}
          />
          {checkin.is_active ? t('checkInActive') : t('checkInStopped')}
        </div>
        <p className="mt-2 text-sm text-text-secondary">{t('checkInLinkHint')}</p>
        <a
          href={publicUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 max-w-full truncate text-sm text-text-tertiary underline underline-offset-2 hover:text-text"
        >
          {publicUrl}
        </a>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button variant="secondary" onClick={copyLink}>
            <Copy size={16} />
            {t('copyCheckInLink')}
          </Button>
          <Button variant="secondary" onClick={copyImage}>
            <Image size={16} />
            {t('copyQrImage')}
          </Button>
          <Button variant="secondary" onClick={() => setFullscreenOpen(true)}>
            <Maximize2 size={16} />
            {t('showFullscreen')}
          </Button>
        </div>
        {copyFeedback ? (
          <p
            className={`mt-3 text-sm ${copyFeedback === 'error' ? 'text-red-700' : 'text-text-secondary'}`}
            role="status"
          >
            {copyFeedback === 'link'
              ? t('linkCopied')
              : copyFeedback === 'image'
                ? t('imageCopied')
                : t('clipboardError')}
          </p>
        ) : null}
      </section>

      <div className="space-y-10">
        {unrecognized.length > 0 ? (
          <section>
            <div className="mb-4 flex items-center gap-2">
              <UserX size={18} className="text-text-secondary" />
              <h2 className="text-lg font-semibold">{t('unrecognizedCheckIns')}</h2>
              <span className="inline-flex items-center gap-1 rounded-md bg-[#fef2f2] px-1.5 py-0.5 text-xs font-semibold text-[#b91c1c]">
                <AlertTriangle size={12} />
                {t('unrecognizedWarning').replace('{n}', String(unrecognized.length))}
              </span>
            </div>
            <DataTable
              rows={unrecognized}
              columns={columns}
              getRowId={(row) => row.id}
              actions={(row) => (
                <>
                  <RowActionButton label={t('assignCheckIn')} onClick={() => setAssigningSubmission(row)}>
                    <UserRoundCheck size={15} />
                  </RowActionButton>
                  <RowActionButton label={t('saveAsNewMember')} onClick={() => setCreatingFromSubmission(row)}>
                    <Plus size={15} />
                  </RowActionButton>
                  <RowActionButton label={t('delete')} onClick={() => removeSubmission(row.id)}>
                    <Trash2 size={15} />
                  </RowActionButton>
                </>
              )}
              emptyMessage={t('noUnrecognizedCheckIns')}
              emptyIcon={UserX}
            />
          </section>
        ) : null}

        <section>
          <div className="mb-4 flex items-center gap-2">
            <CheckCircle2 size={18} className="text-[#16803b]" />
            <h2 className="text-lg font-semibold">{t('successfulCheckIns')}</h2>
            <span className="text-sm text-text-tertiary">{recognized.length}</span>
          </div>
          <DataTable
            rows={recognized}
            columns={columns}
            getRowId={(row) => row.id}
            emptyMessage={t('noSuccessfulCheckIns')}
            emptyIcon={CheckCircle2}
          />
        </section>
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
          logoSrc={logoSrc}
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
        projectId={event.project_id}
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
  projectId,
  onClose,
  onCreated,
}: {
  submission: CheckinSubmission | null;
  projectId: string;
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
    const { data: member, error: insertError } = await api
      .from('members')
      .insert({
        project_id: projectId,
        first_name: first.trim(),
        last_name: last.trim(),
        group_name: groupName.trim() || null,
        status: 'active',
      })
      .select()
      .single();

    if (insertError || !member) {
      setSaving(false);
      setError(t('assignmentError'));
      return;
    }

    const { error: rpcError } = await api.rpc('assign_checkin_submission', {
      p_submission_id: submission.id,
      p_member_id: (member as Member).id,
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
        <p className="text-sm text-text-secondary">{t('saveAsNewMemberHint')}</p>
        <div className="grid grid-cols-2 gap-3">
          <Input label={t('firstName')} value={first} onChange={(e) => setFirst(e.target.value)} autoFocus />
          <Input label={t('lastName')} value={last} onChange={(e) => setLast(e.target.value)} />
        </div>
        <Input label={t('group')} value={groupName} onChange={(e) => setGroupName(e.target.value)} />
        {error ? (
          <p className="text-sm text-red-700" role="alert">
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
          <p className="text-sm text-text-secondary">
            {t('assignCheckInHint')}
          </p>
          <div className="rounded-md border border-border bg-[#fafafa] px-3 py-2 text-sm">
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
            <p className="text-sm text-red-700" role="alert">
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
                    className="flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-[#f5f5f5] disabled:cursor-wait disabled:opacity-60"
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
  logoSrc,
  onClose,
}: {
  eventName: string;
  publicUrl: string;
  active: boolean;
  logoSrc: string | null;
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
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-white px-6 py-12 text-center"
      role="dialog"
      aria-modal="true"
      aria-label={t('showFullscreen')}
    >
      <button
        type="button"
        onClick={onClose}
        autoFocus
        aria-label={t('close')}
        className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-[#f5f5f5] hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
      >
        <X size={24} />
      </button>

      <h2 className="mb-8 max-w-3xl text-3xl font-bold sm:text-4xl">{eventName}</h2>
      <div className="relative rounded-2xl border border-border bg-white p-6 shadow-sm sm:p-8">
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
            <span className="flex h-20 w-20 items-center justify-center rounded-full border border-border bg-white shadow-sm">
              <Lock size={34} />
            </span>
          </div>
        ) : null}
      </div>
      <div
        className={`mt-7 inline-flex items-center gap-2 text-lg font-semibold ${
          active ? 'text-[#16803b]' : 'text-text-secondary'
        }`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${active ? 'bg-[#16a34a]' : 'bg-text-tertiary'}`} />
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
              className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-4 py-3 hover:bg-[#fafafa]"
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
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border px-4 py-3 hover:bg-[#fafafa]">
          <input
            type="checkbox"
            checked={logo}
            onChange={(e) => setLogo(e.target.checked)}
            className="mt-0.5 accent-black"
          />
          <span>
            <span className="block text-sm font-medium">{t('showLogoInQr')}</span>
            <span className="mt-0.5 block text-sm text-text-secondary">{t('showLogoInQrHint')}</span>
          </span>
        </label>
      ) : null}
    </Modal>
  );
};
