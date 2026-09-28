import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Check, ChevronLeft, ChevronRight, Trash2, Undo2 } from 'lucide-react';
import { PageSpinner } from './Spinner';
import { Button } from './Button';
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
  // Placing bar markers (managers).
  editing: boolean;
  onEditingDone: () => void;
  onAnchorsChange: (anchors: Anchors) => void;
}

// The score PDF with a tappable marker on every placed bar. While playing, the
// current bar's marker lights up and the page scrolls along. In edit mode a
// tap on the sheet places the next bar, markers can be dragged into place.
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
    const drag = useRef<{ label: string; moved: boolean } | null>(null);

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

    const commit = (next: Anchors) => {
      history.current.push(draftRef.current);
      if (history.current.length > 100) history.current.shift();
      draftRef.current = next;
      setDraft(next);
      onAnchorsChange(next);
    };

    const nextAfter = (label: string, placed: Anchors) => {
      const i = labels.indexOf(label);
      return (
        labels.slice(i + 1).find((l) => !placed[l]) ??
        labels.find((l) => !placed[l]) ??
        null
      );
    };

    const place = (page: number, x: number, y: number) => {
      if (!editing || !target) return;
      const next = { ...draftRef.current, [target]: { page, x, y } };
      commit(next);
      setTarget(nextAfter(target, next));
    };

    const undo = () => {
      const prev = history.current.pop();
      if (!prev) return;
      draftRef.current = prev;
      setDraft(prev);
      onAnchorsChange(prev);
    };

    const removeTarget = () => {
      if (!target || !draftRef.current[target]) return;
      const next = { ...draftRef.current };
      delete next[target];
      commit(next);
    };

    const step = (dir: -1 | 1) => {
      const i = target ? labels.indexOf(target) : -1;
      const n = labels[Math.min(labels.length - 1, Math.max(0, i + dir))];
      if (n) setTarget(n);
    };

    const startDrag = (e: ReactPointerEvent<HTMLButtonElement>, label: string) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { label, moved: false };
      history.current.push(draftRef.current);
    };

    const moveDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
      const d = drag.current;
      const page = e.currentTarget.parentElement;
      if (!d || !page || e.buttons === 0) return;
      const rect = page.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      const existing = draftRef.current[d.label];
      if (!existing) return;
      d.moved = true;
      draftRef.current = { ...draftRef.current, [d.label]: { ...existing, x, y } };
      setDraft(draftRef.current);
    };

    const endDrag = () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (d.moved) onAnchorsChange(draftRef.current);
      else history.current.pop(); // a plain tap: select the bar instead
      setTarget(d.label);
    };

    const overlay = (page: number) =>
      labels
        .filter((label) => draft[label]?.page === page)
        .map((label) => {
          const a = draft[label];
          const isCurrent = !editing && label === currentLabel;
          const isTarget = editing && label === target;
          const inLoop = !editing && loopLabels?.has(label);
          return (
            <button
              key={label}
              type="button"
              data-bar={label}
              aria-label={`${t('bar')} ${label}`}
              style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, touchAction: editing ? 'none' : undefined }}
              onClick={(e) => {
                e.stopPropagation();
                if (!editing) onBarTap(label, e.shiftKey);
              }}
              onPointerDown={editing ? (e) => startDrag(e, label) : undefined}
              onPointerMove={editing ? moveDrag : undefined}
              onPointerUp={editing ? endDrag : undefined}
              onPointerCancel={editing ? endDrag : undefined}
              className={cn(
                'absolute z-10 flex h-6 min-w-[1.5rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border px-1 text-[11px] font-semibold tabular-nums shadow-sm transition-transform duration-150 sm:h-7 sm:min-w-[1.75rem] sm:text-xs',
                // Bright red so markers stand out on black-and-white sheet
                // music; the playing bar grows with a halo.
                isCurrent || isTarget
                  ? 'scale-125 border-2 border-white bg-danger text-white ring-4 ring-danger/40'
                  : label === pickLabel
                    ? 'border-danger bg-danger-strong text-white'
                    : inLoop
                      ? 'border-danger bg-white text-danger'
                      : 'border-danger bg-danger text-white',
                editing && 'cursor-move',
              )}
            >
              {label}
            </button>
          );
        });

    const placedCount = labels.filter((l) => draft[l]).length;

    return (
      <div ref={rootRef}>
        {editing && (
          <div className="sticky top-14 z-20 -mx-4 mb-3 border-y border-black bg-surface px-4 py-2.5 shadow-sm sm:mx-0 sm:rounded-md sm:border md:top-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={t('previousBar')}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-border hover:bg-surface-muted"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="min-w-0 flex-1 text-center">
                <div className="text-sm font-semibold">
                  {target ? `${t('bar')} ${target}` : t('allBarsPlaced')}
                </div>
                <div className="text-xs text-text-secondary">
                  {target
                    ? draft[target]
                      ? t('placeAgainHint')
                      : t('placeHint')
                    : `${placedCount}/${labels.length}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={t('nextBar')}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-border hover:bg-surface-muted"
              >
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
                  onClick={undo}
                  aria-label={t('undo')}
                  title={t('undo')}
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface-muted"
                >
                  <Undo2 size={15} />
                </button>
                <button
                  type="button"
                  onClick={removeTarget}
                  disabled={!target || !draft[target]}
                  aria-label={t('remove')}
                  title={t('remove')}
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface-muted disabled:opacity-40"
                >
                  <Trash2 size={15} />
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
          <PdfScoreView
            url={url}
            zoom={zoom}
            overlay={overlay}
            onPageClick={editing ? place : undefined}
            clickCursor={editing && target ? 'crosshair' : 'default'}
          />
        </Suspense>
      </div>
    );
  },
);
PieceScore.displayName = 'PieceScore';
