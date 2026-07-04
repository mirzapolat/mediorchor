import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
// Vite only rewrites relative paths inside `new URL(..., import.meta.url)`,
// so the worker must be pulled in as an asset URL import instead.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PageSpinner } from './Spinner';
import { useI18n } from '@/lib/i18n';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfScoreViewProps {
  url: string;
  // Absolutely-positioned children laid over a page (coordinates in % of the
  // page size work out of the box — the overlay covers the page exactly).
  overlay?: (page: number) => ReactNode;
  // Fired with fractional page coordinates (0..1) when a page is clicked.
  onPageClick?: (page: number, x: number, y: number) => void;
  clickCursor?: 'default' | 'crosshair';
}

const PdfPage = ({
  doc,
  pageNumber,
  width,
  overlay,
  onPageClick,
  clickCursor,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
} & Pick<PdfScoreViewProps, 'overlay' | 'onPageClick' | 'clickCursor'>) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (width === 0) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    void doc.getPage(pageNumber).then((page) => {
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const scale = width / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      renderTask = page.render({
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      renderTask.promise.catch(() => {
        /* cancelled */
      });
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, width]);

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onPageClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onPageClick(
      pageNumber,
      (e.clientX - rect.left) / rect.width,
      (e.clientY - rect.top) / rect.height,
    );
  };

  return (
    <div
      className="relative border border-border bg-white"
      style={{ cursor: clickCursor }}
      onClick={handleClick}
    >
      <canvas ref={canvasRef} className="block w-full" />
      <div className="absolute inset-0">{overlay?.(pageNumber)}</div>
    </div>
  );
};

// Renders a PDF at full container width, one page below the other, with a
// positioned overlay per page (used to pin bar buttons onto sheet music).
export const PdfScoreView = ({ url, overlay, onPageClick, clickCursor }: PdfScoreViewProps) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);
  const [width, setWidth] = useState(0);

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
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="space-y-3">
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
            width={width}
            overlay={overlay}
            onPageClick={onPageClick}
            clickCursor={clickCursor}
          />
        ))
      ) : (
        <PageSpinner />
      )}
    </div>
  );
};
