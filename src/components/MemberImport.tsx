import { useEffect, useMemo, useState } from 'react';
import { Upload, FileText } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Select } from './Input';
import { GroupPill } from './GroupPill';
import { ColumnMapper, MAP_TARGETS, type MapTarget } from './FieldMapper';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { parseCsv } from '@/lib/csv';
import { splitName } from '@/lib/accountName';
import { paletteColor } from '@/lib/groupColors';
import { findMatchingMember, samePerson, type PersonLike } from '@/lib/memberMatching';
import type { Member } from '@/types';

interface MemberImportProps {
  open: boolean;
  projectId: string;
  // The project's current groups (single source of truth).
  groups: string[];
  onClose: () => void;
  onSaved: () => void;
}

type Assignment = Record<MapTarget, number | null>;

const EMPTY: Assignment = { first_name: null, last_name: null, full_name: null, email: null, group_name: null };

// How a group that isn't in the project yet is handled: create it, drop it, or
// (any other value) assign the rows to that existing group.
const CREATE_GROUP = '__create__';
const DROP_GROUP = '__none__';

const PREVIEW_ROWS = 5;
const DUPLICATE_PREVIEW = 5;

// What happens to rows matching someone the project already has.
type DuplicateAction = 'skip' | 'update' | 'create';

// Best-effort match of a CSV header to an attribute by common substrings.
const guessColumn = (headers: string[], needles: string[], taken: Set<number>): number | null => {
  const idx = headers.findIndex((h, i) => !taken.has(i) && needles.some((n) => h.toLowerCase().includes(n)));
  return idx >= 0 ? idx : null;
};

const guessAssignment = (headers: string[]): Assignment => {
  const taken = new Set<number>();
  const pick = (needles: string[]) => {
    const col = guessColumn(headers, needles, taken);
    if (col !== null) taken.add(col);
    return col;
  };
  const first_name = pick(['vorname', 'first', 'given']);
  const last_name = pick(['nachname', 'last', 'surname', 'familien']);
  // A "name" column without a first/last qualifier is the full name, used only
  // when first and last name aren't both there.
  let full_name: number | null = null;
  if (first_name === null || last_name === null) {
    const idx = headers.findIndex((h, i) => {
      const l = h.toLowerCase();
      return (
        !taken.has(i) &&
        l.includes('name') &&
        !['vor', 'nach', 'first', 'last', 'sur', 'given', 'familien'].some((q) => l.includes(q))
      );
    });
    if (idx >= 0) {
      full_name = idx;
      taken.add(idx);
    }
  }
  return {
    first_name,
    last_name,
    full_name,
    email: pick(['mail']),
    group_name: pick(['gruppe', 'group', 'team', 'klasse', 'stimme', 'instrument', 'register']),
  };
};

