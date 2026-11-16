import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, ListFilter, X } from 'lucide-react';
import type { FilterDef } from './DataTable';
import { SearchField } from './SearchField';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

// A table's sort order, shared by the DataTable (which sorts and reports
// its sortable columns) and the TableFilterMenu (which offers it on phones,
// behind a button next to "Filter").
export interface SortState {
  id: string;
  dir: 'asc' | 'desc';
}

export interface TableSorting {
  sort: SortState | null;
  setSort: (sort: SortState | null) => void;
  options: Array<{ id: string; label: string }>;
  setOptions: (options: Array<{ id: string; label: string }>) => void;
}

export const useTableSorting = (): TableSorting => {
  const [sort, setSort] = useState<SortState | null>(null);
  const [options, setOptionsState] = useState<Array<{ id: string; label: string }>>([]);
  // Only a real change re-renders (the table reports on every render).
  const setOptions = useCallback(
    (next: Array<{ id: string; label: string }>) =>
      setOptionsState((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next)),
    [],
  );
  return useMemo(() => ({ sort, setSort, options, setOptions }), [sort, options, setOptions]);
};

export interface FilterMenuFilter {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  value: string; // '' = all
  defaultValue?: string;
  onChange: (value: string) => void;
}

// Search text and filter values for a DataTable driven by a TableFilterMenu.
// Call it before any early return; bind() the page's filter definitions later:
//   const tf = useTableFilters({ status: 'active' });
//   const filters = tf.bind(defs);
//   <TableFilterMenu query={tf.query} onQueryChange={tf.setQuery} filters={filters} />
//   <DataTable filters={filters} query={tf.query} sorting={tf.sorting} hideToolbar ... />
// (and `sorting={tf.sorting}` on the TableFilterMenu: the sort button on phones).
// bind is stable while the values are unchanged, so pages that memoize their
// filters (e.g. with onVisibleRowsChange) can memoize the bound ones too. A
// definition that brings its own value/onChange (shared with a chart, say)
// keeps them.
export const useTableFilters = (initial: Record<string, string> = {}) => {
  const [defaults] = useState(initial);
  const [query, setQuery] = useState('');
  const [values, setValues] = useState(initial);
  const sorting = useTableSorting();
  const bind = useCallback(
    <T,>(defs: FilterDef<T>[]): (FilterDef<T> & FilterMenuFilter)[] =>
      defs.map((f) => ({
        ...f,
        defaultValue: defaults[f.id] ?? '',
        value: f.value ?? values[f.id] ?? '',
        onChange: f.onChange ?? ((value: string) => setValues((s) => ({ ...s, [f.id]: value }))),
      })),
    [defaults, values],
  );
  return { query, setQuery, bind, sorting };
};

