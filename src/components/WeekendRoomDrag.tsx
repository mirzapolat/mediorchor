import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from './Avatar';
import type { RoomPerson } from '@/lib/weekends';

// Where a dragged person is let go: a room (null: "Ohne Zimmer") and the
// person under the pointer there, if any (for a swap).
export interface DropTarget {
  room: string | null;
  person: string | null;
}

interface Dragging {
  person: RoomPerson;
  from: string | null;
}

// Moving people between rooms by dragging — mouse and touch alike (pointer
// events, not HTML drag and drop, which phones lack). A mouse drags the whole
// row; touch only the grip (`data-grip`), so the page still scrolls. Drop
// zones carry `data-drop-room` (the room id, "" for no room), people in them
// `data-drop-person`. Near the scroll box's edges it scrolls along; Escape
// cancels. A drag that moved swallows the click that follows it.
export const useRoomDrag = (onDrop: (person: RoomPerson, from: string | null, target: DropTarget) => void) => {
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [over, setOver] = useState<DropTarget | null>(null);
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const start = useRef<{ person: RoomPerson; from: string | null; x: number; y: number; scroller: HTMLElement | null } | null>(null);

  useEffect(() => {
    const targetAt = (x: number, y: number): DropTarget | null => {
      const el = document.elementFromPoint(x, y);
      const zone = el?.closest<HTMLElement>('[data-drop-room]');
      if (!zone) return null;
      return { room: zone.dataset.dropRoom || null, person: el?.closest<HTMLElement>('[data-drop-person]')?.dataset.dropPerson ?? null };
    };
    let active: Dragging | null = null;
    let pointer = { x: 0, y: 0 };
    let frame = 0;

    // Scrolls the box while the pointer is near its top or bottom edge.
    const autoScroll = () => {
      const box = start.current?.scroller;
      if (!active || !box) return;
      const rect = box.getBoundingClientRect();
      const edge = 64;
      const dy = pointer.y < rect.top + edge ? -(rect.top + edge - pointer.y) : pointer.y > rect.bottom - edge ? pointer.y - (rect.bottom - edge) : 0;
      if (dy) {
        box.scrollBy(0, Math.max(-24, Math.min(24, dy / 3)));
        setOver(targetAt(pointer.x, pointer.y));
      }
      frame = requestAnimationFrame(autoScroll);
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      start.current = null;
      active = null;
      setDragging(null);
      setOver(null);
      document.body.style.removeProperty('user-select');
    };

    const onMove = (e: PointerEvent) => {
      const s = start.current;
      if (!s) return;
      pointer = { x: e.clientX, y: e.clientY };
      if (!active) {
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < 5) return;
        active = { person: s.person, from: s.from };
        setDragging(active);
        document.body.style.userSelect = 'none';
        frame = requestAnimationFrame(autoScroll);
      }
      e.preventDefault();
      setPoint(pointer);
      setOver(targetAt(e.clientX, e.clientY));
    };

    const onUp = (e: PointerEvent) => {
      if (!start.current) return;
      const done = active;
      const target = done ? targetAt(e.clientX, e.clientY) : null;
      stop();
      if (!done) return;
      // The click after a drag would open the person.
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      if (target) onDropRef.current(done.person, done.from, target);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && start.current) stop();
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Props for a person's row.
  const handle = (person: RoomPerson, from: string | null) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      if (e.pointerType !== 'mouse' && !(e.target as HTMLElement).closest('[data-grip]')) return;
      start.current = { person, from, x: e.clientX, y: e.clientY, scroller: e.currentTarget.closest('main') };
    },
  });

  const ghost =
    dragging &&
    createPortal(
      <div
        className="pointer-events-none fixed z-[80] flex max-w-[14rem] -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1 shadow-lg"
        style={{ left: point.x, top: point.y }}
      >
        <Avatar name={dragging.person.name} photoUrl={dragging.person.photo_url} size={22} />
        <span className="truncate text-sm font-medium">{dragging.person.name}</span>
      </div>,
      document.body,
    );

  return { dragging, over, handle, ghost };
};

export type RoomDrag = ReturnType<typeof useRoomDrag>;
