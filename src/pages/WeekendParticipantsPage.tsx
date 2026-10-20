import { useCallback, useEffect, useMemo, useState } from 'react';
import { BedDouble, CalendarRange, CircleHelp, ClipboardPaste, FileUp, Link2, Plus, RotateCcw, Search, Trash2, Upload, UserRound, UsersRound } from 'lucide-react';
import { FileDropzone } from '@/components/FileDropzone';
import { ColumnMapper, WEEKEND_TARGETS, type WeekendMapTarget } from '@/components/FieldMapper';
import { guessAssignment } from '@/components/MemberImport';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { PageSpinner } from '@/components/Spinner';
import { DataTable, type Column } from '@/components/DataTable';
import { PersonPicker } from '@/components/PersonPicker';
import { GroupPill } from '@/components/GroupPill';
import { NoAccess } from '@/components/NoAccess';
import { Toast, useToast } from '@/components/Toast';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { detectDelimiter, parseCsv } from '@/lib/csv';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { useProjectGroups } from '@/hooks/useProjectGroups';
import { formDate } from '@/lib/forms';
import { nightsLabel, useWeekendContext, type WeekendImport, type WeekendParticipant } from '@/lib/weekends';
import type { PersonOption } from '@/types';

interface MemberOption {
  id: string;
  first_name: string;
  last_name: string;
  group_name: string | null;
  status: string;
}

interface Candidate {
  member_id: string | null;
  user_id: string | null;
  name: string;
  email: string | null;
  group_name: string | null;
  status: 'active' | 'archived' | 'account';
}

interface PreviewRow {
  index: number;
  entry: { name: string; email: string; group: string; booking: string };
  status: 'existing' | 'sure' | 'confirm' | 'unknown';
  match: Candidate | null;
  candidates: Candidate[];
}

// What happens with a line: linked to someone (member id / account id),
// a weekend guest, a new project member, left open, or skipped.
type Decision = { action: 'link'; member_id: string | null; user_id: string | null } | { action: 'guest' | 'new_member' | 'pending' | 'skip' };

const KIND_LABEL: Record<WeekendParticipant['kind'], TranslationKey> = {
  member: 'weekendKindMember',
  guest: 'weekendKindGuest',
  pending: 'weekendKindPending',
};

