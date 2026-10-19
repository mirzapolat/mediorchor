import type { ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { useDragReorder } from '@/hooks/useDragReorder';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

// A vertical list that can be reordered by dragging the grip (mouse and
// touch). Without onReorder the grips are hidden and the list is static.
// `cards`: separate bordered cards; `joined`: one panel with dividers.
// `header` (joined only): column titles above the rows, indented like them
// when the grips are shown, so table-like rows line up with it.
export const SortableList = <T,>({
  items,
  getId,
  onReorder,
  renderItem,
  className,
  variant = 'cards',
  header,
}: {
  items: T[];
  getId: (item: T) => string;
  onReorder?: (items: T[]) => void;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  variant?: 'cards' | 'joined';
  header?: ReactNode;
}) => {
  const { t } = useI18n();
  const joined = variant === 'joined';
  // Vertical gap between items in px; must match the layout below (gap-2).
  const dnd = useDragReorder(items, getId, (next) => onReorder?.(next), joined ? 0 : 8);
  const grips = Boolean(onReorder) && items.length > 1;

  return (
    <ul
      className={cn(
        joined ? 'rounded-2xl border border-border bg-surface' : 'flex flex-col gap-2',
        className,
      )}
    >
      {joined && header && (
        <li aria-hidden className="flex items-stretch rounded-t-2xl border-b border-border bg-surface-subtle">
          {grips && <span className="w-9 flex-shrink-0" />}
          <div className="min-w-0 flex-1">{header}</div>
        </li>
      )}
      {items.map((item, index) => {
        const id = getId(item);
        const dragging = dnd.isDragging(id);
        return (
          <li
            key={id}
            ref={(el) => dnd.setItemRef(id, el)}
            style={
              dnd.dragActive
                ? {
                    transform: `translateY(${dnd.shiftFor(index)}px)`,
                    transition: dragging ? 'none' : 'transform 150ms ease',
                    position: 'relative',
                    zIndex: dragging ? 10 : undefined,
                  }
                : undefined
            }
            className={cn(
              'flex items-stretch bg-surface',
              joined
                ? // Hovering the row's link highlights the whole row, grip included.
                  'border-b border-border transition-colors duration-150 last:rounded-b-2xl last:border-b-0 [&:has(a:hover)]:bg-surface-subtle'
                : 'rounded-2xl border border-border',
              joined && !header && 'first:rounded-t-2xl',
              dragging && (joined ? 'rounded-2xl shadow-lg ring-1 ring-border' : 'shadow-lg'),
            )}
          >
            {grips && (
              <button
                type="button"
                aria-label={t('reorder')}
                onPointerDown={(e) => dnd.startDrag(e, id, index)}
                onPointerMove={dnd.moveDrag}
                onPointerUp={dnd.endDrag}
                onPointerCancel={dnd.endDrag}
                style={{ touchAction: 'none' }}
                className={cn(
                  'flex w-9 flex-shrink-0 cursor-grab items-center justify-center text-text-tertiary hover:text-text-secondary active:cursor-grabbing',
                  !joined && 'rounded-l-2xl border-r border-border',
                )}
              >
                <GripVertical size={16} />
              </button>
            )}
            <div className="min-w-0 flex-1">{renderItem(item, index)}</div>
          </li>
        );
      })}
    </ul>
  );
};
