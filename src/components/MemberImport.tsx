import { useEffect, useMemo, useState } from 'react';
import { Upload, FileText } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Select } from './Input';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { parseCsv } from '@/lib/csv';
import { splitName } from '@/lib/accountName';

interface MemberImportProps {
  open: boolean;
  projectId: string;
  // The project's current groups (single source of truth).
  groups: string[];
  onClose: () => void;
  onSaved: () => void;
}

type TargetField = 'first_name' | 'last_name' | 'group_name' | 'email';

const NONE = '';

const TARGET_FIELDS: TargetField[] = ['first_name', 'last_name', 'group_name', 'email'];

const LABEL_KEYS: Record<TargetField, 'firstName' | 'lastName' | 'group' | 'email'> = {
  first_name: 'firstName',
  last_name: 'lastName',
  group_name: 'group',
  email: 'email',
};

type NameMode = 'split' | 'combined';

// How a group that isn't in the project yet is handled: create it, drop it, or
// (any other value) assign the rows to that existing group.
const CREATE_GROUP = '__create__';
const DROP_GROUP = '__none__';

// Fields mapped column-by-column regardless of the chosen name mode.
const OTHER_FIELDS: TargetField[] = ['group_name', 'email'];

// Best-effort match of a CSV header to a target field by common substrings.
const guessColumn = (headers: string[], needles: string[]): string => {
  const idx = headers.findIndex((h) =>
    needles.some((n) => h.toLowerCase().includes(n)),
  );
  return idx >= 0 ? String(idx) : NONE;
};

const guessMapping = (headers: string[]): Record<TargetField, string> => ({
  first_name: guessColumn(headers, ['vorname', 'first', 'given']),
  last_name: guessColumn(headers, ['nachname', 'last', 'surname', 'familien']),
  group_name: guessColumn(headers, ['gruppe', 'group', 'team', 'klasse']),
  email: guessColumn(headers, ['mail']),
});

// A column that looks like a full name (contains "name" but not a first/last
// qualifier), used as the default when the combined name mode is selected.
const guessFullNameColumn = (headers: string[]): string => {
  const idx = headers.findIndex((h) => {
    const l = h.toLowerCase();
    return (
      l.includes('name') &&
      !['vor', 'nach', 'first', 'last', 'sur', 'given', 'familien'].some((q) => l.includes(q))
    );
  });
  return idx >= 0 ? String(idx) : NONE;
};

