import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarX2, ClipboardCopy, FileDown, FileText, Plus, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column, type FilterDef } from '@/components/DataTable';
import { Input, Select } from '@/components/Input';
import { PageHeader } from '@/components/PageHeader';
import { PageSpinner } from '@/components/Spinner';
import { useProjectContext } from '@/layouts/projectContext';
import { useI18n } from '@/lib/i18n';
import {
  createAbsencesCsv,
  createAbsencesPdf,
  downloadBlob,
  type AbsenceExportLabels,
  type AbsenceExportRow,
} from '@/lib/absenceExports';
import {
  loadProjectMemberAttendance,
  type AttendanceCounts,
} from '@/lib/memberAttendance';
import type { Member } from '@/types';

type Metric = keyof AttendanceCounts;
type Comparison = 'gte' | 'gt' | 'eq' | 'lt' | 'lte';
type Connector = 'and' | 'or';

interface Condition {
  id: string;
  connector: Connector;
  metric: Metric;
  comparison: Comparison;
  value: number;
}

interface ResultRow {
  member: Member;
  counts: AttendanceCounts;
}

const getResultRowId = (row: ResultRow) => row.member.id;
const searchResultRow = (row: ResultRow) =>
  `${row.member.first_name} ${row.member.last_name} ${row.member.group_name ?? ''} ${row.member.email ?? ''}`;

const filenamePart = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'projekt';

let nextConditionId = 1;
const createCondition = (): Condition => ({
  id: `condition-${nextConditionId++}`,
  connector: 'and',
  metric: 'absent',
  comparison: 'gte',
  value: 1,
});

const compare = (actual: number, comparison: Comparison, expected: number) => {
  if (comparison === 'gte') return actual >= expected;
  if (comparison === 'gt') return actual > expected;
  if (comparison === 'eq') return actual === expected;
  if (comparison === 'lt') return actual < expected;
  return actual <= expected;
};

// AND binds more tightly than OR: A OR B AND C is evaluated as A OR (B AND C).
const matchesConditions = (counts: AttendanceCounts, conditions: Condition[]) => {
  if (conditions.length === 0) return true;

  const groups: Condition[][] = [[]];
  for (const [index, condition] of conditions.entries()) {
    if (index > 0 && condition.connector === 'or') groups.push([]);
    groups[groups.length - 1].push(condition);
  }
  return groups.some((group) =>
    group.every((condition) => compare(counts[condition.metric], condition.comparison, condition.value)),
  );
};

