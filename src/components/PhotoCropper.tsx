import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useI18n } from '@/lib/i18n';

// Size of the crop area on screen and (default) of the saved image, in px.
const VIEWPORT = 288;
const OUTPUT = 512;
const MAX_ZOOM = 4;

interface View {
  // Zoom relative to the smallest scale that still fills the crop area.
  zoom: number;
  // Position of the image's top-left corner inside the crop area.
  x: number;
  y: number;
}

// Lets the user move and zoom a picked photo inside a frame and returns the
// square crop as a JPEG file. The frame is a circle for avatars ('circle') or
// the whole square for images shown as squares, like registration covers.
export const PhotoCropper = ({
  file,
  onCancel,
  onConfirm,
  shape = 'circle',
  outputSize = OUTPUT,
  format = 'jpeg',
}: {
  // The picked image; the dialog is open while set.
  file: File | null;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
  shape?: 'circle' | 'square';
  // Edge length of the saved image in px.
  outputSize?: number;
  // PNG keeps transparency (logos); JPEG is smaller (photos).
  format?: 'jpeg' | 'png';
}) => {
  const { t } = useI18n();
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setSrc(url);
    setNatural(null);
    setSaving(false);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Scale at zoom 1: the shorter side exactly fills the crop area.
  const baseScale = natural ? VIEWPORT / Math.min(natural.w, natural.h) : 1;
  const scaleOf = (zoom: number) => baseScale * zoom;

  // Keeps the image covering the whole crop area.
  const clamp = (next: View): View => {
    if (!natural) return next;
    const s = scaleOf(next.zoom);
    return {
      zoom: next.zoom,
      x: Math.min(0, Math.max(VIEWPORT - natural.w * s, next.x)),
      y: Math.min(0, Math.max(VIEWPORT - natural.h * s, next.y)),
    };
  };

  const onLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const s = VIEWPORT / Math.min(w, h);
    setNatural({ w, h });
    // Start centered.
    setView({ zoom: 1, x: (VIEWPORT - w * s) / 2, y: (VIEWPORT - h * s) / 2 });
  };

  // Zooms around the center of the crop area.
  const zoomTo = (zoom: number) => {
    setView((current) => {
      const nextZoom = Math.min(MAX_ZOOM, Math.max(1, zoom));
      const ratio = nextZoom / current.zoom;
      const c = VIEWPORT / 2;
      return clamp({ zoom: nextZoom, x: c - (c - current.x) * ratio, y: c - (c - current.y) * ratio });
    });
  };

  const startDrag = (e: PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { pointerX: e.clientX, pointerY: e.clientY, x: view.x, y: view.y };
  };
  const moveDrag = (e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setView((current) =>
      clamp({ ...current, x: drag.x + e.clientX - drag.pointerX, y: drag.y + e.clientY - drag.pointerY }),
    );
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const onWheel = (e: WheelEvent) => zoomTo(view.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));

  const confirm = async () => {
    const img = imgRef.current;
    if (!img || !natural) return;
    setSaving(true);
    const s = scaleOf(view.zoom);
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Transparent areas (e.g. PNGs) become white in a JPEG; a PNG keeps them.
    if (format === 'jpeg') {
      ctx.fillStyle = '#ffffff'; // theme-ok: exported JPEG background
      ctx.fillRect(0, 0, outputSize, outputSize);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, -view.x / s, -view.y / s, VIEWPORT / s, VIEWPORT / s, 0, 0, outputSize, outputSize);
    const type = format === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
    if (!blob) {
      setSaving(false);
      return;
    }
    onConfirm(new File([blob], format === 'png' ? 'image.png' : 'photo.jpg', { type }));
  };

  const s = scaleOf(view.zoom);

  return (
    <Modal
      open={Boolean(file)}
      title={t('cropPhoto')}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void confirm()} disabled={!natural || saving}>
            {saving ? t('loading') : t('cropApply')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-secondary">{shape === 'square' ? t('cropSquareHint') : t('cropPhotoHint')}</p>
      <div className="flex justify-center">
        <div
          className="relative cursor-grab touch-none select-none overflow-hidden rounded-md bg-surface-hover active:cursor-grabbing"
          style={{ width: VIEWPORT, height: VIEWPORT }}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={onWheel}
        >
          {src && (
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              onLoad={onLoad}
              className="absolute left-0 top-0 max-w-none origin-top-left"
              style={
                natural
                  ? { width: natural.w * s, height: natural.h * s, transform: `translate(${view.x}px, ${view.y}px)` }
                  : { opacity: 0 }
              }
            />
          )}
          {/* Circle: dims everything outside the circle that becomes the avatar.
              Square: the whole area is kept; a thin rule-of-thirds grid helps
              framing. Both sit on the photo, not the page, so they look the
              same in both themes. */}
          {shape === 'circle' ? (
            <div
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{ boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)', outline: '2px solid rgba(255,255,255,0.9)' }} // theme-ok: overlay on the photo
            />
          ) : (
            <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-paper/90">
              <span className="absolute inset-y-0 left-1/3 w-px bg-paper/40" />
              <span className="absolute inset-y-0 left-2/3 w-px bg-paper/40" />
              <span className="absolute inset-x-0 top-1/3 h-px bg-paper/40" />
              <span className="absolute inset-x-0 top-2/3 h-px bg-paper/40" />
            </div>
          )}
        </div>
      </div>
      <div className="mx-auto flex max-w-[288px] items-center gap-3">
        <button
          type="button"
          aria-label={t('zoomOut')}
          onClick={() => zoomTo(view.zoom / 1.2)}
          className="text-text-secondary hover:text-text"
        >
          <ZoomOut size={18} />
        </button>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={view.zoom}
          onChange={(e) => zoomTo(Number(e.target.value))}
          aria-label={t('zoom')}
          className="flex-1 accent-black"
        />
        <button
          type="button"
          aria-label={t('zoomIn')}
          onClick={() => zoomTo(view.zoom * 1.2)}
          className="text-text-secondary hover:text-text"
        >
          <ZoomIn size={18} />
        </button>
      </div>
    </Modal>
  );
};
