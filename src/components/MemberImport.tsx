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

export const MemberImport = ({ open, projectId, groups, onClose, onSaved }: MemberImportProps) => {
  const { t } = useI18n();
  const [fileName, setFileName] = useState<string | null>(null);
  const [firstRowHeader, setFirstRowHeader] = useState(true);
  const [rawText, setRawText] = useState<string>('');
  const [assignment, setAssignment] = useState<Assignment>(EMPTY);
  const [groupActions, setGroupActions] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset everything whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setFileName(null);
      setFirstRowHeader(true);
      setRawText('');
      setAssignment(EMPTY);
      setGroupActions({});
      setImporting(false);
      setError(null);
    }
  }, [open]);

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

  const runImport = async () => {
    if (!validRows.length) return;
    setImporting(true);
    setError(null);
    const created = unknownGroups.filter((g) => (groupActions[g] ?? CREATE_GROUP) === CREATE_GROUP);
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
        return;
      }
    }
    const payloads = validRows.map((r) => {
      const { first, last } = namesOf(r);
      return {
        project_id: projectId,
        first_name: first,
        last_name: last,
        group_name: resolveGroup(value(r, 'group_name')),
        email: value(r, 'email') || null,
        photo_url: null,
      };
    });
    const { error: insertError } = await api.from('members').insert(payloads);
    setImporting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    onSaved();
    onClose();
  };

  const resultRows = validRows.slice(0, 3);

  return (
    <Modal
      open={open}
      size="3xl"
      title={t('importMembers')}
      onClose={onClose}
      footer={
        <>
          {requiredMapped && parsed.rows.length > 0 && (
            <span className="mr-auto text-sm text-text-secondary">
              {t('rowsReadyToImport')
                .replace('{n}', String(validRows.length))
                .replace('{total}', String(parsed.rows.length))}
            </span>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={runImport} disabled={importing || !requiredMapped || validRows.length === 0}>
            {importing ? t('importing') : t('import')}
          </Button>
        </>
      }
    >
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
    </Modal>
  );
};
