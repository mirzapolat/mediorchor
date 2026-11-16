import { forwardRef, type InputHTMLAttributes } from 'react';
import { Search, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size'> & {
  value: string;
  onChange: (value: string) => void;
  // 'md' (h-9) for toolbars and page headers, 'lg' (h-10) in dialogs.
  size?: 'md' | 'lg';
  // Classes of the outer label (width, order in a wrapping row).
  className?: string;
};

// The search pill of the files page: a quiet rounded field with a magnifier
// that lights up on focus, and a ✕ that clears it. Pair it with
// `matchesQuery` from `@/lib/search`, so every list searches the same way.
export const SearchField = forwardRef<HTMLInputElement, Props>(
  ({ value, onChange, size = 'md', className, placeholder, onKeyDown, ...rest }, ref) => {
    const { t } = useI18n();
    const label = placeholder ?? t('search');
    return (
      <label className={cn('relative block', className)}>
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          ref={ref}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && value) {
              e.stopPropagation();
              onChange('');
            }
            onKeyDown?.(e);
          }}
          placeholder={label}
          aria-label={rest['aria-label'] ?? label}
          {...rest}
          className={cn(
            'w-full rounded-full border border-border bg-surface-subtle pl-9 pr-8 text-base placeholder:text-text-tertiary focus:border-black focus:bg-surface focus:outline-none sm:text-sm [&::-webkit-search-cancel-button]:appearance-none',
            size === 'lg' ? 'h-10' : 'h-9',
          )}
        />
        {value && (
          <button
            type="button"
            aria-label={t('clearSearch')}
            onClick={() => onChange('')}
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-text-tertiary hover:bg-surface-muted hover:text-text"
          >
            <X size={14} />
          </button>
        )}
      </label>
    );
  },
);
SearchField.displayName = 'SearchField';