export const AbsencesPage = () => {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [visibleRows, setVisibleRows] = useState<ResultRow[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportMessage, setExportMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadProjectMemberAttendance(project.id).then(({ members, countsByMember }) => {
      if (cancelled) return;
      setRows(
        members.map((member) => ({
          member,
          counts: countsByMember[member.id] ?? { attended: 0, excused: 0, absent: 0 },
        })),
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const matchingRows = useMemo(
    () => rows.filter((row) => matchesConditions(row.counts, conditions)),
    [conditions, rows],
  );
  const groups = useMemo(
    () =>
      [...new Set(rows.map((row) => row.member.group_name).filter((group): group is string => Boolean(group)))].sort(
        (left, right) => left.localeCompare(right),
      ),
    [rows],
  );
  const columns = useMemo<Column<ResultRow>[]>(
    () => [
      {
        id: 'name',
        header: t('name'),
        accessor: (row) => `${row.member.last_name} ${row.member.first_name}`,
        render: (row) => (
          <div className="flex items-center gap-2.5">
            <Avatar
              name={`${row.member.first_name} ${row.member.last_name}`}
              photoUrl={row.member.photo_url}
              size={28}
            />
            <span>{row.member.first_name} {row.member.last_name}</span>
            {row.member.status === 'archived' ? (
              <span className="rounded-md border border-border px-1.5 py-0.5 text-xs text-text-tertiary">
                {t('archived')}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: 'group',
        header: t('group'),
        accessor: (row) => row.member.group_name,
        render: (row) => <span className="text-text-secondary">{row.member.group_name ?? '—'}</span>,
      },
      {
        id: 'email',
        header: t('email'),
        accessor: (row) => row.member.email,
        render: (row) => <span className="text-text-secondary">{row.member.email ?? '—'}</span>,
      },
      {
        id: 'attended',
        header: t('attended'),
        accessor: (row) => row.counts.attended,
        render: (row) => <span className="font-medium text-[#16803b]">{row.counts.attended}</span>,
        className: 'w-px text-center whitespace-nowrap',
      },
      {
        id: 'excused',
        header: t('excused'),
        accessor: (row) => row.counts.excused,
        render: (row) => <span className="font-medium text-text-secondary">{row.counts.excused}</span>,
        className: 'w-px text-center whitespace-nowrap',
      },
      {
        id: 'absent',
        header: t('notAttended'),
        accessor: (row) => row.counts.absent,
        render: (row) => <span className="font-medium text-text-secondary">{row.counts.absent}</span>,
        className: 'w-px text-center whitespace-nowrap',
      },
    ],
    [t],
  );
  const filters = useMemo<FilterDef<ResultRow>[]>(
    () => [
      {
        id: 'status',
        label: t('status'),
        defaultValue: 'active',
        options: [
          { value: 'active', label: t('active') },
          { value: 'archived', label: t('archived') },
        ],
        predicate: (row, value) => row.member.status === value,
      },
      {
        id: 'group',
        label: t('group'),
        options: groups.map((group) => ({ value: group, label: group })),
        predicate: (row, value) => row.member.group_name === value,
      },
    ],
    [groups, t],
  );
  const exportLabels = useMemo<AbsenceExportLabels>(
    () => ({
      title: `${t('absences')} - ${project.name}`,
      name: t('name'),
      group: t('group'),
      attended: t('attended'),
      excused: t('excused'),
      absent: t('notAttended'),
    }),
    [project.name, t],
  );
  const exportRows = useMemo<AbsenceExportRow[]>(
    () =>
      visibleRows.map((row) => ({
        name: `${row.member.first_name} ${row.member.last_name}`,
        group: row.member.group_name ?? '',
        attended: row.counts.attended,
        excused: row.counts.excused,
        absent: row.counts.absent,
      })),
    [visibleRows],
  );

  const updateCondition = (id: string, patch: Partial<Condition>) => {
    setConditions((current) =>
      current.map((condition) => (condition.id === id ? { ...condition, ...patch } : condition)),
    );
  };

  const baseFilename = `fehlzeiten-${filenamePart(project.name)}`;
  const downloadCsv = () => {
    downloadBlob(
      new Blob([createAbsencesCsv(exportLabels, exportRows)], { type: 'text/csv;charset=utf-8' }),
      `${baseFilename}.csv`,
    );
  };
  const downloadPdf = async () => {
    setExportingPdf(true);
    setExportMessage('');
    try {
      downloadBlob(await createAbsencesPdf(exportLabels, exportRows), `${baseFilename}.pdf`);
    } catch {
      setExportMessage(t('exportError'));
    } finally {
      setExportingPdf(false);
    }
  };
  const copyNames = async () => {
    try {
      await navigator.clipboard.writeText(exportRows.map((row) => row.name).join('\n'));
      setExportMessage(t('nameListCopied'));
    } catch {
      setExportMessage(t('exportError'));
    }
  };

  if (loading) return <PageSpinner />;

  return (
    <>
      <PageHeader
        title={t('absences')}
        subtitle={`${matchingRows.length} ${t('matchingMembers').toLowerCase()}`}
      />

      <Card className="mb-8">
        <div className="mb-5">
          <h2 className="font-semibold">{t('absenceConditions')}</h2>
          <p className="mt-1 text-sm text-text-secondary">{t('absenceConditionsHint')}</p>
        </div>

        <div className="space-y-3">
          {conditions.map((condition, index) => (
            <div
              key={condition.id}
              className="grid items-end gap-2 border-b border-border pb-3 last:border-b-0 sm:grid-cols-[110px_minmax(140px,1fr)_minmax(150px,1fr)_110px_36px]"
            >
              {index === 0 ? (
                <div className="pb-2 text-sm font-medium text-text-secondary">{t('when')}</div>
              ) : (
                <Select
                  aria-label={`${t('and')} / ${t('or')}`}
                  value={condition.connector}
                  onChange={(event) =>
                    updateCondition(condition.id, { connector: event.target.value as Connector })
                  }
                >
                  <option value="and">{t('and')}</option>
                  <option value="or">{t('or')}</option>
                </Select>
              )}

              <Select
                label={t('conditionMetric')}
                value={condition.metric}
                onChange={(event) =>
                  updateCondition(condition.id, { metric: event.target.value as Metric })
                }
              >
                <option value="attended">{t('attended')}</option>
                <option value="excused">{t('excused')}</option>
                <option value="absent">{t('notAttended')}</option>
              </Select>

              <Select
                label={t('comparison')}
                value={condition.comparison}
                onChange={(event) =>
                  updateCondition(condition.id, { comparison: event.target.value as Comparison })
                }
              >
                <option value="gte">≥ {t('atLeast')}</option>
                <option value="gt">&gt; {t('moreThan')}</option>
                <option value="eq">= {t('exactly')}</option>
                <option value="lt">&lt; {t('lessThan')}</option>
                <option value="lte">≤ {t('atMost')}</option>
              </Select>

              <Input
                type="number"
                min={0}
                step={1}
                label={t('count')}
                value={condition.value}
                onChange={(event) =>
                  updateCondition(condition.id, {
                    value: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                  })
                }
              />

              <button
                type="button"
                aria-label={t('remove')}
                onClick={() =>
                  setConditions((current) => current.filter((item) => item.id !== condition.id))
                }
                className="mb-0.5 flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-[#f0f0f0] hover:text-text"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => setConditions((current) => [...current, createCondition()])}
        >
          <Plus size={16} />
          {t('addCondition')}
        </Button>
      </Card>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t('matchingMembers')}</h2>
          <p className="mt-1 text-sm text-text-secondary">
            {visibleRows.length} {t('matchingMembers').toLowerCase()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={visibleRows.length === 0} onClick={downloadCsv}>
            <FileDown size={16} />
            {t('downloadCsv')}
          </Button>
          <Button
            variant="secondary"
            disabled={visibleRows.length === 0 || exportingPdf}
            onClick={downloadPdf}
          >
            <FileText size={16} />
            {exportingPdf ? t('loading') : t('downloadPdf')}
          </Button>
          <Button variant="secondary" disabled={visibleRows.length === 0} onClick={copyNames}>
            <ClipboardCopy size={16} />
            {t('copyNameList')}
          </Button>
        </div>
      </div>
      {exportMessage ? (
        <p className="mb-4 text-sm text-text-secondary" role="status">{exportMessage}</p>
      ) : null}

      <DataTable
        rows={matchingRows}
        columns={columns}
        getRowId={getResultRowId}
        onRowClick={(row) => navigate(`/projects/${project.id}/members/${row.member.id}`)}
        search={searchResultRow}
        filters={filters}
        emptyMessage={t('noAbsenceResults')}
        emptyIcon={CalendarX2}
        onVisibleRowsChange={setVisibleRows}
      />
    </>
  );
};
