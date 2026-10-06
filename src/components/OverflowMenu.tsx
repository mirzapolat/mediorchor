import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
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
// button with a chevron instead (collapsing to its icon on phones). The menu
// is portalled with fixed coordinates, so a scrolling container can't clip it.
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
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Keyboard: focus moves to the first item once the menu is placed; arrows,
  // Home and End move between items; Escape and Tab close it and return focus
  // to the trigger (the menu lives at the end of <body>).
  const menuItems = () => [
    ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []),
  ];
  const placed = position !== null;
  useEffect(() => {
    if (placed) menuItems()[0]?.focus({ preventScroll: true });
  }, [placed]);

  const close = () => {
    setOpen(false);
    ref.current?.querySelector('button')?.focus();
  };

  const onMenuKey = (e: ReactKeyboardEvent) => {
    const list = menuItems();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => list[(i + list.length) % list.length]?.focus();
    const keys: Record<string, () => void> = {
      ArrowDown: () => go(at + 1),
      ArrowUp: () => go(at - 1),
      Home: () => go(0),
      End: () => go(list.length - 1),
      Escape: close,
      Tab: close,
    };
    if (keys[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      keys[e.key]();
    }
  };

  // Below the trigger, right-aligned (above it when there's no room), kept
  // inside the viewport; follows scrolling and resizing.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const place = () => {
      const trigger = ref.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = menuRef.current?.offsetWidth ?? 192;
      const height = menuRef.current?.offsetHeight ?? 160;
      const margin = 8;
      const left = Math.max(margin, Math.min(trigger.right - width, window.innerWidth - width - margin));
      const below = trigger.bottom + 4;
      const top =
        below + height > window.innerHeight - margin && trigger.top - 4 - height > margin
          ? trigger.top - 4 - height
          : below;
      setPosition({ top, left });
    };
    place();
    // Measure again once the menu has rendered with its real size.
    const frame = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
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
      {open &&
        createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-[70] min-w-[12rem] rounded-xl border border-border bg-surface p-1 shadow-lg"
          style={position ?? { top: -9999, left: -9999 }}
          onKeyDown={onMenuKey}
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
                className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-surface-muted focus:bg-surface-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <Icon size={16} className="text-text-secondary" />
                {itemLabel}
              </button>
            </div>
          ))}
        </div>,
        document.body,
        )}
    </div>
  );
};
