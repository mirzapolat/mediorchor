import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bookmark,
  CalendarX2,
  ClipboardCopy,
  FileDown,
  FileText,
  GripVertical,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column, type FilterDef } from '@/components/DataTable';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { PageHeader } from '@/components/PageHeader';
import { PageSpinner } from '@/components/Spinner';
import { useDragReorder } from '@/hooks/useDragReorder';
import { useProjectContext } from '@/layouts/projectContext';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import {
  matchesConditions,
  type Comparison,
  type Connector,
  type Metric,
  type StoredCondition,
} from '@/lib/absenceConditions';
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
import { api } from '@/lib/api';
import type { AbsenceLabel, Member } from '@/types';
import { useProjectGroups } from '@/hooks/useProjectGroups';
import { GroupPill } from '@/components/GroupPill';

// Editor rows carry a client-side id on top of the stored shape.
interface Condition extends StoredCondition {
  id: string;
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

// Strips editor ids so only the stored shape is persisted.
const toStoredConditions = (conditions: Condition[]): StoredCondition[] =>
  conditions.map(({ connector, metric, comparison, value }) => ({
    connector,
    metric,
    comparison,
    value,
  }));

// Manage saved labels: drag to reorder, toggle public, delete. Every change
// persists immediately.
const LabelSettingsModal = ({
  open,
  labels,
  onClose,
  onChanged,
}: {
  open: boolean;
  labels: AbsenceLabel[];
  onClose: () => void;
  onChanged: (labels: AbsenceLabel[]) => void;
}) => {
  const { t } = useI18n();

  const reorder = async (next: AbsenceLabel[]) => {
    onChanged(next.map((label, index) => ({ ...label, position: index })));
    await Promise.all(
      next.map((label, index) =>
        api.from('absence_labels').update({ position: index }).eq('id', label.id),
      ),
    );
  };

  const dnd = useDragReorder(labels, (label) => label.id, reorder, 8);

  const togglePublic = async (label: AbsenceLabel) => {
    const next = !label.is_public;
    onChanged(labels.map((l) => (l.id === label.id ? { ...l, is_public: next } : l)));
    await api.from('absence_labels').update({ is_public: next }).eq('id', label.id);
  };

  const remove = async (label: AbsenceLabel) => {
    onChanged(labels.filter((l) => l.id !== label.id));
    await api.from('absence_labels').delete().eq('id', label.id);
  };

  return (
    <Modal open={open} title={t('manageLabels')} onClose={onClose}>
      {labels.length === 0 ? (
        <p className="text-sm text-text-secondary">{t('noLabels')}</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-text-secondary mb-3">{t('publicLabelHint')}</p>
          {labels.map((label, index) => {
            const dragging = dnd.isDragging(label.id);
            return (
              <div
                key={label.id}
                ref={(el) => dnd.setItemRef(label.id, el)}
                style={
                  dnd.dragActive
                    ? {
                        transform: `translateY(${dnd.shiftFor(index)}px)`,
                        transition: dragging ? 'none' : 'transform 150ms ease',
                        position: dragging ? 'relative' : undefined,
                        zIndex: dragging ? 10 : undefined,
                      }
                    : undefined
                }
                className={cn(
                  'flex items-center gap-2 rounded-md border border-border px-2 py-2',
                  dragging && 'bg-surface shadow-lg',
                )}
              >
                <button
                  type="button"
                  aria-label={t('reorder')}
                  onPointerDown={(e) => dnd.startDrag(e, label.id, index)}
                  onPointerMove={dnd.moveDrag}
                  onPointerUp={dnd.endDrag}
                  onPointerCancel={dnd.endDrag}
                  style={{ touchAction: 'none' }}
                  className={cn(
                    'flex h-8 w-6 flex-shrink-0 items-center justify-center rounded text-text-tertiary hover:text-text-secondary',
                    labels.length < 2 ? 'invisible' : 'cursor-grab active:cursor-grabbing',
                  )}
                >
                  <GripVertical size={16} />
                </button>
                <span className="flex-1 truncate font-medium">{label.name}</span>
                <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-black"
                    checked={label.is_public}
                    onChange={() => togglePublic(label)}
                  />
                  {t('publicLabel')}
                </label>
                <button
                  type="button"
                  aria-label={t('delete')}
                  onClick={() => remove(label)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-[#f0f0f0] hover:text-text"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
};

export const AbsencesPage = () => {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const { names: groups } = useProjectGroups();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [visibleRows, setVisibleRows] = useState<ResultRow[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [labels, setLabels] = useState<AbsenceLabel[]>([]);
  const [activeLabelId, setActiveLabelId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [labelName, setLabelName] = useState('');
  const [labelPublic, setLabelPublic] = useState(false);
  const [savingLabel, setSavingLabel] = useState(false);
  const [labelSettingsOpen, setLabelSettingsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      loadProjectMemberAttendance(project.id),
      api
        .from('absence_labels')
        .select('*')
        .eq('project_id', project.id)
        .order('position')
        .order('created_at'),
    ]).then(([{ members, countsByMember }, labelsResult]) => {
      if (cancelled) return;
      setRows(
        members.map((member) => ({
          member,
          counts: countsByMember[member.id] ?? { attended: 0, excused: 0, absent: 0 },
        })),
      );
      setLabels((labelsResult.data as AbsenceLabel[]) ?? []);
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
        render: (row) => <GroupPill name={row.member.group_name} />,
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
    setActiveLabelId(null);
    setConditions((current) =>
      current.map((condition) => (condition.id === id ? { ...condition, ...patch } : condition)),
    );
  };

  // Load a saved label into the condition editor.
  const applyLabel = (label: AbsenceLabel) => {
    setActiveLabelId(label.id);
    setConditions(label.conditions.map((c) => ({ ...c, id: `condition-${nextConditionId++}` })));
  };

  const saveLabel = async (e: FormEvent) => {
    e.preventDefault();
    setSavingLabel(true);
    const { data } = await api
      .from('absence_labels')
      .insert({
        project_id: project.id,
        name: labelName.trim(),
        conditions: toStoredConditions(conditions),
        is_public: labelPublic,
        position: labels.length,
      })
      .select('*')
      .single();
    setSavingLabel(false);
    setSaveOpen(false);
    setLabelName('');
    setLabelPublic(false);
    if (data) {
      setLabels((current) => [...current, data as AbsenceLabel]);
      setActiveLabelId((data as AbsenceLabel).id);
    }
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

      {/* Quick access: saved condition presets */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {labels.map((label) => (
          <button
            key={label.id}
            type="button"
            onClick={() => applyLabel(label)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors duration-150',
              activeLabelId === label.id
                ? 'border-text bg-text text-white'
                : 'border-border text-text-secondary hover:text-text hover:bg-[#f5f5f5]',
            )}
          >
            <Bookmark size={13} />
            {label.name}
          </button>
        ))}
        <button
          type="button"
          aria-label={t('manageLabels')}
          title={t('manageLabels')}
          onClick={() => setLabelSettingsOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-secondary transition-colors duration-150 hover:bg-[#f5f5f5] hover:text-text"
        >
          <Settings2 size={15} />
        </button>
      </div>

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
                onClick={() => {
                  setActiveLabelId(null);
                  setConditions((current) => current.filter((item) => item.id !== condition.id));
                }}
                className="mb-0.5 flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-[#f0f0f0] hover:text-text"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setActiveLabelId(null);
              setConditions((current) => [...current, createCondition()]);
            }}
          >
            <Plus size={16} />
            {t('addCondition')}
          </Button>
          <Button
            variant="secondary"
            disabled={conditions.length === 0}
            onClick={() => setSaveOpen(true)}
          >
            <Bookmark size={16} />
            {t('saveAsLabel')}
          </Button>
        </div>
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

      <Modal
        open={saveOpen}
        title={t('saveAsLabel')}
        onClose={() => setSaveOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSaveOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="save-label-form" disabled={savingLabel || !labelName.trim()}>
              {savingLabel ? t('loading') : t('save')}
            </Button>
          </>
        }
      >
        <form id="save-label-form" onSubmit={saveLabel} className="space-y-4">
          <Input
            label={t('labelName')}
            value={labelName}
            onChange={(e) => setLabelName(e.target.value)}
            maxLength={80}
            required
            autoFocus
          />
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-black"
              checked={labelPublic}
              onChange={(e) => setLabelPublic(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium">{t('publicLabel')}</span>
              <span className="mt-0.5 block text-sm text-text-secondary">
                {t('publicLabelHint')}
              </span>
            </span>
          </label>
        </form>
      </Modal>

      <LabelSettingsModal
        open={labelSettingsOpen}
        labels={labels}
        onClose={() => setLabelSettingsOpen(false)}
        onChanged={setLabels}
      />
    </>
  );
};