// "Teilnehmende" (managers): the weekend's own list — independent of the
// project's members. Imports show a preview first (recognised for sure, to
// confirm, not recognised); entries can be added and removed by hand; the
// last import can be undone.
export const WeekendParticipantsPage = () => {
  const { t, lang } = useI18n();
  const { weekend, canManage, project, reloadWeekend } = useWeekendContext();
  const [participants, setParticipants] = useState<WeekendParticipant[] | null>(null);
  const [imports, setImports] = useState<WeekendImport[]>([]);
  const [rooms, setRooms] = useState<Map<string, string>>(new Map());
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [resolving, setResolving] = useState<WeekendParticipant | null>(null);
  const [undoResult, setUndoResult] = useState<{ removed: number; kept: { id: string; name: string; reason: string }[] } | null>(null);
  const [query, setQuery] = useState('');
  const toast = useToast();

  const load = useCallback(async () => {
    const [{ data: list }, { data: history }, { data: placed }, { data: memberRows }] = await Promise.all([
      api.from('weekend_participants').select('*').eq('weekend_id', weekend.id).order('name'),
      api.from('weekend_imports').select('*').eq('weekend_id', weekend.id).order('created_at', { ascending: false }),
      api.from('weekend_room_assignments').select('participant_id, weekend_rooms!inner(name, weekend_id)').eq('weekend_rooms.weekend_id', weekend.id),
      api.from('members').select('id, first_name, last_name, group_name, status').eq('project_id', project.id).in('status', ['active', 'archived']).order('last_name'),
    ]);
    setParticipants((list as WeekendParticipant[] | null) ?? []);
    setImports((history as WeekendImport[] | null) ?? []);
    setRooms(
      new Map(
        ((placed as Array<{ participant_id: string; weekend_rooms: { name: string } | null }> | null) ?? []).map((a) => [
          a.participant_id,
          a.weekend_rooms?.name ?? '',
        ]),
      ),
    );
    setMembers((memberRows as MemberOption[] | null) ?? []);
  }, [weekend.id, project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canManage) return <NoAccess />;
  if (!participants) return <PageSpinner />;

  const remove = async (p: WeekendParticipant) => {
    await api.from('weekend_participants').delete().eq('id', p.id);
    await load();
    void reloadWeekend();
    toast.show(t('weekendParticipantRemoved').replace('{name}', p.name), async () => {
      if (p.kind === 'member') await api.rpc('weekend_add_participant', { p_weekend_id: weekend.id, p_member_id: p.member_id, p_user_id: p.user_id });
      else await api.rpc('weekend_add_participant', { p_weekend_id: weekend.id, p_name: p.name, p_email: p.email });
      await load();
    });
  };

  const undoLast = async () => {
    const { data } = await api.rpc('weekend_import_undo', { p_weekend_id: weekend.id });
    setUndoResult(data as typeof undoResult);
    await load();
    void reloadWeekend();
  };

  // The periods to choose from: as placed in the settings, then as imported.
  const bookingLabels = [
    ...new Set([...weekend.periods.map((p) => p.label), ...participants.map((p) => p.booking).filter((b): b is string => Boolean(b))]),
  ];

  const setBooking = async (p: WeekendParticipant, booking: string | null) => {
    // A period chosen here replaces nights chosen on the link.
    const { error } = await api.from('weekend_participants').update({ booking, night_from: null, night_to: null }).eq('id', p.id);
    if (error) return toast.show(`${t('saveFailed')} (${error.message})`);
    await load();
    toast.show(t('weekendBookingChanged').replace('{name}', p.name), () =>
      void api
        .from('weekend_participants')
        .update({ booking: p.booking, night_from: p.night_from, night_to: p.night_to })
        .eq('id', p.id)
        .then(load),
    );
  };

  const confirmed = participants.filter((p) => p.kind !== 'pending').length;
  const pending = participants.filter((p) => p.kind === 'pending').length;
  const lastImport = imports.find((i) => !i.undone_at);

  const columns: Column<WeekendParticipant>[] = [
    {
      id: 'name',
      header: t('name'),
      accessor: (p) => p.name,
      render: (p) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium" title={p.name}>
            {p.name}
          </span>
          {p.source_name && p.source_name !== p.name && (
            <span className="block truncate text-xs text-text-tertiary">{t('weekendImportedAs').replace('{name}', p.source_name)}</span>
          )}
        </span>
      ),
    },
    {
      id: 'kind',
      header: t('weekendLink'),
      accessor: (p) => p.kind,
      render: (p) => (
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
            p.kind === 'member' ? 'bg-success-soft text-success-strong' : p.kind === 'guest' ? 'bg-surface-muted text-text-secondary' : 'bg-accent/15 text-text',
          )}
        >
          {p.kind === 'pending' ? <CircleHelp size={12} /> : <UserRound size={12} />}
          {t(KIND_LABEL[p.kind])}
        </span>
      ),
      className: 'w-36',
    },
    { id: 'group', header: t('group'), accessor: (p) => p.group_name, render: (p) => <GroupPill name={p.group_name} />, className: 'w-36' },
    {
      id: 'booking',
      header: t('weekendBooking'),
      accessor: (p) => p.booking ?? '',
      render: (p) => <BookingSelect participant={p} labels={bookingLabels} onChange={(booking) => void setBooking(p, booking)} />,
      className: 'w-40',
    },
  ];
  const roomColumn: Column<WeekendParticipant> = {
    id: 'room',
    header: t('weekendRoom'),
    accessor: (p) => rooms.get(p.id) ?? '',
    render: (p) => (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <BedDouble size={13} className="flex-shrink-0 text-text-tertiary" aria-hidden />
        <span className="truncate">{rooms.get(p.id)}</span>
      </span>
    ),
    className: 'w-40',
  };

  // Three parts: imported lines nobody is assigned to yet (to assign or
  // delete), then everyone without a room, then everyone in a room.
  const q = query.trim().toLowerCase();
  const matches = (p: WeekendParticipant) =>
    !q || `${p.name} ${p.email ?? ''} ${p.source_name ?? ''} ${p.group_name ?? ''}`.toLowerCase().includes(q);
  const unassigned = participants.filter((p) => p.kind === 'pending' && matches(p));
  const listed = participants.filter((p) => p.kind !== 'pending');
  const withoutRoom = listed.filter((p) => !rooms.has(p.id));
  const inRoom = listed.filter((p) => rooms.has(p.id));

  const removeButton = (p: WeekendParticipant) => (
    <button
      type="button"
      onClick={() => void remove(p)}
      aria-label={`${t('remove')}: ${p.name}`}
      title={t('remove')}
      className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text"
    >
      <Trash2 size={15} />
    </button>
  );

  const sectionLabel = (label: TranslationKey, n: number) => (
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
      {t(label)} ({n})
    </h2>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">{t('weekendParticipants')}</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {t('weekendParticipantsSummary').replace('{confirmed}', String(confirmed)).replace('{pending}', String(pending))}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus size={16} />
            {t('add')}
          </Button>
          <Button onClick={() => setImporting(true)}>
            <Upload size={16} />
            {t('weekendImport')}
          </Button>
        </div>
      </div>
      <p className="text-xs text-text-tertiary">{t('weekendListIndependent')}</p>

      {participants.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border-strong px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
            <UsersRound size={22} />
          </span>
          <p className="mt-3 max-w-sm text-sm text-text-secondary">{t('weekendNoParticipants')}</p>
        </div>
      ) : (
        <>
          <div className="relative sm:max-w-sm">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm"
            />
          </div>

          {unassigned.length > 0 && (
            <section>
              {sectionLabel('weekendSectionUnassigned', unassigned.length)}
              <p className="-mt-1 mb-2 text-xs text-text-tertiary">{t('weekendSectionUnassignedHint')}</p>
              <ul className="space-y-2">
                {unassigned.map((p) => (
                  <li
                    key={p.id}
                    className="group/row flex flex-col gap-2 rounded-2xl border border-accent/50 bg-surface px-4 py-3 sm:flex-row sm:items-center"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                        <CircleHelp size={16} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium" title={p.source_name || p.name}>
                          {p.source_name || p.name}
                        </span>
                        <span className="block truncate text-xs text-text-tertiary">
                          {[
                            viaLink(p) && t('weekendSignedUpViaLink'),
                            p.night_from != null && p.night_to != null && nightsLabel([p.night_from, p.night_to], t('weekendNight')),
                            p.email,
                            p.group_name,
                          ]
                            .filter(Boolean)
                            .join(' · ') || t('weekendKindPending')}
                        </span>
                      </span>
                    </span>
                    <span className="flex flex-shrink-0 gap-2">
                      <Button className="h-8 px-3" onClick={() => setResolving(p)}>
                        <Link2 size={14} />
                        {t('weekendAssign')}
                      </Button>
                      <Button variant="secondary" className="h-8 px-3" onClick={() => void remove(p)}>
                        <Trash2 size={14} />
                        {t('delete')}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            {sectionLabel('weekendSectionNoRoom', withoutRoom.filter(matches).length)}
            <DataTable
              variant="modern"
              rows={withoutRoom}
              columns={columns}
              getRowId={(p) => p.id}
              search={(p) => `${p.name} ${p.email ?? ''} ${p.source_name ?? ''} ${p.group_name ?? ''}`}
              query={query}
              hideToolbar
              emptyMessage={t('weekendNoneWithoutRoom')}
              emptyIcon={BedDouble}
              actions={removeButton}
            />
          </section>

          <section>
            {sectionLabel('weekendSectionInRoom', inRoom.filter(matches).length)}
            <DataTable
              variant="modern"
              rows={inRoom}
              columns={[...columns, roomColumn]}
              getRowId={(p) => p.id}
              search={(p) => `${p.name} ${p.email ?? ''} ${p.source_name ?? ''} ${p.group_name ?? ''} ${rooms.get(p.id) ?? ''}`}
              query={query}
              hideToolbar
              emptyMessage={t('weekendNoneInRoom')}
              emptyIcon={BedDouble}
              actions={removeButton}
            />
          </section>
        </>
      )}

      {imports.length > 0 && (
        <details className="rounded-2xl border border-border bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-text-secondary">
            {t('weekendImportLog')} ({imports.length})
          </summary>
          <ul className="mt-2 divide-y divide-border text-sm">
            {imports.map((i) => (
              <li key={i.id} className={cn('py-2', i.undone_at && 'text-text-tertiary line-through')}>
                <span className="font-medium">{i.file_name || (i.source === 'csv' ? 'CSV' : t('weekendPasted'))}</span>
                <span className="ml-2 text-xs text-text-tertiary">
                  {formDate(i.created_at, lang)} · {i.created_by_name}
                </span>
                <span className="mt-0.5 block text-xs text-text-secondary">
                  {t('weekendImportStats')
                    .replace('{new}', String(i.stats.new ?? 0))
                    .replace('{recognized}', String(i.stats.recognized ?? 0))
                    .replace('{manual}', String(i.stats.manual ?? 0))
                    .replace('{skipped}', String(i.stats.skipped ?? 0))}
                </span>
              </li>
            ))}
          </ul>
          {lastImport && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
              <p className="min-w-0 flex-1 text-xs text-text-tertiary">{t('weekendUndoHint')}</p>
              <Button variant="secondary" className="h-8 px-3" onClick={() => void undoLast()}>
                <RotateCcw size={14} />
                {t('weekendUndoImport')}
              </Button>
            </div>
          )}
        </details>
      )}

      {importing && (
        <ImportDialog
          weekendId={weekend.id}
          members={members}
          onClose={() => setImporting(false)}
          onDone={async (stats) => {
            setImporting(false);
            await load();
            void reloadWeekend();
            toast.show(
              t('weekendImportStats')
                .replace('{new}', String(stats.new ?? 0))
                .replace('{recognized}', String(stats.recognized ?? 0))
                .replace('{manual}', String(stats.manual ?? 0))
                .replace('{skipped}', String(stats.skipped ?? 0)),
            );
          }}
        />
      )}

      <AddDialog
        open={adding}
        weekendId={weekend.id}
        projectId={project.id}
        members={members}
        onClose={() => setAdding(false)}
        onAdded={async () => {
          setAdding(false);
          await load();
          void reloadWeekend();
        }}
      />

      <ResolveDialog
        participant={resolving}
        members={members}
        listed={participants.filter((p) => p.kind !== 'pending')}
        onClose={() => setResolving(null)}
        onDone={async () => {
          setResolving(null);
          await load();
          void reloadWeekend();
        }}
      />

      <Modal open={undoResult != null} title={t('weekendUndoImport')} onClose={() => setUndoResult(null)}>
        {undoResult && (
          <div className="space-y-3 text-sm">
            <p>{t('weekendUndoRemoved').replace('{n}', String(undoResult.removed))}</p>
            {undoResult.kept.length > 0 && (
              <>
                <p className="text-text-secondary">{t('weekendUndoKept')}</p>
                <ul className="space-y-1">
                  {undoResult.kept.map((k) => (
                    <li key={k.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-subtle px-2.5 py-1.5">
                      <span>{k.name}</span>
                      <span className="text-xs text-text-tertiary">{k.reason === 'room' ? t('weekendKeptRoom') : t('weekendKeptChanged')}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </Modal>
      <Toast toast={toast.toast} onClose={toast.hide} />
    </div>
  );
};

// Lines of names and/or emails (separated by line breaks, commas or
// semicolons); a part naming one of the project's groups is the group.
const parsePasted = (text: string, groups: string[]) =>
  text
    .split(/\r?\n/)
    .flatMap((line) => (/[;,\t]/.test(line) && !line.includes('@') && line.split(/[;,]/).length > 2 ? line.split(/[;,]/) : [line]))
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[;,\t]/).map((p) => p.trim()).filter(Boolean);
      const email = parts.find((p) => p.includes('@')) ?? '';
      const group = parts.find((p) => groups.some((g) => g.toLowerCase() === p.toLowerCase())) ?? '';
      const name = parts.filter((p) => p !== email && p !== group).join(' ');
      return { name, email, group, booking: '' };
    });

// The CSV delimiters to choose from ('' = detected).
const DELIMITERS: { value: string; label: TranslationKey }[] = [
  { value: ';', label: 'delimiterSemicolon' },
  { value: ',', label: 'delimiterComma' },
  { value: '\t', label: 'delimiterTab' },
  { value: '|', label: 'delimiterPipe' },
];

const CSV_PREVIEW_ROWS = 5;

type Assignment = Record<WeekendMapTarget, number | null>;

// The usual column names of a booked period.
const BOOKING_HEADERS = ['zeitraum', 'buchung', 'gebucht', 'nächte', 'naechte', 'übernacht', 'period', 'booking', 'nights', 'ajanjakso', 'yöt'];

const guessWeekendAssignment = (headers: string[]): Assignment => {
  const base = guessAssignment(headers);
  const taken = new Set(Object.values(base).filter((v): v is number => v != null));
  const booking = headers.findIndex((h, i) => !taken.has(i) && BOOKING_HEADERS.some((n) => h.toLowerCase().includes(n)));
  return { ...base, booking: booking >= 0 ? booking : null };
};

// The lines of a CSV by its column assignment: a full name, or first and
// last name; email, group and the booked period.
const csvEntries = (rows: string[][], a: Assignment) =>
  rows
    .map((r) => {
      const cell = (col: number | null) => (col == null ? '' : (r[col] ?? '').trim());
      return {
        name: cell(a.full_name) || [cell(a.first_name), cell(a.last_name)].filter(Boolean).join(' '),
        email: cell(a.email),
        group: cell(a.group_name),
        booking: cell(a.booking),
      };
    })
    .filter((e) => e.name || e.email);

const ImportDialog = ({
  weekendId,
  members,
  onClose,
  onDone,
}: {
  weekendId: string;
  members: MemberOption[];
  onClose: () => void;
  onDone: (stats: Record<string, number>) => void;
}) => {
  const { t } = useI18n();
  const { names: groups } = useProjectGroups();
  const [source, setSource] = useState<'csv' | 'paste'>('csv');
  const [pasted, setPasted] = useState('');
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  // '' = detected from the file.
  const [delimiter, setDelimiter] = useState('');
  const [firstRowHeader, setFirstRowHeader] = useState(true);
  const [assignment, setAssignment] = useState<Assignment>(guessWeekendAssignment([]));
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => (file ? parseCsv(file.text, firstRowHeader, delimiter || undefined) : { headers: [], rows: [] }),
    [file, firstRowHeader, delimiter],
  );
  // Guess the columns again whenever they change (another file or delimiter).
  useEffect(() => setAssignment(guessWeekendAssignment(parsed.headers)), [parsed.headers]);
  const mapped = assignment.full_name != null || assignment.first_name != null || assignment.last_name != null || assignment.email != null;
  const detected = file ? DELIMITERS.find((d) => d.value === detectDelimiter(file.text)) : undefined;

  const entries = useMemo(
    () => (source === 'csv' ? (mapped ? csvEntries(parsed.rows, assignment) : []) : parsePasted(pasted, groups)),
    [source, mapped, parsed.rows, assignment, pasted, groups],
  );

  // Assigning an attribute moves it to this column; a column holds one.
  const assign = (column: number, target: WeekendMapTarget | null) =>
    setAssignment((current) => {
      const next = { ...current };
      for (const key of Object.keys(next) as WeekendMapTarget[]) if (next[key] === column) next[key] = null;
      if (target) next[target] = column;
      return next;
    });

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await api.rpc('weekend_import_preview', { p_weekend_id: weekendId, p_entries: entries });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    const rows = data as PreviewRow[];
    setPreview(rows);
    // Sure ones are linked, the rest stay open until decided.
    setDecisions(
      Object.fromEntries(
        rows.map((r) => [
          r.index,
          r.status === 'sure' && r.match
            ? ({ action: 'link', member_id: r.match.member_id, user_id: r.match.user_id } as Decision)
            : r.status === 'existing'
              ? ({ action: 'skip' } as Decision)
              : ({ action: 'pending' } as Decision),
        ]),
      ),
    );
  };

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    const rows = preview.map((r) => {
      const d = decisions[r.index];
      if (r.status === 'existing') return { entry: r.entry, action: 'existing' };
      const manual = r.status !== 'sure' && d.action !== 'pending';
      return d.action === 'link'
        ? { entry: r.entry, action: 'link', member_id: d.member_id, user_id: d.user_id, manual }
        : { entry: r.entry, action: d.action, manual: manual && d.action !== 'skip' };
    });
    const { data, error: rpcError } = await api.rpc('weekend_import_apply', {
      p_weekend_id: weekendId,
      p_source: source,
      p_file_name: source === 'csv' ? (file?.name ?? null) : null,
      p_rows: rows,
    });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    onDone((data as { stats: Record<string, number> }).stats);
  };

  const section = (status: PreviewRow['status'], title: TranslationKey, hint: TranslationKey) => {
    const rows = preview?.filter((r) => r.status === status) ?? [];
    if (rows.length === 0) return null;
    return (
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
          {t(title)} ({rows.length})
        </h3>
        <p className="mb-2 text-xs text-text-tertiary">{t(hint)}</p>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {rows.map((r) => (
            <PreviewLine
              key={r.index}
              row={r}
              members={members}
              decision={decisions[r.index]}
              onChange={(d) => setDecisions((all) => ({ ...all, [r.index]: d }))}
            />
          ))}
        </ul>
      </section>
    );
  };

  return (
    <Modal
      open
      size="3xl"
      title={t('weekendImport')}
      onClose={onClose}
      footer={
        preview ? (
          <>
            <Button variant="secondary" onClick={() => setPreview(null)}>
              {t('back')}
            </Button>
            <Button onClick={() => void apply()} disabled={busy}>
              {t('weekendImportApply')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button onClick={() => void runPreview()} disabled={busy || entries.length === 0}>
              {t('weekendImportPreview')} ({entries.length})
            </Button>
          </>
        )
      }
    >
      {!preview ? (
        <div className="space-y-4">
          <div className="flex rounded-lg bg-surface-muted p-0.5 sm:max-w-sm">
            {(
              [
                ['csv', FileUp, 'weekendImportFromCsv'],
                ['paste', ClipboardPaste, 'weekendImportFromPaste'],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={source === id}
                onClick={() => setSource(id)}
                className={cn(
                  'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm',
                  source === id ? 'bg-surface font-medium shadow-sm' : 'text-text-secondary',
                )}
              >
                <Icon size={14} />
                {t(label)}
              </button>
            ))}
          </div>

          {source === 'csv' ? (
            <>
              <FileDropzone
                accept=".csv,.txt,text/csv,text/plain"
                fileName={file?.name}
                onFile={async (f) => setFile({ name: f.name, text: await f.text() })}
                hint={t('dropzoneCsvHint')}
              />
              {file && (
                <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                  <div className="w-56">
                    <Select label={t('csvDelimiter')} value={delimiter} onChange={(e) => setDelimiter(e.target.value)}>
                      <option value="">
                        {t('delimiterAuto').replace('{d}', detected ? t(detected.label) : t('delimiterComma'))}
                      </option>
                      {DELIMITERS.map((d) => (
                        <option key={d.label} value={d.value}>
                          {t(d.label)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <label className="flex h-10 cursor-pointer select-none items-center gap-2 text-sm text-text-secondary">
                    <input type="checkbox" checked={firstRowHeader} onChange={(e) => setFirstRowHeader(e.target.checked)} />
                    {t('firstRowHeader')}
                  </label>
                </div>
              )}
              {file &&
                (parsed.headers.length === 0 ? (
                  <p className="text-sm text-text-secondary">{t('emptyCsv')}</p>
                ) : (
                  <div>
                    <h3 className="mb-1 text-sm font-semibold">{t('mapColumns')}</h3>
                    <p className="mb-3 text-xs text-text-tertiary">{t('mapColumnsVisualHint')}</p>
                    <ColumnMapper
                      headers={parsed.headers}
                      rows={parsed.rows.slice(0, CSV_PREVIEW_ROWS)}
                      assignment={assignment}
                      onAssign={assign}
                      options={WEEKEND_TARGETS}
                    />
                    {parsed.rows.length > CSV_PREVIEW_ROWS && (
                      <p className="mt-2 text-xs text-text-tertiary">
                        {t('andMore').replace('{n}', String(parsed.rows.length - CSV_PREVIEW_ROWS))}
                      </p>
                    )}
                    {!mapped && <p className="mt-2 text-sm text-danger">{t('weekendMapNameOrEmail')}</p>}
                    {mapped && assignment.booking == null && <p className="mt-2 text-xs text-text-tertiary">{t('weekendMapBookingHint')}</p>}
                  </div>
                ))}
            </>
          ) : (
            <Textarea
              label={t('weekendImportPaste')}
              placeholder={t('weekendImportPastePlaceholder')}
              rows={8}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      ) : (
        <div className="space-y-5">
          {section('sure', 'weekendSure', 'weekendSureHint')}
          {section('confirm', 'weekendConfirm', 'weekendConfirmHint')}
          {section('unknown', 'weekendUnknown', 'weekendUnknownHint')}
          {preview.some((r) => r.status === 'existing') && (
            <p className="text-sm text-text-secondary">
              {t('weekendAlreadyListed').replace('{n}', String(preview.filter((r) => r.status === 'existing').length))}
            </p>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}
    </Modal>
  );
};

// One imported line in the preview, with what should happen to it.
const PreviewLine = ({
  row,
  members,
  decision,
  onChange,
}: {
  row: PreviewRow;
  members: MemberOption[];
  decision: Decision;
  onChange: (d: Decision) => void;
}) => {
  const { t } = useI18n();
  const value =
    decision.action === 'link' ? `link:${decision.member_id ?? ''}:${decision.user_id ?? ''}` : decision.action;
  const candidateValue = (c: Candidate) => `link:${c.member_id ?? ''}:${c.user_id ?? ''}`;
  const others = members.filter((m) => !row.candidates.some((c) => c.member_id === m.id));
  return (
    <li className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center">
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{row.entry.name || row.entry.email}</span>
          {row.entry.booking && (
            <span className="flex-shrink-0 rounded bg-surface-muted px-1.5 py-px text-[10px] font-semibold text-text-secondary">{row.entry.booking}</span>
          )}
        </span>
        <span className="block truncate text-xs text-text-tertiary">
          {[row.entry.name ? row.entry.email : '', row.entry.group].filter(Boolean).join(' · ')}
          {row.status === 'sure' && row.match && ` → ${row.match.name}${row.match.group_name ? ` (${row.match.group_name})` : ''}`}
        </span>
      </span>
      <select
        value={value}
        aria-label={t('weekendDecision')}
        onChange={(e) => {
          const v = e.target.value;
          if (v.startsWith('link:')) {
            const [, memberId, userId] = v.split(':');
            onChange({ action: 'link', member_id: memberId || null, user_id: userId || null });
          } else onChange({ action: v as 'guest' | 'new_member' | 'pending' | 'skip' });
        }}
        className="h-9 rounded-md border border-border bg-white px-2 pr-8 text-sm sm:w-64"
      >
        {row.candidates.map((c) => (
          <option key={candidateValue(c)} value={candidateValue(c)}>
            {c.name}
            {c.group_name ? ` · ${c.group_name}` : ''}
            {c.status === 'account' ? ` · ${t('personHasAccount')}` : c.status === 'archived' ? ` · ${t('archived')}` : ''}
          </option>
        ))}
        <option value="pending">{t('weekendKeepOpen')}</option>
        <option value="guest">{t('weekendAsGuest')}</option>
        <option value="new_member">{t('weekendAsNewMember')}</option>
        <option value="skip">{t('weekendSkip')}</option>
        {others.length > 0 && (
          <optgroup label={t('weekendOtherMember')}>
            {others.map((m) => (
              <option key={m.id} value={`link:${m.id}:`}>
                {m.first_name} {m.last_name}
                {m.group_name ? ` · ${m.group_name}` : ''}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </li>
  );
};

const AddDialog = ({
  open,
  weekendId,
  projectId,
  members,
  onClose,
  onAdded,
}: {
  open: boolean;
  weekendId: string;
  projectId: string;
  members: MemberOption[];
  onClose: () => void;
  onAdded: () => void;
}) => {
  const { t } = useI18n();
  const [memberId, setMemberId] = useState('');
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [guest, setGuest] = useState({ name: '', email: '' });
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setError(null);
    const calls = [
      ...(memberId ? [{ p_member_id: memberId }] : []),
      ...people.map((p) => (p.member ? { p_member_id: p.member.id } : { p_user_id: p.id })),
      ...(guest.name.trim() ? [{ p_name: guest.name.trim(), p_email: guest.email.trim() }] : []),
    ];
    for (const args of calls) {
      const { error: rpcError } = await api.rpc('weekend_add_participant', { p_weekend_id: weekendId, ...args });
      if (rpcError) return setError(rpcError.message);
    }
    setMemberId('');
    setPeople([]);
    setGuest({ name: '', email: '' });
    onAdded();
  };
  return (
    <Modal
      open={open}
      title={t('weekendAddParticipant')}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void add()} disabled={!memberId && people.length === 0 && !guest.name.trim()}>
            {t('add')}
          </Button>
        </>
      }
    >
      <Select label={t('weekendFromMembers')} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
        <option value="">—</option>
        {members
          .filter((m) => m.status === 'active')
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.first_name} {m.last_name}
              {m.group_name ? ` · ${m.group_name}` : ''}
            </option>
          ))}
      </Select>
      <div>
        <p className="mb-1.5 text-sm font-medium">{t('weekendFromAccounts')}</p>
        <PersonPicker projectId={projectId} value={people} onChange={setPeople} label={t('weekendFromAccounts')} />
      </div>
      <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
        <Input label={t('weekendGuestName')} value={guest.name} maxLength={200} onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
        <Input type="email" label={`${t('email')} (${t('optional')})`} value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} />
      </div>
      <p className="text-xs text-text-tertiary">{t('weekendGuestHint')}</p>
      {error && <p className="text-sm text-danger">{error}</p>}
    </Modal>
  );
};

// Signed up on the shared link (imports never bring a key or an account).
const viaLink = (p: WeekendParticipant) => p.kind === 'pending' && Boolean(p.guest_key_hash || p.user_id);

const ResolveDialog = ({
  participant,
  members,
  listed,
  onClose,
  onDone,
}: {
  participant: WeekendParticipant | null;
  members: MemberOption[];
  listed: WeekendParticipant[];
  onClose: () => void;
  onDone: () => void;
}) => {
  const { t } = useI18n();
  const [choice, setChoice] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setChoice('');
    setError(null);
  }, [participant]);
  if (!participant) return null;
  const resolve = async () => {
    setError(null);
    const args =
      choice === 'guest' || choice === 'new_member' || choice === 'confirm'
        ? { p_action: choice }
        : choice.startsWith('merge:')
          ? { p_action: 'merge', p_target_id: choice.slice('merge:'.length) }
          : { p_action: 'link', p_member_id: choice };
    const { error: rpcError } = await api.rpc('weekend_resolve_participant', { p_participant_id: participant.id, ...args });
    if (rpcError) {
      return setError(
        rpcError.code === 'already_listed' ? t('weekendAlreadyOnList') : rpcError.code === 'two_accounts' ? t('weekendMergeTwoAccounts') : rpcError.message,
      );
    }
    onDone();
  };
  return (
    <Modal
      open
      title={t('weekendResolve')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void resolve()} disabled={!choice}>
            {t('save')}
          </Button>
        </>
      }
    >
      <p className="text-sm">
        <span className="font-medium">{participant.source_name || participant.name}</span>
        {participant.email && <span className="text-text-secondary"> · {participant.email}</span>}
      </p>
      {viaLink(participant) && <p className="text-xs text-text-tertiary">{t('weekendSignedUpViaLinkHint')}</p>}
      <Select label={t('weekendDecision')} value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">—</option>
        {participant.user_id && <option value="confirm">{t('weekendConfirmAccount')}</option>}
        {listed.length > 0 && (
          <optgroup label={t('weekendMergeInto')}>
            {listed.map((p) => (
              <option key={p.id} value={`merge:${p.id}`}>
                {p.name}
                {p.group_name ? ` · ${p.group_name}` : ''}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label={t('weekendLinkMember')}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.first_name} {m.last_name}
              {m.group_name ? ` · ${m.group_name}` : ''}
            </option>
          ))}
        </optgroup>
        {!participant.user_id && <option value="guest">{t('weekendAsGuest')}</option>}
        <option value="new_member">{t('weekendAsNewMember')}</option>
      </Select>
      {error && <p className="text-sm text-danger">{error}</p>}
    </Modal>
  );
};

// The booked period of an entry, changeable by hand: one of the weekend's
// periods, or none (the whole weekend). Nights chosen on the shared link
// show as such.
const BookingSelect = ({
  participant,
  labels,
  onChange,
}: {
  participant: WeekendParticipant;
  labels: string[];
  onChange: (booking: string | null) => void;
}) => {
  const { t } = useI18n();
  const chosen =
    participant.night_from != null && participant.night_to != null
      ? `${nightsLabel([participant.night_from, participant.night_to], t('weekendNight'))} · ${t('weekendViaLink')}`
      : null;
  const label = chosen ?? participant.booking ?? t('weekendBookingWhole');
  return (
    <label
      className={cn(
        'relative inline-flex h-7 max-w-full cursor-pointer items-center gap-1.5 rounded-full pl-2 pr-2.5 text-xs',
        chosen || participant.booking ? 'bg-surface-muted font-medium text-text-secondary' : 'text-text-tertiary hover:bg-surface-subtle',
      )}
      title={label}
    >
      <CalendarRange size={12} className="flex-shrink-0" />
      <span className="truncate">{label}</span>
      <select
        value={chosen ? '__chosen' : (participant.booking ?? '')}
        aria-label={`${t('weekendBooking')}: ${participant.name}`}
        onChange={(e) => onChange(e.target.value || null)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {chosen && (
          <option value="__chosen" disabled>
            {chosen}
          </option>
        )}
        <option value="">{t('weekendBookingWhole')}</option>
        {labels.map((label) => (
          <option key={label} value={label}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
};
