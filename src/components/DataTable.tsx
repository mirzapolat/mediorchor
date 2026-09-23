import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowUpDown, ChevronDown, ChevronUp, ChevronsUpDown, GripVertical, X, type LucideIcon } from 'lucide-react';
import { Input, Select } from './Input';
import { EmptyState } from './EmptyState';
import { useDragReorder } from '@/hooks/useDragReorder';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

export interface Column<T> {
  id: string;
  header: string;
  // Value used for sorting and, when no `render` is given, for the cell text.
  accessor?: (row: T) => string | number | null;
  render?: (row: T) => ReactNode;
  sortable?: boolean; // defaults to true when an accessor is provided
  className?: string;
}

export interface FilterDef<T> {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  predicate: (row: T, value: string) => boolean;
  defaultValue?: string;
  // Controlled mode: the caller owns the value (e.g. a chart selects it too).
  value?: string;
  onChange?: (value: string) => void;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  // Limits onRowClick to specific rows (others get no pointer/hover styling).
  rowClickable?: (row: T) => boolean;
  actions?: (row: T) => ReactNode;
  search?: (row: T) => string;
  searchPlaceholder?: string;
  filters?: FilterDef<T>[];
  emptyMessage: string;
  emptyIcon?: LucideIcon;
  onVisibleRowsChange?: (rows: T[]) => void;
  // Row id pinned to the top and visually highlighted (e.g. the next event).
  highlightRowId?: string | null;
  // Called when the user resets filters, so callers can also clear any pin.
  onClearFilters?: () => void;
  // Enables a leading checkbox column. Selection is controlled by the caller.
  selectedIds?: string[];
  onSelectedIdsChange?: (ids: string[]) => void;
  // Enables drag & drop row reordering via a leading grip column. Column
  // sorting is disabled in this mode (the manual order is the order).
  onReorder?: (rows: T[]) => void;
  // Extra controls at the right end of the search/filter row.
  toolbar?: ReactNode;
  // Controlled search text, for pages that render search elsewhere (e.g. a
  // TableFilterMenu in the page header) together with hideToolbar.
  query?: string;
  hideToolbar?: boolean;
}

type SortDir = 'asc' | 'desc';

const compare = (a: string | number | null, b: string | number | null): number => {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls sort last
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
};

const formatValue = (v: string | number | null | undefined): ReactNode =>
  v == null || v === '' ? '—' : v;

