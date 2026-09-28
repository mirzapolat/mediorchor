import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
// Vite only rewrites relative paths inside `new URL(..., import.meta.url)`,
// so the worker must be pulled in as an asset URL import instead.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Minimize2 } from 'lucide-react';
import { PageSpinner } from './Spinner';
import { useI18n } from '@/lib/i18n';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MIN_ZOOM = 0.4; // below 1 the pages shrink and stay centred
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const MAX_CANVAS_PX = 4096; // keeps canvases within mobile memory limits

interface PdfScoreViewProps {
  url: string;
  // Absolutely-positioned children laid over a page (coordinates in % of the
  // page size work out of the box — the overlay covers the page exactly).
  overlay?: (page: number) => ReactNode;
  // Dragging with the mouse pans a zoomed score (off while drawing frames).
  mousePan?: boolean;
  // Told when a two-finger gesture starts, so one-finger tools can let go.
  onPinchStart?: () => void;
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const isFit = (z: number) => Math.abs(z - 1) < 0.05;

// The element the page scrolls in vertically (the app's <main>).
const verticalScroller = (el: HTMLElement): HTMLElement => {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return document.scrollingElement as HTMLElement;
};

const PdfPage = ({
  doc,
  pageNumber,
  width,
  overlay,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
} & Pick<PdfScoreViewProps, 'overlay'>) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Page shape, known before the first render so overlays line up at once.
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    if (width === 0) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    void doc.getPage(pageNumber).then((page) => {
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      setRatio(base.width / base.height);
      const viewport = page.getViewport({ scale: width / base.width });
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_PX / viewport.width);
      // Render off-screen and swap in when done, so zooming never flashes
      // a blank page — the old rendering stays (scaled) until then.
      const off = document.createElement('canvas');
      off.width = Math.floor(viewport.width * dpr);
      off.height = Math.floor(viewport.height * dpr);
      renderTask = page.render({
        canvas: off,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      renderTask.promise
        .then(() => {
          const canvas = canvasRef.current;
          if (cancelled || !canvas) return;
          canvas.width = off.width;
          canvas.height = off.height;
          canvas.getContext('2d')?.drawImage(off, 0, 0);
        })
        .catch(() => {
          /* cancelled */
        });
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, width]);

  return (
    <div
      // A clearly framed sheet: strong edge plus a soft paper shadow.
      className="relative rounded-sm border border-border-strong bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06),0_10px_30px_-12px_rgba(0,0,0,0.22)]"
      style={{ aspectRatio: ratio ?? undefined }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div className="absolute inset-0">{overlay?.(pageNumber)}</div>
    </div>
  );
};

// A zoom gesture in progress: shown as a CSS transform (instant, no
// re-render) and turned into a real, sharp re-layout when it ends.
interface Session {
  startZoom: number;
  originX: number; // gesture focus, in content pixels at startZoom
  originY: number;
  startX: number; // gesture focus on screen at the start
  startY: number;
  scale: number;
  focusX: number; // gesture focus on screen now
  focusY: number;
}

// Renders a PDF one page below the other, fitted to the width, with an
// overlay per page (bar frames on sheet music). Zooms like a PDF reader:
// pinch with two fingers or on a trackpad, Ctrl/⌘ + scroll wheel, or
// double-tap / double-click; a zoomed score pans by swiping, scrolling or
// dragging with the mouse. A small pill shows the zoom and fits it back.
export const PdfScoreView = ({ url, overlay, mousePan = true, onPinchStart }: PdfScoreViewProps) => {
  const { t } = useI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [liveZoom, setLiveZoom] = useState<number | null>(null);
  const session = useRef<Session | null>(null);
  // Where the focus point must land once the new zoom is laid out.
  const anchor = useRef<Session | null>(null);
  const onPinchStartRef = useRef(onPinchStart);
  onPinchStartRef.current = onPinchStart;

  useEffect(() => {
    // The cleanup destroys the load task (StrictMode mounts effects twice);
    // its rejected promise must not flip the still-mounted instance to error.
    let cancelled = false;
    setDoc(null);
    setError(false);
    const task = pdfjs.getDocument({ url });
    task.promise
      .then((d) => {
        if (!cancelled) setDoc(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [url]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ---- Gesture sessions ----------------------------------------------------

  const begin = useCallback((x: number, y: number) => {
    const content = contentRef.current;
    if (!content) return;
    const rect = content.getBoundingClientRect();
    session.current = {
      startZoom: zoomRef.current,
      originX: x - rect.left,
      originY: y - rect.top,
      startX: x,
      startY: y,
      scale: 1,
      focusX: x,
      focusY: y,
    };
    content.style.transformOrigin = `${x - rect.left}px ${y - rect.top}px`;
    content.style.willChange = 'transform';
  }, []);

  const update = useCallback((scale: number, x: number, y: number) => {
    const s = session.current;
    const content = contentRef.current;
    if (!s || !content) return;
    s.scale = clampZoom(s.startZoom * scale) / s.startZoom;
    s.focusX = x;
    s.focusY = y;
    content.style.transform = `translate(${x - s.startX}px, ${y - s.startY}px) scale(${s.scale})`;
    setLiveZoom(s.startZoom * s.scale);
  }, []);

  // Keeps the focus point under the finger/cursor after a zoom change.
  const applyAnchor = useCallback(() => {
    const a = anchor.current;
    const content = contentRef.current;
    const viewport = viewportRef.current;
    anchor.current = null;
    if (!content || !viewport) return;
    content.style.transform = '';
    content.style.willChange = '';
    if (!a) return;
    const rect = content.getBoundingClientRect();
    viewport.scrollLeft += rect.left + a.originX * a.scale - a.focusX;
    verticalScroller(viewport).scrollTop += rect.top + a.originY * a.scale - a.focusY;
  }, []);

  const end = useCallback(() => {
    const s = session.current;
    session.current = null;
    setLiveZoom(null);
    if (!s) return;
    const next = clampZoom(s.startZoom * s.scale);
    // Snap back to "fit" when released close to it.
    const snapped = Math.abs(next - 1) < 0.08 ? 1 : next;
    anchor.current = { ...s, scale: snapped / s.startZoom };
    if (snapped === zoomRef.current) applyAnchor();
    else setZoom(snapped);
  }, [applyAnchor]);

  useLayoutEffect(() => {
    applyAnchor();
  }, [zoom, applyAnchor]);

  // Animated zoom to a target around a point (double-tap, the fit button).
  const animateTo = useCallback(
    (target: number, x: number, y: number) => {
      begin(x, y);
      const from = zoomRef.current;
      const started = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - started) / 220);
        const eased = 1 - (1 - k) ** 3;
        update((from + (target - from) * eased) / from, x, y);
        if (k < 1) requestAnimationFrame(step);
        else end();
      };
      requestAnimationFrame(step);
    },
    [begin, update, end],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    // Two-finger pinch (also pans while pinching).
    let pinchDist = 0;
    let lastTouchAt = 0;
    let tap: { at: number; x: number; y: number } | null = null;
    let tapStart: { x: number; y: number; at: number } | null = null;
    const mid = (e: TouchEvent) => ({
      x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
      y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
    });
    const dist = (e: TouchEvent) =>
      Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);

    const onTouchStart = (e: TouchEvent) => {
      lastTouchAt = Date.now();
      if (e.touches.length === 2) {
        e.preventDefault();
        tapStart = null;
        onPinchStartRef.current?.();
        const m = mid(e);
        pinchDist = dist(e);
        begin(m.x, m.y);
      } else if (e.touches.length === 1) {
        tapStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now() };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (tapStart && e.touches.length === 1) {
        const tt = e.touches[0];
        if (Math.hypot(tt.clientX - tapStart.x, tt.clientY - tapStart.y) > 10) tapStart = null;
      }
      if (!session.current || e.touches.length !== 2) return;
      e.preventDefault(); // no page scroll/zoom while pinching
      const m = mid(e);
      update(dist(e) / pinchDist, m.x, m.y);
    };
    const onTouchEnd = (e: TouchEvent) => {
      lastTouchAt = Date.now();
      if (session.current && e.touches.length < 2) {
        end();
        return;
      }
      // Double-tap toggles between "fit" and zoomed in on that spot.
      if (tapStart && e.touches.length === 0 && Date.now() - tapStart.at < 300) {
        const { x, y } = tapStart;
        const now = Date.now();
        if (tap && now - tap.at < 320 && Math.hypot(x - tap.x, y - tap.y) < 30) {
          tap = null;
          animateTo(isFit(zoomRef.current) ? DOUBLE_TAP_ZOOM : 1, x, y);
        } else {
          tap = { at: now, x, y };
        }
      }
      tapStart = null;
    };

    // Trackpad pinch and Ctrl/⌘ + wheel arrive as wheel events with ctrlKey.
    let wheelTimer = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (!session.current) begin(e.clientX, e.clientY);
      const s = session.current;
      if (!s) return;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      update(s.scale * Math.exp(-delta * 0.01), e.clientX, e.clientY);
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(end, 160);
    };

    // Safari on macOS reports trackpad pinches as gesture events instead.
    type GestureEvent = Event & { scale: number; clientX: number; clientY: number };
    const fromTouch = () => Date.now() - lastTouchAt < 1000;
    const onGestureStart = (e: Event) => {
      e.preventDefault(); // never let the browser zoom the whole page
      if (fromTouch()) return;
      const g = e as GestureEvent;
      begin(g.clientX, g.clientY);
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (fromTouch() || !session.current) return;
      const g = e as GestureEvent;
      update(g.scale, g.clientX, g.clientY);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      if (!fromTouch()) end();
    };

    const onDblClick = (e: MouseEvent) => {
      if (fromTouch()) return; // handled as a double-tap
      animateTo(isFit(zoomRef.current) ? DOUBLE_TAP_ZOOM : 1, e.clientX, e.clientY);
    };

    viewport.addEventListener('touchstart', onTouchStart, { passive: false });
    viewport.addEventListener('touchmove', onTouchMove, { passive: false });
    viewport.addEventListener('touchend', onTouchEnd);
    viewport.addEventListener('touchcancel', onTouchEnd);
    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('gesturestart', onGestureStart);
    viewport.addEventListener('gesturechange', onGestureChange);
    viewport.addEventListener('gestureend', onGestureEnd);
    viewport.addEventListener('dblclick', onDblClick);
    return () => {
      window.clearTimeout(wheelTimer);
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('touchend', onTouchEnd);
      viewport.removeEventListener('touchcancel', onTouchEnd);
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('gesturestart', onGestureStart);
      viewport.removeEventListener('gesturechange', onGestureChange);
      viewport.removeEventListener('gestureend', onGestureEnd);
      viewport.removeEventListener('dblclick', onDblClick);
    };
  }, [begin, update, end, animateTo]);

  // ---- Mouse drag to pan a zoomed score -------------------------------------

  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const canPan = mousePan && zoom > 1;

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!canPan || e.pointerType !== 'mouse' || e.button !== 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      left: viewport.scrollLeft,
      top: verticalScroller(viewport).scrollTop,
      moved: false,
    };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    const viewport = viewportRef.current;
    if (!d || !viewport || e.buttons === 0) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    if (!d.moved) {
      d.moved = true;
      setGrabbing(true);
    }
    viewport.scrollLeft = d.left - (e.clientX - d.x);
    verticalScroller(viewport).scrollTop = d.top - (e.clientY - d.y);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setGrabbing(false);
    if (d?.moved) {
      // The release after a drag must not count as a tap on a bar.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    }
  };