// Search and filters of a list, as on the files page: an always visible
// search pill and, when there is something to filter, one "Filter" menu
// button. A dot on the button marks a filter that differs from its default,
// so a narrowed list never goes unnoticed.
//
// It renders two siblings (no wrapper), so in a wrapping row (`flex-wrap`)
// the search takes a full-width line of its own on phones
// (`order-last w-full`) and sits inline from `sm` on. Pass `searchClassName`
// to size it differently.
export const TableFilterMenu = ({
  query,
  onQueryChange,
  filters: allFilters = [],
  placeholder,
  onReset,
  canReset = false,
  searchClassName = 'order-last w-full sm:order-none sm:w-56',
  showSearch = true,
  sorting,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  filters?: FilterMenuFilter[];
  placeholder?: string;
  // Extra state to clear on reset (e.g. a pinned row) and whether it is set.
  onReset?: () => void;
  canReset?: boolean;
  searchClassName?: string;
  showSearch?: boolean;
  // Phones: the table's sort order behind a button (desktop sorts by the
  // column headers).
  sorting?: TableSorting;
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Anchor below the button, right-aligned, but clamped into the viewport
  // with a 16px gutter so it never runs off a phone screen.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gutter = 16;
      const width = Math.min(260, window.innerWidth - 2 * gutter);
      const left = Math.min(Math.max(rect.right - width, gutter), window.innerWidth - gutter - width);
      const top = rect.bottom + 6;
      setPosition({ top, left, width, maxHeight: window.innerHeight - top - gutter });
    };
    place();
    // Capture scrolls of any container (the page scrolls inside <main>).
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // A filter without options (e.g. no groups yet) has nothing to choose.
  const filters = allFilters.filter((f) => f.options.length > 0);
  const filtered = filters.some((f) => f.value !== (f.defaultValue ?? ''));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const reset = () => {
    for (const f of filters) f.onChange(f.defaultValue ?? '');
    onReset?.();
  };

  const sectionTitle = 'px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary';
  const row =
    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-surface-muted focus:bg-surface-muted focus:outline-none';

  return (
    <>
      {showSearch && <SearchField value={query} onChange={onQueryChange} placeholder={placeholder} className={searchClassName} />}
      {sorting && sorting.options.length > 0 && <SortMenu sorting={sorting} />}
      {(filters.length > 0 || canReset) && (
        <div ref={rootRef} className="relative">
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={open}
            title={t('filter')}
            className={cn(
              'relative inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium transition-colors duration-150 hover:bg-surface-muted max-sm:w-9 max-sm:px-0',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1',
              open && 'bg-surface-muted',
            )}
          >
            <ListFilter size={16} />
            <span className="hidden sm:inline">{t('filter')}</span>
            <ChevronDown size={15} className={cn('hidden text-text-secondary transition-transform duration-150 sm:inline', open && 'rotate-180')} />
            {(filtered || canReset) && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-bg bg-accent" />
            )}
          </button>

          {open && (
            <div
              role="dialog"
              aria-label={t('filter')}
              style={position}
              className="fixed z-[70] overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-1 shadow-lg"
            >
              {filters.map((f, i) => (
                <div key={f.id}>
                  {i > 0 && <div role="separator" className="-mx-1 my-1 border-t border-border" />}
                  <p className={sectionTitle}>{f.label}</p>
                  {[{ value: '', label: t('all') }, ...f.options].map((o) => {
                    const active = f.value === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => f.onChange(o.value)}
                        className={cn(row, active && 'font-medium')}
                      >
                        <Check size={15} className={cn('flex-shrink-0', active ? 'text-text' : 'invisible')} />
                        <span className="min-w-0 flex-1 truncate" title={o.label}>
                          {o.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}

              {(filtered || canReset) && (
                <>
                  <div role="separator" className="-mx-1 my-1 border-t border-border" />
                  <button type="button" onClick={reset} className={cn(row, 'text-text-secondary')}>
                    <X size={15} />
                    {t('clearFilters')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
};

// Closes on a press outside and on Escape.
const useDismiss = (open: boolean, close: () => void, ref: RefObject<HTMLElement>) => {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, ref]);
};

// Phones only: the sort order as a menu (a second tap on the chosen column
// turns the direction), like the files page's "Sortieren nach".
const SortMenu = ({ sorting }: { sorting: TableSorting }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  useDismiss(open, () => setOpen(false), root);
  useLayoutEffect(() => {
    if (!open) return;
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const gutter = 16;
    const width = Math.min(240, window.innerWidth - 2 * gutter);
    const left = Math.min(Math.max(rect.right - width, gutter), window.innerWidth - gutter - width);
    const top = rect.bottom + 6;
    setPosition({ top, left, width, maxHeight: window.innerHeight - top - gutter });
  }, [open]);
  const { sort, setSort, options } = sorting;
  const row =
    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-surface-muted focus:bg-surface-muted focus:outline-none';
  const Arrow = sort?.dir === 'desc' ? ArrowDown : ArrowUp;
  return (
    <div ref={root} className="relative sm:hidden">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('sortBy')}
        title={t('sortBy')}
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface transition-colors duration-150 hover:bg-surface-muted',
          open && 'bg-surface-muted',
        )}
      >
        <ArrowUpDown size={16} />
        {sort && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-bg bg-accent" />}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('sortBy')}
          style={position}
          className="fixed z-[70] overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('sortBy')}</p>
          <button type="button" aria-pressed={!sort} onClick={() => setSort(null)} className={cn(row, !sort && 'font-medium')}>
            <Check size={15} className={cn('flex-shrink-0', sort ? 'invisible' : 'text-text')} />
            <span className="flex-1">{t('sortDefault')}</span>
          </button>
          {options.map((o) => {
            const active = sort?.id === o.id;
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSort(active ? { id: o.id, dir: sort?.dir === 'asc' ? 'desc' : 'asc' } : { id: o.id, dir: 'asc' })}
                className={cn(row, active && 'font-medium')}
              >
                <Check size={15} className={cn('flex-shrink-0', active ? 'text-text' : 'invisible')} />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {active && <Arrow size={14} className="text-text-secondary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
