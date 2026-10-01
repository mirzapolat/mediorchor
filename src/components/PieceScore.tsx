import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Check, ChevronLeft, ChevronRight, RotateCcw, Stamp, Trash2, Undo2 } from 'lucide-react';
import { PageSpinner } from './Spinner';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { shiftBarLabel } from '@/lib/pieceTimeline';
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
  // Added to the bar numbers shown (labels stay the keys).
  barShift: number;
  follow: boolean;
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
    barShift,
    follow,
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
    // A touch that may turn into drawing once held; a quick tap stamps.
    const hold = useRef<{ timer: number; x: number; y: number; page: number; el: HTMLElement } | null>(
      null,
    );
    // Stamp mode: a click places a frame the size of the last one drawn.
    const [template, setTemplate] = useState<{ w: number; h: number } | null>(null);
    const [stamping, setStamping] = useState(false);
    // Where the stamp would land under the mouse (preview).
    const [hover, setHover] = useState<{ page: number; x: number; y: number } | null>(null);

    useEffect(() => {
      setDraft(anchors);
      draftRef.current = anchors;
    }, [anchors]);

    useEffect(() => {
      if (!editing) return;
      history.current = [];
      setTarget(labels.find((l) => !anchors[l]) ?? labels[0] ?? null);
      // Until something is drawn, the template is the last frame in the score.
      const last = [...labels].reverse().map((l) => anchors[l]).find((a) => a && isFrame(a));
      setTemplate(last ? { w: last.w as number, h: last.h as number } : null);
      setStamping(false);
      setHover(null);
      // Only when edit mode starts.
    }, [editing]);

    // Trackpad pinch over the stamp preview changes the template's width
    // (bars differ in width) instead of zooming the score. ⌘ + scroll still
    // zooms. Listens in the capture phase, ahead of the score's own zoom.
    const pinchLive = useRef({ stamping, template, hover });
    pinchLive.current = { stamping, template, hover };
    useEffect(() => {
      const el = rootRef.current;
      if (!el || !editing) return;
      const active = () => {
        const s = pinchLive.current;
        return s.stamping && s.template && s.hover;
      };
      const resize = (factor: number) =>
        setTemplate((tp) => (tp ? { ...tp, w: Math.min(1, Math.max(MIN_SIZE * 2, tp.w * factor)) } : tp));

      // Chrome/Firefox: a pinch is a wheel event with ctrlKey.
      const onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey || !active()) return;
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        resize(Math.exp(-delta * 0.01));
      };
      // Safari: gesture events with a scale relative to the gesture start.
      let lastScale = 1;
      let pinching = false;
      const onGestureStart = (e: Event) => {
        if (!active()) return;
        e.preventDefault();
        e.stopPropagation();
        pinching = true;
        lastScale = 1;
      };
      const onGestureChange = (e: Event) => {
        if (!pinching) return;
        e.preventDefault();
        e.stopPropagation();
        const scale = (e as Event & { scale: number }).scale;
        resize(scale / lastScale);
        lastScale = scale;
      };
      const onGestureEnd = (e: Event) => {
        if (!pinching) return;
        e.preventDefault();
        e.stopPropagation();
        pinching = false;
      };
      el.addEventListener('wheel', onWheel, { capture: true, passive: false });
      el.addEventListener('gesturestart', onGestureStart, true);
      el.addEventListener('gesturechange', onGestureChange, true);
      el.addEventListener('gestureend', onGestureEnd, true);
      return () => {
        el.removeEventListener('wheel', onWheel, { capture: true });
        el.removeEventListener('gesturestart', onGestureStart, true);
        el.removeEventListener('gesturechange', onGestureChange, true);
        el.removeEventListener('gestureend', onGestureEnd, true);
      };
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

    // Frame of the template's size centred on the point (so the click lands
    // in the empty bar, not on a neighbour's frame), kept on the page.
    const stampFrame = (page: number, x: number, y: number): BarAnchor | null =>
      template
        ? {
            page,
            x: Math.max(0, Math.min(1 - template.w, x - template.w / 2)),
            y: Math.max(0, Math.min(1 - template.h, y - template.h / 2)),
            w: template.w,
            h: template.h,
          }
        : null;

    const placeStamp = (page: number, x: number, y: number) => {
      const frame = stampFrame(page, x, y);
      if (!target || !frame) return;
      const next = { ...draftRef.current, [target]: frame };
      commit(next);
      setTarget(nextAfter(target, next));
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
      if (!e.isPrimary) {
        stopForPinch(); // a second finger: the user is pinching, not drawing
        return;
      }
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
        page,
        el,
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

    // Abandons a hold or a half-drawn frame when a pinch begins.
    const stopForPinch = () => {
      cancelHold();
      const g = gesture.current;
      gesture.current = null;
      if (!g) return;
      const before = { ...draftRef.current };
      if (g.origin) before[g.label] = g.origin;
      else delete before[g.label];
      show(before);
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

    const end = (e: ReactPointerEvent<HTMLElement>) => {
      const tap = hold.current;
      cancelHold();
      const g = gesture.current;
      gesture.current = null;
      if (!g) {
        // Touch: let go before the hold turned into drawing — a tap stamps.
        if (tap && stamping && e.type === 'pointerup') {
          const p = pointAt(tap.el, e);
          placeStamp(tap.page, p.x, p.y);
        }
        return;
      }
      // The state before the gesture: the frame's original (or no) mark.
      const before = { ...draftRef.current };
      if (g.origin) before[g.label] = g.origin;
      else delete before[g.label];

      const frame = draftRef.current[g.label];
      const tooSmall = !frame || (frame.w ?? 0) < MIN_SIZE || (frame.h ?? 0) < MIN_SIZE;
      // A click (or a tiny jitter) in stamp mode places the template.
      if (g.mode === 'draw' && stamping && (!g.moved || tooSmall)) {
        show(before);
        placeStamp(g.page, g.startX, g.startY);
        return;
      }
      if (!g.moved) {
        show(before);
        if (g.mode !== 'draw') setTarget(g.label); // a tap on a frame selects it
        return;
      }
      if (g.mode === 'draw' && tooSmall) {
        show(before);
        return;
      }
      commit(draftRef.current, before);
      // Drawn or resized: its size becomes the template.
      if (g.mode !== 'move' && frame) setTemplate({ w: frame.w ?? 0, h: frame.h ?? 0 });
      setTarget(g.mode === 'draw' ? nextAfter(g.label, draftRef.current) : g.label);
    };

    // Mouse only: the template follows the pointer as a preview.
    const trackHover = (e: ReactPointerEvent<HTMLElement>, page: number) => {
      if (!stamping || e.pointerType !== 'mouse' || gesture.current) return;
      const p = pointAt(e.currentTarget, e);
      setHover({ page, x: p.x, y: p.y });
    };

    // ---- Rendering ---------------------------------------------------------

    const overlay = (page: number) => (
      <div
        className={cn('absolute inset-0', editing && target && 'cursor-crosshair')}
        onPointerDown={editing ? (e) => startDraw(e, page) : undefined}
        onPointerMove={
          editing
            ? (e) => {
                move(e);
                trackHover(e, page);
              }
            : undefined
        }
        onPointerUp={editing ? end : undefined}
        onPointerCancel={editing ? end : undefined}
        onPointerLeave={editing ? () => setHover(null) : undefined}
      >
        {editing && stamping && target && hover?.page === page && (() => {
          const ghost = stampFrame(page, hover.x, hover.y);
          return (
            ghost && (
              <div
                aria-hidden
                className="pointer-events-none absolute z-20 rounded-sm border-2 border-dashed border-danger bg-danger/10"
                style={{
                  left: `${ghost.x * 100}%`,
                  top: `${ghost.y * 100}%`,
                  width: `${(ghost.w ?? 0) * 100}%`,
                  height: `${(ghost.h ?? 0) * 100}%`,
                }}
              >
                <span className="absolute -top-2.5 left-0 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold tabular-nums text-white shadow-sm sm:text-[11px]">
                  {target && shiftBarLabel(target, barShift)}
                </span>
              </div>
            )
          );
        })()}
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
                  aria-label={`${t('bar')} ${shiftBarLabel(label, barShift)}`}
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
                  {shiftBarLabel(label, barShift)}
                </button>
              );
            }

            return (
              <div
                key={label}
                data-bar={label}
                role={editing ? undefined : 'button'}
                tabIndex={editing ? undefined : 0}
                aria-label={`${t('bar')} ${shiftBarLabel(label, barShift)}`}
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
                          : 'cursor-pointer border-transparent [@media(hover:hover)]:hover:border-danger/50 [@media(hover:hover)]:hover:bg-danger/5',
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
                  {shiftBarLabel(label, barShift)}
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
                  {target ? `${t('bar')} ${shiftBarLabel(target, barShift)}` : t('allBarsPlaced')}
                </div>
                <div className="text-xs text-text-secondary">
                  {target
                    ? stamping
                      ? t('stampHint')
                      : draft[target]
                        ? t('placeAgainHint')
                        : t('placeHint')
                    : `${placedCount}/${labels.length}`}
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
                <button
                  type="button"
                  onClick={() => {
                    setStamping((on) => !on);
                    setHover(null);
                  }}
                  disabled={!template}
                  aria-pressed={stamping}
                  title={template ? t('stampTitle') : t('stampNoTemplate')}
                  className={cn(
                    'flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium disabled:opacity-40',
                    stamping ? 'border-black bg-black text-white hover:bg-black-hover' : 'border-border hover:bg-surface-muted',
                  )}
                >
                  <Stamp size={15} />
                  <span className="hidden sm:inline">{t('stamp')}</span>
                </button>
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
          <PdfScoreView url={url} overlay={overlay} mousePan={!editing} onPinchStart={stopForPinch} />
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
