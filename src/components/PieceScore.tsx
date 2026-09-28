import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Check, ChevronLeft, ChevronRight, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { PageSpinner } from './Spinner';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import type { BarAnchor } from '@/types';

// pdf.js is heavy; load it only when a piece actually shows a score.
const PdfScoreView = lazy(() =>
  import('./PdfScoreView').then((m) => ({ default: m.PdfScoreView })),
);

type Anchors = Record<string, BarAnchor>;

interface PieceScoreProps {
  url: string;
  labels: string[]; // written bar labels in score order
  anchors: Anchors;
  currentLabel: string | null;
  loopLabels: Set<string> | null;
  pickLabel: string | null;
  follow: boolean;
  zoom: number;
  onBarTap: (label: string, shiftKey: boolean) => void;
  // Marking bars (managers).
  editing: boolean;
  onEditingDone: () => void;
  onAnchorsChange: (anchors: Anchors) => void;
}

// A frame being drawn, moved or resized, in page fractions.
interface Gesture {
  mode: 'draw' | 'move' | 'resize';
  label: string;
  page: number;
  pageEl: HTMLElement;
  startX: number;
  startY: number;
  origin: BarAnchor | null;
  moved: boolean;
}

const MIN_SIZE = 0.01; // smaller frames count as a stray tap
const HOLD_MS = 250; // touch: hold this long before a drag draws instead of scrolls

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const isFrame = (a: BarAnchor) => a.w != null && a.h != null;

