import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';

// Pointer-based drag & drop reordering (works with mouse and touch alike).
// While dragging, the grabbed row follows the pointer and the other rows slide
// out of the way with a transform transition, so reordering feels native.
// The new order is committed once via onReorder when the pointer is released.

interface DragState {
  id: string;
  index: number; // index in the items array at drag start
  pointerStartY: number;
  offsetY: number; // current pointer delta
  targetIndex: number; // where the item would land if dropped now
  rects: Array<{ top: number; height: number }>;
}

export const useDragReorder = <T,>(
  items: T[],
  getId: (item: T) => string,
  onReorder: (items: T[]) => void,
  gap = 0, // vertical gap between items in px, must match the layout
) => {
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const updateDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const setItemRef = (id: string, el: HTMLElement | null) => {
    if (el) itemRefs.current.set(id, el);
    else itemRefs.current.delete(id);
  };

  const startDrag = (e: PointerEvent, id: string, index: number) => {
    if (items.length < 2) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rects = items.map((item) => {
      const rect = itemRefs.current.get(getId(item))?.getBoundingClientRect();
      return { top: rect?.top ?? 0, height: rect?.height ?? 0 };
    });
    updateDrag({ id, index, pointerStartY: e.clientY, offsetY: 0, targetIndex: index, rects });
  };

  const moveDrag = (e: PointerEvent) => {
    const current = dragRef.current;
    if (!current) return;
    const offsetY = e.clientY - current.pointerStartY;
    const { rects, index } = current;
    const center = rects[index].top + rects[index].height / 2 + offsetY;

    let targetIndex = index;
    for (let i = 0; i < rects.length; i++) {
      if (i === index) continue;
      const mid = rects[i].top + rects[i].height / 2;
      if (i < index && center < mid) targetIndex = Math.min(targetIndex, i);
      if (i > index && center > mid) targetIndex = Math.max(targetIndex, i);
    }
    updateDrag({ ...current, offsetY, targetIndex });
  };

  const endDrag = () => {
    const current = dragRef.current;
    if (!current) return;
    updateDrag(null);
    if (current.targetIndex !== current.index) {
      const next = [...items];
      const [moved] = next.splice(current.index, 1);
      next.splice(current.targetIndex, 0, moved);
      onReorder(next);
    }
  };

  // Vertical shift applied to each item while a drag is in progress.
  const shiftFor = (index: number): number => {
    if (!drag) return 0;
    if (index === drag.index) return drag.offsetY;
    const draggedSpace = drag.rects[drag.index].height + gap;
    if (index > drag.index && index <= drag.targetIndex) return -draggedSpace;
    if (index < drag.index && index >= drag.targetIndex) return draggedSpace;
    return 0;
  };

  const isDragging = (id: string) => drag?.id === id;

  return { dragActive: drag !== null, isDragging, shiftFor, setItemRef, startDrag, moveDrag, endDrag };
};