// Generic sortable / searchable / filterable table that implements the design
// system's lined-table style. Used by every "database" view in the app.
export function DataTable<T>({
  rows,
  columns,
  getRowId,
  onRowClick,
  rowClickable,
  actions,
  search,
  searchPlaceholder,
  filters = [],
  emptyMessage,
  emptyIcon,
  onVisibleRowsChange,
  highlightRowId,
  onClearFilters,
  selectedIds,
  onSelectedIdsChange,
  onReorder,
  toolbar,
  query: controlledQuery,
  hideToolbar = false,
}: DataTableProps<T>) {
  const { t } = useI18n();
  const reorderable = Boolean(onReorder);
  const [ownQuery, setQuery] = useState('');
  const query = controlledQuery ?? ownQuery;
  const [sortId, setSortId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [ownFilterValues, setOwnFilterValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(filters.map((f) => [f.id, f.defaultValue ?? ''])),
  );
  const filterValues: Record<string, string> = { ...ownFilterValues };
  for (const f of filters) if (f.value !== undefined) filterValues[f.id] = f.value;
  const setFilterValue = (f: FilterDef<T>, value: string) => {
    if (f.onChange) f.onChange(value);
    else setOwnFilterValues((s) => ({ ...s, [f.id]: value }));
  };

  const processed = useMemo(() => {
    let out = rows;
    for (const f of filters) {
      const v = filterValues[f.id] ?? '';
      if (v) out = out.filter((r) => f.predicate(r, v));
    }
    const q = query.trim().toLowerCase();
    if (q && search) out = out.filter((r) => search(r).toLowerCase().includes(q));
    if (sortId && !reorderable) {
      const col = columns.find((c) => c.id === sortId);
      if (col?.accessor) {
        const acc = col.accessor;
        out = [...out].sort((a, b) => {
          const r = compare(acc(a), acc(b));
          return sortDir === 'asc' ? r : -r;
        });
      }
    }
    // Pin the highlighted row to the very top, regardless of sort order.
    if (highlightRowId) {
      const pinned = out.filter((r) => getRowId(r) === highlightRowId);
      if (pinned.length > 0) {
        out = [...pinned, ...out.filter((r) => getRowId(r) !== highlightRowId)];
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, filters, JSON.stringify(filterValues), query, search, sortId, sortDir, highlightRowId, getRowId, reorderable]);

  useEffect(() => {
    onVisibleRowsChange?.(processed);
  }, [onVisibleRowsChange, processed]);

  const dnd = useDragReorder(processed, getRowId, onReorder ?? (() => undefined));

  // Click cycles: none → asc → desc → none.
  const toggleSort = (id: string) => {
    if (sortId !== id) {
      setSortId(id);
      setSortDir('asc');
    } else if (sortDir === 'asc') {
      setSortDir('desc');
    } else {
      setSortId(null);
    }
  };

  const hasToolbar = !hideToolbar && (Boolean(search) || filters.length > 0 || Boolean(toolbar));
  const hasActiveFilters =
    query.trim() !== '' ||
    filters.some((f) => (filterValues[f.id] ?? '') !== '') ||
    Boolean(highlightRowId);

  const clearAll = () => {
    setQuery('');
    for (const f of filters) setFilterValue(f, '');
    onClearFilters?.();
  };

  const selectable = Boolean(onSelectedIdsChange);
  const selectedSet = new Set(selectedIds ?? []);
  const allVisibleSelected =
    processed.length > 0 && processed.every((r) => selectedSet.has(getRowId(r)));
  const someVisibleSelected = processed.some((r) => selectedSet.has(getRowId(r)));

  const toggleAll = () => {
    if (!onSelectedIdsChange) return;
    const visibleIds = processed.map(getRowId);
    if (allVisibleSelected) {
      const visible = new Set(visibleIds);
      onSelectedIdsChange((selectedIds ?? []).filter((id) => !visible.has(id)));
    } else {
      onSelectedIdsChange([...new Set([...(selectedIds ?? []), ...visibleIds])]);
    }
  };

  const toggleRow = (id: string) => {
    if (!onSelectedIdsChange) return;
    const next = new Set(selectedIds ?? []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedIdsChange([...next]);
  };

  return (
    <>
      {hasToolbar && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          {search && (
            <div className="w-full sm:w-64">
              <Input
                placeholder={searchPlaceholder ?? t('search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          {filters.map((f) => (
            <div key={f.id} className="min-w-[150px]">
              <Select
                label={f.label}
                value={filterValues[f.id] ?? ''}
                onChange={(e) => setFilterValue(f, e.target.value)}
              >
                <option value="">{t('all')}</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          ))}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAll}
              title={t('clearFilters')}
              className="inline-flex items-center gap-1.5 px-2 py-2 text-sm font-medium text-text-tertiary hover:text-text transition-colors duration-150"
            >
              <X size={15} />
              {t('clearFilters')}
            </button>
          )}
          {toolbar && <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>}
        </div>
      )}

      {processed.length === 0 ? (
        <EmptyState icon={emptyIcon} message={emptyMessage} />
      ) : (
        <div className="border border-border rounded-md overflow-x-auto bg-surface">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="bg-[#f5f5f5] text-sm font-medium text-text-secondary text-left">
                {reorderable && (
                  <th className="w-px border-b border-r border-border px-2 py-3">
                    <ArrowUpDown size={14} className="mx-auto text-text-tertiary" aria-label={t('reorder')} />
                  </th>
                )}
                {selectable && (
                  <th className="w-px border-b border-r border-border px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={t('all')}
                      className="block accent-black"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                      }}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                {columns.map((c) => {
                  const sortable = !reorderable && (c.sortable ?? Boolean(c.accessor));
                  const active = sortId === c.id;
                  return (
                    <th
                      key={c.id}
                      className={cn('border-b border-r border-border px-4 py-3', c.className)}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(c.id)}
                          className="inline-flex items-center gap-1.5 font-medium hover:text-text transition-colors duration-150"
                        >
                          {c.header}
                          {active ? (
                            sortDir === 'asc' ? (
                              <ChevronUp size={14} />
                            ) : (
                              <ChevronDown size={14} />
                            )
                          ) : (
                            <ChevronsUpDown size={14} className="text-text-tertiary" />
                          )}
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
                {actions && (
                  <th className="border-b border-border px-4 py-3 text-right">{t('actions')}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {processed.map((row, rowIndex) => {
                const rowId = getRowId(row);
                const highlighted = highlightRowId != null && rowId === highlightRowId;
                const selected = selectedSet.has(rowId);
                const dragging = reorderable && dnd.isDragging(rowId);
                const clickable = Boolean(onRowClick) && (rowClickable?.(row) ?? true);
                return (
                <tr
                  key={rowId}
                  ref={reorderable ? (el) => dnd.setItemRef(rowId, el) : undefined}
                  style={
                    // Only style rows while a drag is active: a permanent
                    // position/transform would create a stacking context that
                    // paints hover backgrounds over the collapsed cell borders.
                    reorderable && dnd.dragActive
                      ? {
                          transform: `translateY(${dnd.shiftFor(rowIndex)}px)`,
                          transition: dragging ? 'none' : 'transform 150ms ease',
                          position: dragging ? 'relative' : undefined,
                          zIndex: dragging ? 10 : undefined,
                        }
                      : undefined
                  }
                  className={cn(
                    'text-base',
                    dragging
                      ? 'bg-white shadow-lg'
                      : selected
                        ? 'bg-[#eff6ff] hover:bg-[#e3eeff]'
                        : highlighted
                          ? 'bg-[#f0fdf4] hover:bg-[#e3f8ea]'
                          : clickable && 'hover:bg-[#fcfcfc]',
                    clickable && 'cursor-pointer transition-colors duration-150',
                  )}
                  onClick={clickable && onRowClick ? () => onRowClick(row) : undefined}
                >
                  {reorderable && (
                    <td
                      className="w-px border-b border-r border-border px-2 py-3 align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        aria-label={t('reorder')}
                        onPointerDown={(e) => dnd.startDrag(e, rowId, rowIndex)}
                        onPointerMove={dnd.moveDrag}
                        onPointerUp={dnd.endDrag}
                        onPointerCancel={dnd.endDrag}
                        style={{ touchAction: 'none' }}
                        className={cn(
                          'flex h-8 w-6 items-center justify-center rounded text-text-tertiary hover:text-text-secondary',
                          processed.length < 2 ? 'invisible' : 'cursor-grab active:cursor-grabbing',
                        )}
                      >
                        <GripVertical size={16} />
                      </button>
                    </td>
                  )}
                  {selectable && (
                    <td
                      className="w-px border-b border-r border-border px-4 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        aria-label={t('status')}
                        className="block accent-black"
                        checked={selected}
                        onChange={() => toggleRow(rowId)}
                      />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td
                      key={c.id}
                      className={cn('border-b border-r border-border px-4 py-3', c.className)}
                    >
                      {c.render ? c.render(row) : formatValue(c.accessor?.(row))}
                    </td>
                  ))}
                  {actions && (
                    <td
                      className="border-b border-border px-4 py-3 align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">{actions(row)}</div>
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