// The score PDF with every marked bar as a tappable frame. While playing, the
// current bar lights up and the page scrolls along. In edit mode a frame is
// drawn around each bar (drag; on touch: hold briefly, then drag), frames can
// be moved and resized by their corner, and all marks can be reset.
export const PieceScore = memo(
  ({
    url,
    labels,
    anchors,
    currentLabel,
    loopLabels,
    pickLabel,
    follow,
    zoom,
    onBarTap,
    editing,
    onEditingDone,
    onAnchorsChange,
  }: PieceScoreProps) => {
    const { t } = useI18n();
    const rootRef = useRef<HTMLDivElement>(null);
    const [draft, setDraft] = useState(anchors);
    const draftRef = useRef(draft);
    const history = useRef<Anchors[]>([]);
    const [target, setTarget] = useState<string | null>(null);
    const [resetOpen, setResetOpen] = useState(false);
    const gesture = useRef<Gesture | null>(null);
    const hold = useRef<{ timer: number; x: number; y: number } | null>(null);

    useEffect(() => {
      setDraft(anchors);
      draftRef.current = anchors;
    }, [anchors]);

    useEffect(() => {
      if (!editing) return;
      history.current = [];
      setTarget(labels.find((l) => !anchors[l]) ?? labels[0] ?? null);
      // Only when edit mode starts.
    }, [editing]);

    // While a touch gesture draws/moves a frame, the page must not scroll.
    useEffect(() => {
      const el = rootRef.current;
      if (!el || !editing) return;
      const block = (e: TouchEvent) => {
        if (gesture.current) e.preventDefault();
      };
      el.addEventListener('touchmove', block, { passive: false });
      return () => el.removeEventListener('touchmove', block);
    }, [editing]);

    // Keep the playing bar in view.
    useEffect(() => {
      if (!follow || editing || !currentLabel) return;
      const el = rootRef.current?.querySelector<HTMLElement>(
        `[data-bar="${CSS.escape(currentLabel)}"]`,
      );
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const top = 96; // below the phone top bar
      const bottom = window.innerHeight - 240; // above the player
      if (rect.top < top || rect.bottom > bottom) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, [currentLabel, follow, editing]);

    const show = (next: Anchors) => {
      draftRef.current = next;
      setDraft(next);
    };

    const commit = (next: Anchors, previous = draftRef.current) => {
      history.current.push(previous);
      if (history.current.length > 100) history.current.shift();
      show(next);
      onAnchorsChange(next);
    };

    const nextAfter = (label: string, placed: Anchors) => {
      const i = labels.indexOf(label);
      return labels.slice(i + 1).find((l) => !placed[l]) ?? labels.find((l) => !placed[l]) ?? null;
    };

    const undo = () => {
      const prev = history.current.pop();
      if (!prev) return;
      show(prev);
      onAnchorsChange(prev);
    };

    const removeTarget = () => {
      if (!target || !draftRef.current[target]) return;
      const next = { ...draftRef.current };
      delete next[target];
      commit(next);
    };

    const resetAll = () => {
      setResetOpen(false);
      commit({});
      setTarget(labels[0] ?? null);
    };

    const step = (dir: -1 | 1) => {
      const i = target ? labels.indexOf(target) : -1;
      const n = labels[Math.min(labels.length - 1, Math.max(0, i + dir))];
      if (n) setTarget(n);
    };

    // ---- Gestures ----------------------------------------------------------

    const pointAt = (pageEl: HTMLElement, e: { clientX: number; clientY: number }) => {
      const r = pageEl.getBoundingClientRect();
      return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
    };

    const begin = (e: ReactPointerEvent<HTMLElement>, g: Omit<Gesture, 'startX' | 'startY' | 'moved'>) => {
      const p = pointAt(g.pageEl, e);
      gesture.current = { ...g, startX: p.x, startY: p.y, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    };

    const cancelHold = () => {
      if (hold.current) window.clearTimeout(hold.current.timer);
      hold.current = null;
    };

    // Drawing starts right away with a mouse; on touch only after holding
    // still, so a plain swipe keeps scrolling the score.
    const startDraw = (e: ReactPointerEvent<HTMLDivElement>, page: number) => {
      if (!target || e.button > 0) return;
      const el = e.currentTarget;
      const g = { mode: 'draw' as const, label: target, page, pageEl: el, origin: null };
      if (e.pointerType === 'mouse') {
        begin(e, g);
        return;
      }
      const { pointerId, clientX, clientY } = e;
      cancelHold();
      hold.current = {
        x: clientX,
        y: clientY,
        timer: window.setTimeout(() => {
          hold.current = null;
          const p = pointAt(el, { clientX, clientY });
          gesture.current = { ...g, startX: p.x, startY: p.y, moved: false };
          try {
            el.setPointerCapture(pointerId);
          } catch {
            /* pointer already gone */
          }
          navigator.vibrate?.(10);
        }, HOLD_MS),
      };
    };

    const move = (e: ReactPointerEvent<HTMLElement>) => {
      if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 8) {
        cancelHold(); // it's a scroll
      }
      const g = gesture.current;
      if (!g) return;
      const p = pointAt(g.pageEl, e);
      g.moved = true;
      let frame: BarAnchor;
      if (g.mode === 'draw') {
        frame = {
          page: g.page,
          x: Math.min(g.startX, p.x),
          y: Math.min(g.startY, p.y),
          w: Math.abs(p.x - g.startX),
          h: Math.abs(p.y - g.startY),
        };
      } else if (g.mode === 'move' && g.origin) {
        const w = g.origin.w ?? 0;
        const h = g.origin.h ?? 0;
        frame = {
          ...g.origin,
          x: Math.min(1 - w, Math.max(0, g.origin.x + p.x - g.startX)),
          y: Math.min(1 - h, Math.max(0, g.origin.y + p.y - g.startY)),
        };
      } else if (g.origin) {
        frame = {
          ...g.origin,
          w: Math.max(MIN_SIZE, p.x - g.origin.x),
          h: Math.max(MIN_SIZE, p.y - g.origin.y),
        };
      } else {
        return;
      }
      show({ ...draftRef.current, [g.label]: frame });
    };

    const end = () => {
      cancelHold();
      const g = gesture.current;
      gesture.current = null;
      if (!g) return;
      // The state before the gesture: the frame's original (or no) mark.
      const before = { ...draftRef.current };
      if (g.origin) before[g.label] = g.origin;
      else delete before[g.label];

      if (!g.moved) {
        show(before);
        if (g.mode !== 'draw') setTarget(g.label); // a tap on a frame selects it
        return;
      }
      const frame = draftRef.current[g.label];
      if (g.mode === 'draw' && (!frame || (frame.w ?? 0) < MIN_SIZE || (frame.h ?? 0) < MIN_SIZE)) {
        show(before);
        return;
      }
      commit(draftRef.current, before);
      setTarget(g.mode === 'draw' ? nextAfter(g.label, draftRef.current) : g.label);
    };

    // ---- Rendering ---------------------------------------------------------

    const overlay = (page: number) => (
      <div
        className={cn('absolute inset-0', editing && target && 'cursor-crosshair')}
        onPointerDown={editing ? (e) => startDraw(e, page) : undefined}
        onPointerMove={editing ? move : undefined}
        onPointerUp={editing ? end : undefined}
        onPointerCancel={editing ? end : undefined}
      >
        {labels
          .filter((label) => draft[label]?.page === page)
          .map((label) => {
            const a = draft[label];
            const isCurrent = !editing && label === currentLabel;
            const isTarget = editing && label === target;
            const inLoop = !editing && loopLabels?.has(label);
            const picked = !editing && label === pickLabel;

            if (!isFrame(a)) {
              // Older marks are points: a pill on the bar.
              return (
                <button
                  key={label}
                  type="button"
                  data-bar={label}
                  aria-label={`${t('bar')} ${label}`}
                  style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%` }}
                  onPointerDown={(e) => editing && e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (editing) setTarget(label);
                    else onBarTap(label, e.shiftKey);
                  }}
                  className={cn(
                    'absolute z-10 flex h-6 min-w-[1.5rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border px-1 text-[11px] font-semibold tabular-nums shadow-sm sm:h-7 sm:min-w-[1.75rem] sm:text-xs',
                    isCurrent || isTarget
                      ? 'scale-125 border-2 border-white bg-danger text-white ring-4 ring-danger/40'
                      : inLoop
                        ? 'border-danger bg-white text-danger'
                        : 'border-danger bg-danger text-white',
                  )}
                >
                  {label}
                </button>
              );
            }

            return (
              <div
                key={label}
                data-bar={label}
                role={editing ? undefined : 'button'}
                tabIndex={editing ? undefined : 0}
                aria-label={`${t('bar')} ${label}`}
                style={{
                  left: `${a.x * 100}%`,
                  top: `${a.y * 100}%`,
                  width: `${(a.w ?? 0) * 100}%`,
                  height: `${(a.h ?? 0) * 100}%`,
                  touchAction: editing ? 'none' : undefined,
                }}
                onPointerDown={
                  editing
                    ? (e) => {
                        e.stopPropagation();
                        const pageEl = e.currentTarget.parentElement;
                        if (pageEl) begin(e, { mode: 'move', label, page, pageEl, origin: a });
                      }
                    : undefined
                }
                onClick={
                  editing
                    ? undefined
                    : (e) => {
                        e.stopPropagation();
                        onBarTap(label, e.shiftKey);
                      }
                }
                onKeyDown={
                  editing
                    ? undefined
                    : (e) => {
                        if (e.key === 'Enter') onBarTap(label, e.shiftKey);
                      }
                }
                className={cn(
                  'group absolute z-10 rounded-sm border-2 transition-colors duration-150',
                  editing
                    ? isTarget
                      ? 'cursor-move border-danger bg-danger/20'
                      : 'cursor-move border-danger/60 bg-danger/5 hover:bg-danger/10'
                    : isCurrent
                      ? 'cursor-pointer border-danger bg-danger/20'
                      : picked
                        ? 'cursor-pointer border-danger bg-danger/15'
                        : inLoop
                          ? 'cursor-pointer border-dashed border-danger/70 bg-danger/10'
                          : 'cursor-pointer border-transparent hover:border-danger/50 hover:bg-danger/5',
                )}
              >
                <span
                  className={cn(
                    'pointer-events-none absolute -top-2.5 left-0 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums shadow-sm sm:text-[11px]',
                    isCurrent || isTarget || picked
                      ? 'bg-danger text-white'
                      : 'bg-danger/85 text-white',
                  )}
                >
                  {label}
                </span>
                {isTarget && (
                  <span
                    aria-hidden
                    style={{ touchAction: 'none' }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const pageEl = e.currentTarget.parentElement?.parentElement;
                      if (pageEl) begin(e, { mode: 'resize', label, page, pageEl, origin: a });
                    }}
                    className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-danger shadow"
                  />
                )}
              </div>
            );
          })}
      </div>
    );

    const placedCount = labels.filter((l) => draft[l]).length;
    const iconButton =
      'flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface-muted disabled:opacity-40';

    return (
      <div ref={rootRef}>
        {editing && (
          <div className="sticky top-14 z-20 -mx-4 mb-3 border-y border-black bg-surface px-4 py-2.5 shadow-sm sm:mx-0 sm:rounded-md sm:border md:top-0">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => step(-1)} aria-label={t('previousBar')} className={cn(iconButton, 'flex-shrink-0')}>
                <ChevronLeft size={16} />
              </button>
              <div className="min-w-0 flex-1 text-center">
                <div className="text-sm font-semibold">
                  {target ? `${t('bar')} ${target}` : t('allBarsPlaced')}
                </div>
                <div className="text-xs text-text-secondary">
                  {target ? (draft[target] ? t('placeAgainHint') : t('placeHint')) : `${placedCount}/${labels.length}`}
                </div>
              </div>
              <button type="button" onClick={() => step(1)} aria-label={t('nextBar')} className={cn(iconButton, 'flex-shrink-0')}>
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs tabular-nums text-text-secondary">
                {placedCount}/{labels.length} {t('placed')}
              </span>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={undo} aria-label={t('undo')} title={t('undo')} className={iconButton}>
                  <Undo2 size={15} />
                </button>
                <button
                  type="button"
                  onClick={removeTarget}
                  disabled={!target || !draft[target]}
                  aria-label={t('remove')}
                  title={t('remove')}
                  className={iconButton}
                >
                  <Trash2 size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setResetOpen(true)}
                  disabled={placedCount === 0}
                  aria-label={t('resetMarkers')}
                  title={t('resetMarkers')}
                  className={iconButton}
                >
                  <RotateCcw size={15} />
                </button>
                <Button onClick={onEditingDone} className="h-9 px-3">
                  <Check size={15} />
                  {t('done')}
                </Button>
              </div>
            </div>
          </div>
        )}
        <Suspense fallback={<PageSpinner />}>
          <PdfScoreView url={url} zoom={zoom} overlay={overlay} />
        </Suspense>
        <ConfirmDialog
          open={resetOpen}
          title={t('resetMarkers')}
          message={t('resetMarkersConfirm')}
          confirmLabel={t('resetMarkers')}
          destructive
          onConfirm={resetAll}
          onCancel={() => setResetOpen(false)}
        />
      </div>
    );
  },
);
PieceScore.displayName = 'PieceScore';
