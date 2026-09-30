import { useEffect, useRef, useState } from 'react';
import { ChevronDown, MoreHorizontal, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface OverflowMenuItem {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  // Draws a divider above the item, to group related actions.
  separated?: boolean;
}

// A "⋯" button that opens a small list of actions. Closes on selection, a
// click outside, or Escape. With `buttonIcon` the trigger is a labeled header
// button with a chevron instead (collapsing to its icon on phones).
export const OverflowMenu = ({
  label,
  items,
  buttonIcon: ButtonIcon,
}: {
  label: string;
  items: OverflowMenuItem[];
  buttonIcon?: LucideIcon;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {ButtonIcon ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={label}
          title={label}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-white px-4 text-sm font-medium text-black transition-colors duration-150 hover:bg-surface-muted max-sm:w-9 max-sm:px-0',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1',
            open && 'bg-surface-muted',
          )}
        >
          <ButtonIcon size={16} />
          <span className="hidden sm:inline">{label}</span>
          <ChevronDown size={15} className={cn('hidden text-text-secondary transition-transform duration-150 sm:inline', open && 'rotate-180')} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={label}
          title={label}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition-colors duration-150 hover:bg-surface-hover hover:text-text',
            open && 'bg-surface-hover text-text',
          )}
        >
          <MoreHorizontal size={18} />
        </button>
      )}
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 min-w-[12rem] rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          {items.map(({ icon: Icon, label: itemLabel, onSelect, disabled, separated }) => (
            <div key={itemLabel}>
              {separated && <div role="separator" className="-mx-1 my-1 border-t border-border" />}
              <button
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => {
                  setOpen(false);
                  onSelect();
                }}
                className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <Icon size={16} className="text-text-secondary" />
                {itemLabel}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
