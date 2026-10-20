import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleHelp, FileUp, Plus, RotateCcw, Trash2, Upload, UserRound, UsersRound } from 'lucide-react';
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
import { parseCsv } from '@/lib/csv';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { useProjectGroups } from '@/hooks/useProjectGroups';
import { formDate } from '@/lib/forms';
import { useWeekendContext, type WeekendImport, type WeekendParticipant } from '@/lib/weekends';
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
  entry: { name: string; email: string; group: string };
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
      id: 'room',
      header: t('weekendRoom'),
      accessor: (p) => rooms.get(p.id) ?? '',
      render: (p) => (rooms.get(p.id) ? <span className="truncate">{rooms.get(p.id)}</span> : <span className="text-text-tertiary">—</span>),
      className: 'w-36',
    },
  ];

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

      <DataTable
        variant="modern"
        rows={participants}
        columns={columns}
        getRowId={(p) => p.id}
        search={(p) => `${p.name} ${p.email ?? ''} ${p.source_name ?? ''}`}
        emptyMessage={t('weekendNoParticipants')}
        emptyIcon={UsersRound}
        actions={(p) => (
          <>
            {p.kind === 'pending' && (
              <button
                type="button"
                onClick={() => setResolving(p)}
                className="h-7 rounded-md px-2 text-xs font-medium text-text-secondary hover:bg-surface-hover hover:text-text"
              >
                {t('weekendResolve')}
              </button>
            )}
            <button
              type="button"
              onClick={() => void remove(p)}
              aria-label={`${t('remove')}: ${p.name}`}
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text"
            >
              <Trash2 size={15} />
            </button>
          </>
        )}
      />

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
      return { name, email, group };
    });

// A CSV with headers: name (or first/last name), email, group — matched by
// common column names.
const parseCsvFile = (text: string) => {
  const { headers, rows } = parseCsv(text);
  const find = (re: RegExp) => headers.findIndex((h) => re.test(h.toLowerCase()));
  const full = find(/^(name|teilnehmer|person|nimi)$/);
  const first = find(/vorname|first|etunimi/);
  const last = find(/nachname|last|surname|sukunimi/);
  const email = find(/mail/);
  const group = find(/gruppe|group|stimme|voice|ryhmä/);
  return rows.map((r) => ({
    name: full >= 0 ? r[full] ?? '' : [first >= 0 ? r[first] : '', last >= 0 ? r[last] : ''].join(' ').trim() || r[0] || '',
    email: email >= 0 ? r[email] ?? '' : '',
    group: group >= 0 ? r[group] ?? '' : '',
  }));
};

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
  const [pasted, setPasted] = useState('');
  const [file, setFile] = useState<{ name: string; entries: { name: string; email: string; group: string }[] } | null>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entries = useMemo(() => file?.entries ?? parsePasted(pasted, groups), [file, pasted, groups]);

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
      p_source: file ? 'csv' : 'paste',
      p_file_name: file?.name ?? null,
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
          <Textarea
            label={t('weekendImportPaste')}
            placeholder={t('weekendImportPastePlaceholder')}
            rows={8}
            value={pasted}
            disabled={file != null}
            onChange={(e) => setPasted(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm text-text-secondary hover:bg-surface-muted">
              <FileUp size={15} />
              {t('weekendImportCsv')}
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setFile({ name: f.name, entries: parseCsvFile(await f.text()) });
                }}
              />
            </label>
            {file && (
              <button type="button" onClick={() => setFile(null)} className="text-sm text-text-secondary underline">
                {file.name} · {t('remove')}
              </button>
            )}
          </div>
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
        <span className="block truncate font-medium">{row.entry.name || row.entry.email}</span>
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

const ResolveDialog = ({
  participant,
  members,
  onClose,
  onDone,
}: {
  participant: WeekendParticipant | null;
  members: MemberOption[];
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
      choice === 'guest' || choice === 'new_member'
        ? { p_action: choice }
        : { p_action: 'link', p_member_id: choice };
    const { error: rpcError } = await api.rpc('weekend_resolve_participant', { p_participant_id: participant.id, ...args });
    if (rpcError) return setError(rpcError.code === 'already_listed' ? t('weekendAlreadyOnList') : rpcError.message);
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
      <Select label={t('weekendDecision')} value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">—</option>
        <optgroup label={t('weekendLinkMember')}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.first_name} {m.last_name}
              {m.group_name ? ` · ${m.group_name}` : ''}
            </option>
          ))}
        </optgroup>
        <option value="guest">{t('weekendAsGuest')}</option>
        <option value="new_member">{t('weekendAsNewMember')}</option>
      </Select>
      {error && <p className="text-sm text-danger">{error}</p>}
    </Modal>
  );
};
