import type { ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { useDragReorder } from '@/hooks/useDragReorder';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

// A vertical list that can be reordered by dragging the grip (mouse and
// touch). Without onReorder the grips are hidden and the list is static.
// `cards`: separate bordered cards; `joined`: one panel with dividers.
export const SortableList = <T,>({
  items,
  getId,
  onReorder,
  renderItem,
  className,
  variant = 'cards',
}: {
  items: T[];
  getId: (item: T) => string;
  onReorder?: (items: T[]) => void;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  variant?: 'cards' | 'joined';
}) => {
  const { t } = useI18n();
  const joined = variant === 'joined';
  // Vertical gap between items in px; must match the layout below (gap-2).
  const dnd = useDragReorder(items, getId, (next) => onReorder?.(next), joined ? 0 : 8);

  return (
    <ul
      className={cn(
        joined ? 'rounded-xl border border-border bg-surface' : 'flex flex-col gap-2',
        className,
      )}
    >
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
                  'border-b border-border transition-colors duration-150 first:rounded-t-xl last:rounded-b-xl last:border-b-0 [&:has(a:hover)]:bg-surface-subtle'
                : 'rounded-md border border-border',
              dragging && (joined ? 'rounded-xl shadow-lg ring-1 ring-border' : 'shadow-lg'),
            )}
          >
            {onReorder && items.length > 1 && (
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
                  !joined && 'rounded-l-md border-r border-border',
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
