import type { ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { useDragReorder } from '@/hooks/useDragReorder';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

const GAP = 8; // px, matches gap-2

// A vertical list of cards that can be reordered by dragging the grip (mouse
// and touch). Without onReorder the grips are hidden and the list is static.
export const SortableList = <T,>({
  items,
  getId,
  onReorder,
  renderItem,
  className,
}: {
  items: T[];
  getId: (item: T) => string;
  onReorder?: (items: T[]) => void;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
}) => {
  const { t } = useI18n();
  const dnd = useDragReorder(items, getId, (next) => onReorder?.(next), GAP);

  return (
    <ul className={cn('flex flex-col gap-2', className)}>
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
              'flex items-stretch rounded-md border border-border bg-surface',
              dragging && 'shadow-lg',
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
                className="flex w-9 flex-shrink-0 cursor-grab items-center justify-center rounded-l-md border-r border-border text-text-tertiary hover:text-text-secondary active:cursor-grabbing"
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