  const shownZoom = liveZoom ?? zoom;

  return (
    <div className="relative">
      {/* Zoom level + back to "fit" while zoomed (the only visible control). */}
      {!isFit(shownZoom) && (
        <div className="pointer-events-none sticky top-16 z-20 flex h-0 justify-end md:top-3">
          <button
            type="button"
            onClick={() => {
              const v = viewportRef.current?.getBoundingClientRect();
              if (v) animateTo(1, v.left + v.width / 2, Math.max(v.top, 0) + 80);
            }}
            className="pointer-events-auto mr-2 mt-2 inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-surface/70 px-3 text-xs font-semibold tabular-nums text-text shadow-md backdrop-blur-xl transition-colors hover:bg-surface"
            title={t('fitWidth')}
          >
            {Math.round(shownZoom * 100)} %
            <span className="h-3 w-px bg-border" />
            <Minimize2 size={13} />
            {t('fitWidth')}
          </button>
        </div>
      )}
      <div
        ref={viewportRef}
        className="overflow-x-auto overscroll-x-contain"
        // Native one-finger scrolling stays; pinch is ours (not page zoom).
        style={{ touchAction: 'pan-x pan-y', cursor: canPan ? (grabbing ? 'grabbing' : 'grab') : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          ref={contentRef}
          // Centred when zoomed out below the full width.
          className="mx-auto flex flex-col pb-1"
          // The gap between pages scales too, so zooming keeps its focus point.
          style={{ width: width ? Math.floor(width * zoom) : undefined, gap: 20 * zoom }}
        >
          {error ? (
            <p className="rounded-md border border-border bg-surface px-4 py-6 text-center text-sm text-text-secondary">
              {t('pdfLoadError')}
            </p>
          ) : doc ? (
            Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage
                key={i + 1}
                doc={doc}
                pageNumber={i + 1}
                width={Math.floor(width * zoom)}
                overlay={overlay}
              />
            ))
          ) : (
            <PageSpinner />
          )}
        </div>
      </div>
    </div>
  );
};