// State and logic of a CSV member import; `active` resets it (e.g. when the
// dialog opens). Shared by the import dialog and the project onboarding.
export const useMemberImport = ({
  active,
  projectId,
  groups,
}: {
  active: boolean;
  // Null for a project that doesn't exist yet (nothing to match against).
  projectId: string | null;
  // The project's current groups (single source of truth).
  groups: string[];
}) => {
  const [fileName, setFileName] = useState<string | null>(null);
  const [firstRowHeader, setFirstRowHeader] = useState(true);
  const [rawText, setRawText] = useState<string>('');
  const [assignment, setAssignment] = useState<Assignment>(EMPTY);
  const [groupActions, setGroupActions] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [duplicateAction, setDuplicateAction] = useState<DuplicateAction>('skip');

  // Reset everything whenever the import is (re)activated.
  useEffect(() => {
    if (active) {
      setMembers([]);
      setDuplicateAction('skip');
      if (projectId) {
        void api
          .from('members')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: true })
          .then(({ data }) => setMembers((data as Member[] | null) ?? []));
      }
      setFileName(null);
      setFirstRowHeader(true);
      setRawText('');
      setAssignment(EMPTY);
      setGroupActions({});
      setImporting(false);
      setError(null);
    }
  }, [active, projectId]);

  const parsed = useMemo(
    () => (rawText ? parseCsv(rawText, firstRowHeader) : { headers: [], rows: [] }),
    [rawText, firstRowHeader],
  );

  // Re-guess the assignment whenever the parsed headers change.
  useEffect(() => {
    if (parsed.headers.length) setAssignment(guessAssignment(parsed.headers));
  }, [parsed.headers]);

  const handleFile = async (file: File) => {
    setError(null);
    const text = await file.text();
    setFileName(file.name);
    setRawText(text);
  };

  // Assigning an attribute moves it to this column; a column holds at most one.
  const assign = (column: number, target: MapTarget | null) => {
    setAssignment((current) => {
      const next = { ...current };
      for (const key of Object.keys(next) as MapTarget[]) if (next[key] === column) next[key] = null;
      if (target) next[target] = column;
      return next;
    });
  };

  const value = (row: string[], target: MapTarget): string => {
    const col = assignment[target];
    return col === null ? '' : (row[col] ?? '').trim();
  };

  // First/last name from their own columns, filled from a full-name column
  // (split at the last space) where missing.
  const namesOf = (row: string[]): { first: string; last: string } => {
    const full = splitName(value(row, 'full_name'));
    return {
      first: value(row, 'first_name') || full.first,
      last: value(row, 'last_name') || full.last,
    };
  };

  const hasFullName = assignment.full_name !== null;
  const requiredMapped =
    hasFullName || (assignment.first_name !== null && assignment.last_name !== null);

  // With separate columns both names are required; a full name may be a
  // single token (empty last name).
  const isValid = (row: string[]): boolean => {
    const { first, last } = namesOf(row);
    return hasFullName ? Boolean(first) : Boolean(first && last);
  };

  const validRows = useMemo(
    () => (requiredMapped ? parsed.rows.filter(isValid) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parsed.rows, assignment],
  );

  const personOf = (row: string[]): PersonLike => {
    const { first, last } = namesOf(row);
    return { first_name: first, last_name: last, email: value(row, 'email') || null };
  };

  // Splits the valid rows into new people, people the project already has, and
  // repeats within the file (only the first occurrence of a person counts).
  const plan = useMemo(() => {
    const seen: PersonLike[] = [];
    const fresh: string[][] = [];
    const matched: { row: string[]; member: Member }[] = [];
    let repeated = 0;
    for (const row of validRows) {
      const person = personOf(row);
      if (seen.some((p) => samePerson(p, person))) {
        repeated += 1;
        continue;
      }
      seen.push(person);
      const member = findMatchingMember(person, members);
      if (member) matched.push({ row, member });
      else fresh.push(row);
    }
    return { fresh, matched, repeated };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validRows, members]);

  const toCreate =
    duplicateAction === 'create' ? [...plan.fresh, ...plan.matched.map((m) => m.row)] : plan.fresh;
  const toUpdate = duplicateAction === 'update' ? plan.matched : [];

  // Existing group matching a CSV value, ignoring case ("sopran" → "Sopran").
  const existingGroup = (group: string): string | undefined =>
    groups.find((g) => g.toLowerCase() === group.toLowerCase());

  // CSV groups the project doesn't have yet, in order of first appearance
  // (case variants collapse onto the first spelling seen).
  const unknownGroups = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of validRows) {
      const g = value(r, 'group_name');
      if (g && !existingGroup(g) && !seen.has(g.toLowerCase())) seen.set(g.toLowerCase(), g);
    }
    return [...seen.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validRows, groups]);

  const resolveGroup = (raw: string): string | null => {
    if (!raw) return null;
    const existing = existingGroup(raw);
    if (existing) return existing;
    const spelling = unknownGroups.find((g) => g.toLowerCase() === raw.toLowerCase()) ?? raw;
    const action = groupActions[spelling] ?? CREATE_GROUP;
    if (action === CREATE_GROUP) return spelling;
    if (action === DROP_GROUP) return null;
    return action;
  };

  // Groups to create and members to add, without writing anything.
  const drafts = () => ({
    groups: unknownGroups.filter((g) => (groupActions[g] ?? CREATE_GROUP) === CREATE_GROUP),
    members: toCreate.map((r) => {
      const { first, last } = namesOf(r);
      return {
        first_name: first,
        last_name: last,
        group_name: resolveGroup(value(r, 'group_name')),
        email: value(r, 'email') || null,
      };
    }),
  });

  // Runs the import; resolves to whether it succeeded.
  const runImport = async (): Promise<boolean> => {
    if (!projectId || (!toCreate.length && !toUpdate.length)) return false;
    setImporting(true);
    setError(null);
    const { groups: created, members: newMembers } = drafts();
    if (created.length) {
      const { error: groupsError } = await api.from('project_groups').insert(
        created.map((name, i) => ({
          project_id: projectId,
          name,
          color: paletteColor(groups.length + i),
          position: groups.length + i,
        })),
      );
      if (groupsError) {
        setImporting(false);
        setError(groupsError.message);
        return false;
      }
    }
    const payloads = newMembers.map((m) => ({ ...m, project_id: projectId, photo_url: null }));
    const { error: insertError } = payloads.length
      ? await api.from('members').insert(payloads)
      : { error: null };
    // Updating re-activates the member, takes the file's group when it has one
    // and fills in a missing email; names stay as they are.
    const updateErrors = await Promise.all(
      toUpdate.map(({ row, member }) => {
        const group = resolveGroup(value(row, 'group_name'));
        return api
          .from('members')
          .update({
            status: 'active',
            group_name: group ?? member.group_name,
            email: member.email || value(row, 'email') || null,
          })
          .eq('id', member.id)
          .then(({ error: e }) => e);
      }),
    );
    setImporting(false);
    const failure = insertError ?? updateErrors.find(Boolean);
    if (failure) {
      setError(failure.message);
      return false;
    }
    return true;
  };

  return {
    fileName,
    rawText,
    firstRowHeader,
    setFirstRowHeader,
    handleFile,
    parsed,
    assignment,
    assign,
    value,
    namesOf,
    requiredMapped,
    plan,
    toCreate,
    toUpdate,
    unknownGroups,
    groupActions,
    setGroupActions,
    duplicateAction,
    setDuplicateAction,
    resolveGroup,
    groups,
    canImport: requiredMapped && toCreate.length + toUpdate.length > 0,
    importing,
    error,
    drafts,
    runImport,
  };
};