export const MemberImport = ({ open, projectId, groups, onClose, onSaved }: MemberImportProps) => {
  const { t } = useI18n();
  const [fileName, setFileName] = useState<string | null>(null);
  const [firstRowHeader, setFirstRowHeader] = useState(true);
  const [rawText, setRawText] = useState<string>('');
  const [nameMode, setNameMode] = useState<NameMode>('split');
  const [mapping, setMapping] = useState<Record<TargetField, string>>(guessMapping([]));
  const [fullNameCol, setFullNameCol] = useState<string>(NONE);
  const [groupActions, setGroupActions] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset everything whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setFileName(null);
      setFirstRowHeader(true);
      setRawText('');
      setNameMode('split');
      setMapping(guessMapping([]));
      setFullNameCol(NONE);
      setGroupActions({});
      setImporting(false);
      setError(null);
    }
  }, [open]);

  const parsed = useMemo(
    () => (rawText ? parseCsv(rawText, firstRowHeader) : { headers: [], rows: [] }),
    [rawText, firstRowHeader],
  );

  // Re-guess the mapping whenever the parsed headers change.
  useEffect(() => {
    if (parsed.headers.length) {
      setMapping(guessMapping(parsed.headers));
      setFullNameCol(guessFullNameColumn(parsed.headers));
    }
  }, [parsed.headers]);

  const handleFile = async (file: File) => {
    setError(null);
    const text = await file.text();
    setFileName(file.name);
    setRawText(text);
  };

  const colValue = (row: string[], col: string): string =>
    col === NONE ? '' : (row[Number(col)] ?? '').trim();

  const cellValue = (row: string[], field: TargetField): string =>
    colValue(row, mapping[field]);

  // Resolve a row's first/last name honouring the chosen name mode.
  const namesOf = (row: string[]): { first: string; last: string } =>
    nameMode === 'combined'
      ? splitName(colValue(row, fullNameCol))
      : { first: cellValue(row, 'first_name'), last: cellValue(row, 'last_name') };

  // A row is importable when it yields at least a first name. In split mode the
  // last name is required too; in combined mode single-token names are allowed.
  const isValid = (row: string[]): boolean => {
    const { first, last } = namesOf(row);
    return nameMode === 'combined' ? Boolean(first) : Boolean(first && last);
  };

  const requiredMapped =
    nameMode === 'combined'
      ? fullNameCol !== NONE
      : mapping.first_name !== NONE && mapping.last_name !== NONE;

  const validRows = useMemo(
    () => parsed.rows.filter(isValid),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parsed.rows, mapping, fullNameCol, nameMode],
  );

  // Existing group matching a CSV value, ignoring case ("sopran" → "Sopran").
  const existingGroup = (value: string): string | undefined =>
    groups.find((g) => g.toLowerCase() === value.toLowerCase());

  // CSV groups the project doesn't have yet, in order of first appearance
  // (case variants collapse onto the first spelling seen).
  const unknownGroups = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of validRows) {
      const g = cellValue(r, 'group_name');
      if (g && !existingGroup(g) && !seen.has(g.toLowerCase())) seen.set(g.toLowerCase(), g);
    }
    return [...seen.values()];
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [validRows, groups],
  );

  const resolveGroup = (value: string): string | null => {
    if (!value) return null;
    const existing = existingGroup(value);
    if (existing) return existing;
    const spelling =
      unknownGroups.find((g) => g.toLowerCase() === value.toLowerCase()) ?? value;
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
      const { error: groupsError } = await api
        .from('projects')
        .update({ groups: [...groups, ...created] })
        .eq('id', projectId);
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
        group_name: resolveGroup(cellValue(r, 'group_name')),
        email: cellValue(r, 'email') || null,
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

  const previewRows = validRows.slice(0, 5);

  return (
    <Modal
      open={open}
      title={t('importMembers')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            onClick={runImport}
            disabled={importing || !requiredMapped || validRows.length === 0}
          >
            {importing ? t('importing') : t('import')}
          </Button>
        </>
      }
    >
      <label className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary border border-border rounded-md px-3 py-2 cursor-pointer hover:bg-[#f5f5f5] transition-colors duration-150">
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
        <>
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={firstRowHeader}
              onChange={(e) => setFirstRowHeader(e.target.checked)}
            />
            {t('firstRowHeader')}
          </label>

          {parsed.headers.length === 0 ? (
            <p className="text-sm text-text-secondary">{t('emptyCsv')}</p>
          ) : (
            <>
              <div>
                <h3 className="text-sm font-semibold mb-2">{t('nameFormat')}</h3>
                <div className="space-y-1.5">
                  {(['split', 'combined'] as NameMode[]).map((mode) => (
                    <label
                      key={mode}
                      className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none"
                    >
                      <input
                        type="radio"
                        name="name-mode"
                        checked={nameMode === mode}
                        onChange={() => setNameMode(mode)}
                      />
                      {mode === 'split' ? t('nameSeparate') : t('nameCombined')}
                    </label>
                  ))}
                </div>
                {nameMode === 'combined' && (
                  <p className="text-xs text-text-tertiary mt-2">{t('nameCombinedHint')}</p>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-1">{t('mapColumns')}</h3>
                <p className="text-xs text-text-tertiary mb-3">{t('mapColumnsHint')}</p>
                <div className="space-y-3">
                  {nameMode === 'combined' ? (
                    <Select
                      label={t('fullName')}
                      value={fullNameCol}
                      onChange={(e) => setFullNameCol(e.target.value)}
                    >
                      <option value={NONE}>{t('notMapped')}</option>
                      {parsed.headers.map((h, i) => (
                        <option key={i} value={String(i)}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    (['first_name', 'last_name'] as TargetField[]).map((field) => (
                      <Select
                        key={field}
                        label={t(LABEL_KEYS[field])}
                        value={mapping[field]}
                        onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}
                      >
                        <option value={NONE}>{t('notMapped')}</option>
                        {parsed.headers.map((h, i) => (
                          <option key={i} value={String(i)}>
                            {h || `Column ${i + 1}`}
                          </option>
                        ))}
                      </Select>
                    ))
                  )}
                  {OTHER_FIELDS.map((field) => (
                    <Select
                      key={field}
                      label={`${t(LABEL_KEYS[field])} (${t('optional')})`}
                      value={mapping[field]}
                      onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}
                    >
                      <option value={NONE}>{t('notMapped')}</option>
                      {parsed.headers.map((h, i) => (
                        <option key={i} value={String(i)}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </Select>
                  ))}
                </div>
              </div>

              {requiredMapped && unknownGroups.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-1">{t('newGroupsInImport')}</h3>
                  <p className="text-xs text-text-tertiary mb-3">{t('newGroupsInImportHint')}</p>
                  <div className="space-y-3">
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
                  <h3 className="text-sm font-semibold mb-1">{t('preview')}</h3>
                  <p className="text-xs text-text-tertiary mb-2">
                    {t('rowsReadyToImport')
                      .replace('{n}', String(validRows.length))
                      .replace('{total}', String(parsed.rows.length))}
                  </p>
                  {previewRows.length > 0 ? (
                    <div className="border border-border rounded-md overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-[#f5f5f5] text-text-secondary">
                          <tr>
                            {TARGET_FIELDS.map((f) => (
                              <th key={f} className="text-left font-medium px-2 py-1.5">
                                {t(LABEL_KEYS[f])}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewRows.map((r, i) => {
                            const { first, last } = namesOf(r);
                            const preview: Record<TargetField, string> = {
                              first_name: first,
                              last_name: last,
                              group_name: resolveGroup(cellValue(r, 'group_name')) ?? '',
                              email: cellValue(r, 'email'),
                            };
                            return (
                              <tr key={i} className="border-t border-border">
                                {TARGET_FIELDS.map((f) => (
                                  <td key={f} className="px-2 py-1.5 text-text-secondary">
                                    {preview[f] || '—'}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-text-secondary">{t('noRowsToImport')}</p>
                  )}
                  {validRows.length > previewRows.length && (
                    <p className="text-xs text-text-tertiary mt-2">
                      {t('andMore').replace(
                        '{n}',
                        String(validRows.length - previewRows.length),
                      )}
                    </p>
                  )}
                  <p className="text-xs text-text-tertiary mt-2">{t('rowsSkippedHint')}</p>
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </>
      )}
    </Modal>
  );
};
