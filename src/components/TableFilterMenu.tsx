import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Search, X } from 'lucide-react';
import type { FilterDef } from './DataTable';
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

// Search and filters of a DataTable collapsed into one icon button with a
// popover, for page headers. A dot on the button marks a search or a filter
// that differs from its default, so a narrowed list never goes unnoticed.
export const TableFilterMenu = ({
  query,
  onQueryChange,
  filters: allFilters = [],
  placeholder,
  onReset,
  canReset = false,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  filters?: FilterMenuFilter[];
  placeholder?: string;
  // Extra state to clear on reset (e.g. a pinned row) and whether it is set.
  onReset?: () => void;
  canReset?: boolean;
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
      const width = Math.min(320, window.innerWidth - 2 * gutter);
      const left = Math.min(Math.max(rect.right - width, gutter), window.innerWidth - gutter - width);
      const top = rect.bottom + 8;
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
  const modified =
    query.trim() !== '' || filters.some((f) => f.value !== (f.defaultValue ?? ''));

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
    onQueryChange('');
    for (const f of filters) f.onChange(f.defaultValue ?? '');
    onReset?.();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={t('searchAndFilter')}
        title={t('searchAndFilter')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-md border transition-colors duration-150',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1',
          open ? 'border-black bg-surface-muted text-text' : 'border-border bg-white text-text-secondary hover:bg-surface-muted hover:text-text',
        )}
      >
        <Search size={16} />
        {modified && (
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-bg bg-accent" />
        )}
      </button>

      {open && (
        <div
          style={position}
          className="fixed z-30 overflow-y-auto overscroll-contain rounded-md border border-border bg-surface p-3 shadow-lg"
        >
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
            />
            <input
              autoFocus
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setOpen(false);
              }}
              placeholder={placeholder ?? t('search')}
              className="w-full rounded-md border border-border bg-white py-2 pl-9 pr-8 text-base placeholder:text-text-tertiary focus:border-black focus:outline-none sm:text-sm"
            />
            {query && (
              <button
                type="button"
                aria-label={t('clearFilters')}
                onClick={() => onQueryChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-tertiary hover:text-text"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {filters.map((f) => (
            <div key={f.id} className="mt-3">
              <p className="mb-1.5 text-xs font-medium text-text-secondary">{f.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {[{ value: '', label: t('all') }, ...f.options].map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={f.value === o.value}
                    onClick={() => f.onChange(o.value)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-sm font-medium transition-colors duration-150',
                      f.value === o.value
                        ? 'border-black bg-black text-white'
                        : 'border-border bg-white text-text-secondary hover:text-text',
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {(modified || canReset) && (
            <div className="mt-3 border-t border-border pt-2">
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1.5 py-1 text-sm font-medium text-text-tertiary transition-colors duration-150 hover:text-text"
              >
                <X size={14} />
                {t('clearFilters')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