export type MemberImportState = ReturnType<typeof useMemberImport>;

// What an import will do ("12 of 14 rows ready · 2 to update").
export const MemberImportSummary = ({ imp }: { imp: MemberImportState }) => {
  const { t } = useI18n();
  if (!imp.requiredMapped || imp.parsed.rows.length === 0) return null;
  return (
    <span className="text-sm text-text-secondary">
      {t('rowsReadyToImport')
        .replace('{n}', String(imp.toCreate.length))
        .replace('{total}', String(imp.parsed.rows.length))}
      {imp.toUpdate.length > 0 && ` · ${t('rowsToUpdate').replace('{n}', String(imp.toUpdate.length))}`}
    </span>
  );
};

// File picker, column mapping, group handling, duplicates and preview.
export const MemberImportFields = ({ imp }: { imp: MemberImportState }) => {
  const { t } = useI18n();
  const {
    fileName,
    rawText,
    firstRowHeader,
    setFirstRowHeader,
    handleFile,
    parsed,
    assignment,
    assign,
    value,
    namesOf,
    requiredMapped,
    plan,
    toCreate,
    unknownGroups,
    groupActions,
    setGroupActions,
    duplicateAction,
    setDuplicateAction,
    resolveGroup,
    groups,
    error,
  } = imp;
  const resultRows = toCreate.slice(0, 3);

  return (
    <>
      <div className="flex flex-wrap items-center gap-4">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:bg-[#f5f5f5]">
          {fileName ? <FileText size={15} /> : <Upload size={15} />}
          {fileName ?? t('selectCsvFile')}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </label>
        {rawText && (
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={firstRowHeader}
              onChange={(e) => setFirstRowHeader(e.target.checked)}
            />
            {t('firstRowHeader')}
          </label>
        )}
      </div>

      {rawText &&
        (parsed.headers.length === 0 ? (
          <p className="text-sm text-text-secondary">{t('emptyCsv')}</p>
        ) : (
          <>
            <div>
              <h3 className="mb-1 text-sm font-semibold">{t('mapColumns')}</h3>
              <p className="mb-3 text-xs text-text-tertiary">{t('mapColumnsVisualHint')}</p>
              <ColumnMapper
                headers={parsed.headers}
                rows={parsed.rows.slice(0, PREVIEW_ROWS)}
                assignment={assignment}
                onAssign={assign}
              />
              {parsed.rows.length > PREVIEW_ROWS && (
                <p className="mt-2 text-xs text-text-tertiary">
                  {t('andMore').replace('{n}', String(parsed.rows.length - PREVIEW_ROWS))}
                </p>
              )}
              {!requiredMapped && (
                <p className="mt-2 text-sm text-accent">{t('mapNameRequired')}</p>
              )}
            </div>

            {requiredMapped && unknownGroups.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-semibold">{t('newGroupsInImport')}</h3>
                <p className="mb-3 text-xs text-text-tertiary">{t('newGroupsInImportHint')}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {unknownGroups.map((g) => (
                    <Select
                      key={g}
                      label={g}
                      value={groupActions[g] ?? CREATE_GROUP}
                      onChange={(e) => setGroupActions({ ...groupActions, [g]: e.target.value })}
                    >
                      <option value={CREATE_GROUP}>{t('createNewGroup')}</option>
                      {groups.map((existing) => (
                        <option key={existing} value={existing}>
                          {t('assignToGroup').replace('{group}', existing)}
                        </option>
                      ))}
                      <option value={DROP_GROUP}>{t('removeGroupFromImport')}</option>
                    </Select>
                  ))}
                </div>
              </div>
            )}

            {requiredMapped && (plan.matched.length > 0 || plan.repeated > 0) && (
              <div>
                <h3 className="mb-1 text-sm font-semibold">{t('importDuplicates')}</h3>
                <p className="mb-3 text-xs text-text-tertiary">{t('importDuplicatesHint')}</p>
                {plan.matched.length > 0 && (
                  <>
                    <Select
                      label={t('importExistingMembers').replace('{n}', String(plan.matched.length))}
                      value={duplicateAction}
                      onChange={(e) => setDuplicateAction(e.target.value as DuplicateAction)}
                    >
                      <option value="skip">{t('duplicateSkip')}</option>
                      <option value="update">{t('duplicateUpdate')}</option>
                      <option value="create">{t('duplicateCreate')}</option>
                    </Select>
                    <ul className="mt-2 space-y-1 text-sm">
                      {plan.matched.slice(0, DUPLICATE_PREVIEW).map(({ row, member }, i) => {
                        const { first, last } = namesOf(row);
                        return (
                          <li key={i} className="flex flex-wrap items-center gap-x-2 text-text-secondary">
                            <span className="text-text">
                              {first} {last}
                            </span>
                            <span aria-hidden>→</span>
                            <span>
                              {member.first_name} {member.last_name}
                              {member.email ? ` · ${member.email}` : ''}
                            </span>
                            {member.status !== 'active' && (
                              <span className="text-xs text-text-tertiary">({t('archived')})</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {plan.matched.length > DUPLICATE_PREVIEW && (
                      <p className="mt-1 text-xs text-text-tertiary">
                        {t('andMore').replace('{n}', String(plan.matched.length - DUPLICATE_PREVIEW))}
                      </p>
                    )}
                  </>
                )}
                {plan.repeated > 0 && (
                  <p className="mt-2 text-sm text-text-secondary">
                    {t('importRepeatedRows').replace('{n}', String(plan.repeated))}
                  </p>
                )}
              </div>
            )}

            {requiredMapped && (
              <div>
                <h3 className="mb-1 text-sm font-semibold">{t('importResultPreview')}</h3>
                <p className="mb-2 text-xs text-text-tertiary">{t('rowsSkippedHint')}</p>
                {resultRows.length > 0 ? (
                  <div className="overflow-hidden rounded-md border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-[#f5f5f5] text-text-secondary">
                        <tr>
                          {MAP_TARGETS.filter((m) => m.target !== 'full_name').map((m) => (
                            <th key={m.target} className="px-3 py-1.5 text-left font-medium">
                              {t(m.label)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {resultRows.map((r, i) => {
                          const { first, last } = namesOf(r);
                          return (
                            <tr key={i} className="border-t border-border">
                              <td className="px-3 py-1.5">{first || '—'}</td>
                              <td className="px-3 py-1.5">{last || '—'}</td>
                              <td className="px-3 py-1.5 text-text-secondary">{value(r, 'email') || '—'}</td>
                              <td className="px-3 py-1.5">
                                <GroupPill name={resolveGroup(value(r, 'group_name'))} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-text-secondary">{t('noRowsToImport')}</p>
                )}
              </div>
            )}
          </>
        ))}

      {error && <p className="text-sm text-accent">{error}</p>}
    </>
  );
};

export const MemberImport = ({ open, projectId, groups, onClose, onSaved }: MemberImportProps) => {
  const { t } = useI18n();
  const imp = useMemberImport({ active: open, projectId, groups });

  const runImport = async () => {
    if (!(await imp.runImport())) return;
    onSaved();
    onClose();
  };

  return (
    <Modal
      open={open}
      size="3xl"
      title={t('importMembers')}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto">
            <MemberImportSummary imp={imp} />
          </span>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={runImport} disabled={imp.importing || !imp.canImport}>
            {imp.importing ? t('importing') : t('import')}
          </Button>
        </>
      }
    >
      <MemberImportFields imp={imp} />
    </Modal>
  );
};
