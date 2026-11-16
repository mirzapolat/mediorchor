import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronDown, ListFilter, X } from 'lucide-react';
import type { FilterDef } from './DataTable';
import { SearchField } from './SearchField';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

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
//   <DataTable filters={filters} query={tf.query} hideToolbar ... />
// bind is stable while the values are unchanged, so pages that memoize their
// filters (e.g. with onVisibleRowsChange) can memoize the bound ones too. A
// definition that brings its own value/onChange (shared with a chart, say)
// keeps them.
export const useTableFilters = (initial: Record<string, string> = {}) => {
  const [defaults] = useState(initial);
  const [query, setQuery] = useState('');
  const [values, setValues] = useState(initial);
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
  return { query, setQuery, bind };
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
