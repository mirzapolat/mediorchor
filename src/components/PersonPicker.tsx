import { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Avatar } from './Avatar';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import type { PersonOption } from '@/types';

// Picks accounts (e.g. who looks after a group): the chosen ones as chips,
// below a search over name and email. With a project its active members
// come first and show their group; others with an account can be picked too.
// Keyboard: arrows move through the results, Enter picks, Escape closes.
export const PersonPicker = ({
  projectId,
  value,
  onChange,
  label,
}: {
  projectId: string | null;
  value: PersonOption[];
  onChange: (people: PersonOption[]) => void;
  label: string;
}) => {
  const { t } = useI18n();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Without a project there's nothing to suggest before typing.
    if (!projectId && !query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void api.rpc('search_people', { p_project_id: projectId, p_query: query.trim() }).then(({ data }) => {
        if (cancelled) return;
        setResults((data as PersonOption[] | null) ?? []);
        setActive(0);
        setLoading(false);
      });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, open, projectId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const chosen = new Set(value.map((p) => p.id));
  const options = results.filter((r) => !chosen.has(r.id));

  const pick = (person: PersonOption) => {
    onChange([...value, person]);
    setQuery('');
    setActive(0);
  };

  return (
    <div ref={wrapRef} className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {value.map((p) => (
            <li
              key={p.id}
              className="flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface py-0.5 pl-0.5 pr-1 text-sm"
            >
              <Avatar name={p.name || p.email} photoUrl={p.photo_url} size={22} />
              <span className="min-w-0 truncate">{p.name || p.email}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.id !== p.id))}
                aria-label={`${t('remove')}: ${p.name || p.email}`}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-text-tertiary hover:bg-surface-hover hover:text-text"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={label}
          placeholder={t('personSearchPlaceholder')}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && open && options[active]) {
              e.preventDefault();
              pick(options[active]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          className="w-full rounded-md border border-border bg-white py-2 pl-9 pr-3 text-base placeholder:text-text-tertiary focus:border-black focus:outline-none max-md:min-h-11"
        />
        {open && (options.length > 0 || loading || query.trim()) && (
          <ul
            id={listId}
            role="listbox"
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
          >
            {options.map((p, i) => (
              <li key={p.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pick(p)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left',
                    i === active && 'bg-surface-hover',
                  )}
                >
                  <Avatar name={p.name || p.email} photoUrl={p.photo_url} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.name || p.email}</span>
                    <span className="block truncate text-xs text-text-tertiary">
                      {p.member?.status === 'active'
                        ? [t('personIsMember'), p.member.group_name].filter(Boolean).join(' · ')
                        : t('personHasAccount')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {options.length === 0 && (
              <li className="px-2 py-2 text-sm text-text-tertiary">{loading ? t('loading') : t('personNoResults')}</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
};

// A row of small overlapping avatars (e.g. who looks after a group).
export const AvatarStack = ({
  people,
  max = 3,
}: {
  people: { id: string; name: string; photo_url: string | null }[];
  max?: number;
}) => {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  return (
    <span className="flex items-center" title={people.map((p) => p.name).join(', ')}>
      {shown.map((p, i) => (
        <span key={p.id} className={cn('rounded-full ring-2 ring-surface', i > 0 && '-ml-1.5')}>
          <Avatar name={p.name} photoUrl={p.photo_url} size={24} />
        </span>
      ))}
      {people.length > max && <span className="ml-1 text-xs text-text-tertiary">+{people.length - max}</span>}
    </span>
  );
};
