import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { GripVertical, X } from 'lucide-react';
import { useDragReorder } from '@/hooks/useDragReorder';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { TRACK_RECORDING_FIELDS, type TrackRecordingField } from '@/lib/pieceFiles';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import type { PieceFile, PieceTrack } from '@/types';

// Where a file can be connected: the piece's score PDF, one of a voice's
// four recordings, or the bars' source (a MusicXML or MuseScore's bar timing
// only matter there).
type NodeTarget = 'score' | 'bars';
export type WireTarget = NodeTarget | `voice:${string}:${TrackRecordingField}`;

export const voiceTarget = (trackId: string, field: TrackRecordingField): WireTarget => `voice:${trackId}:${field}`;

export const parseVoiceTarget = (target: WireTarget): { trackId: string; field: TrackRecordingField } | null => {
  const m = /^voice:(.+):([a-z_]+)$/.exec(target);
  return m ? { trackId: m[1], field: m[2] as TrackRecordingField } : null;
};

export const isScoreFile = (f: PieceFile) => f.kind === 'score' || /\.pdf$/i.test(f.file_name ?? '');

// Whether a file fits an input.
export const accepts = (file: PieceFile, target: WireTarget): boolean => {
  if (!file.file_path) return false;
  if (target === 'score') return isScoreFile(file);
  // Bars: from MuseScore's timing, a MusicXML, or spread over a recording.
  if (target === 'bars') return file.kind === 'notation' || file.kind === 'audio';
  return file.kind === 'audio';
};

// The four recordings in reading order: other voices muted / quiet, each
// without and with metronome.
const SLOT_LABELS: Record<TrackRecordingField, [TranslationKey, TranslationKey]> = {
  file_id: ['othersMuted', 'withoutMetronome'],
  click_file_id: ['othersMuted', 'withMetronome'],
  quiet_file_id: ['othersQuiet', 'withoutMetronome'],
  quiet_click_file_id: ['othersQuiet', 'withMetronome'],
};

interface Point {
  x: number;
  y: number;
}

// Files on the left, what they feed on the right — voices (four inputs
// each) and the score nodes — joined by wires like in a node editor. Drag
// from a file's point to an input to connect it; both lists reorder by
// their grips. On small screens the wires are left out: the inputs only
// name what is connected.
export const FileWiring = ({
  files,
  tracks,
  picks,
  fileLabel,
  renderFile,
  renderVoiceHeader,
  filesTop,
  filesBottom,
  voicesBottom,
  barsBody,
  onReorderFiles,
  onReorderTracks,
  onConnect,
}: {
  files: PieceFile[];
  tracks: PieceTrack[];
  picks: Record<NodeTarget, string | null>;
  fileLabel: (file: PieceFile) => string;
  renderFile: (file: PieceFile) => ReactNode;
  renderVoiceHeader: (track: PieceTrack) => ReactNode;
  filesTop?: ReactNode;
  filesBottom?: ReactNode;
  voicesBottom?: ReactNode;
  // The bars node's own controls (what was read, apply, fitting, …).
  barsBody?: ReactNode;
  onReorderFiles: (files: PieceFile[]) => void;
  onReorderTracks: (tracks: PieceTrack[]) => void;
  onConnect: (target: WireTarget, fileId: string | null) => void;
}) => {
  const { t } = useI18n();
  const wired = useMediaQuery('(min-width: 1024px)');
  const boxRef = useRef<HTMLDivElement>(null);
  const [ports, setPorts] = useState<{ out: Record<string, Point>; in: Record<string, Point> }>({ out: {}, in: {} });
  // A wire being drawn from a file's point.
  const [drawing, setDrawing] = useState<{ fileId: string; at: Point; over: WireTarget | null } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const fileDnd = useDragReorder(files, (f) => f.id, onReorderFiles, 0);
  const trackDnd = useDragReorder(tracks, (x) => x.id, onReorderTracks, 12);

  // Every connection: input → file.
  const connections: Array<{ target: WireTarget; fileId: string }> = [
    ...tracks.flatMap((track) =>
      TRACK_RECORDING_FIELDS.flatMap((field) =>
        track[field] ? [{ target: voiceTarget(track.id, field), fileId: track[field] as string }] : [],
      ),
    ),
    ...(['score', 'bars'] as const).flatMap((key) =>
      picks[key] ? [{ target: key as WireTarget, fileId: picks[key] as string }] : [],
    ),
  ];

  // Where the points are, followed every frame (rows slide while
  // reordering, inputs grow, the window resizes).
  useEffect(() => {
    if (!wired) return;
    let raf = 0;
    let last = '';
    const measure = () => {
      const box = boxRef.current;
      if (box) {
        const origin = box.getBoundingClientRect();
        const read = (attr: string) => {
          const found: Record<string, Point> = {};
          box.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((el) => {
            const r = el.getBoundingClientRect();
            found[el.getAttribute(attr) as string] = {
              x: Math.round(r.left + r.width / 2 - origin.left),
              y: Math.round(r.top + r.height / 2 - origin.top),
            };
          });
          return found;
        };
        const next = { out: read('data-port-out'), in: read('data-port-in') };
        const key = JSON.stringify(next);
        if (key !== last) {
          last = key;
          setPorts(next);
        }
      }
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [wired]);

  const fileById = (id: string | null) => (id ? (files.find((f) => f.id === id) ?? null) : null);

  const local = (clientX: number, clientY: number): Point => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  const inputAt = (clientX: number, clientY: number): WireTarget | null => {
    const el = document.elementFromPoint(clientX, clientY)?.closest('[data-input]');
    return (el?.getAttribute('data-input') as WireTarget | null) ?? null;
  };

  const startWire = (e: PointerEvent, fileId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawing({ fileId, at: local(e.clientX, e.clientY), over: null });
  };
  const moveWire = (e: PointerEvent) => {
    if (!drawing) return;
    setDrawing({ ...drawing, at: local(e.clientX, e.clientY), over: inputAt(e.clientX, e.clientY) });
  };
  const endWire = (e: PointerEvent) => {
    if (!drawing) return;
    const target = inputAt(e.clientX, e.clientY);
    const file = fileById(drawing.fileId);
    setDrawing(null);
    if (target && file && accepts(file, target)) onConnect(target, file.id);
  };

  const drawnFile = drawing ? fileById(drawing.fileId) : null;

  // A soft S-curve from a file's point to an input.
  const curve = (a: Point, b: Point) => {
    const dx = Math.max(30, Math.abs(b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  };

  // One input: its point (wide screens), what it is, and what is connected.
  const input = (target: WireTarget, label: string) => {
    const voice = parseVoiceTarget(target);
    const fileId = voice
      ? (tracks.find((x) => x.id === voice.trackId)?.[voice.field] ?? null)
      : picks[target as NodeTarget];
    const file = fileById(fileId);
    const fits = drawnFile ? accepts(drawnFile, target) : false;
    return (
      <div
        key={target}
        data-input={target}
        className={cn(
          'relative flex min-h-[2.75rem] items-center gap-2 border-t border-border py-1.5 pl-4 pr-1.5 transition-colors duration-150',
          drawing && fits && 'bg-accent/10',
          drawing && fits && drawing.over === target && 'bg-accent/25',
          drawing && !fits && 'opacity-40',
        )}
      >
        {wired && (
          <span
            data-port-in={target}
            aria-hidden
            className={cn(
              'absolute -left-[8px] top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 transition-colors duration-150',
              file ? 'border-black bg-black' : 'border-border-strong bg-surface',
              drawing && fits && 'border-accent',
            )}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium text-text-secondary">{label}</div>
          <div className={cn('truncate text-sm', file ? 'text-text' : 'text-text-tertiary')}>
            {file ? fileLabel(file) : t('notConnected')}
          </div>
        </div>
        {file && (
          <button
            type="button"
            onClick={() => onConnect(target, null)}
            aria-label={`${t('disconnect')}: ${label}`}
            title={t('disconnect')}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
          >
            <X size={14} />
          </button>
        )}
      </div>
    );
  };

  const grip = (onDown: (e: PointerEvent) => void, onMove: (e: PointerEvent) => void, onUp: () => void) => (
    <button
      type="button"
      aria-label={t('reorder')}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{ touchAction: 'none' }}
      className="flex w-8 flex-shrink-0 cursor-grab items-center justify-center self-stretch text-text-tertiary hover:text-text-secondary active:cursor-grabbing"
    >
      <GripVertical size={16} />
    </button>
  );

  const shift = (dnd: typeof fileDnd, id: string, index: number) =>
    dnd.dragActive
      ? {
          transform: `translateY(${dnd.shiftFor(index)}px)`,
          transition: dnd.isDragging(id) ? 'none' : 'transform 150ms ease',
          position: 'relative' as const,
          zIndex: dnd.isDragging(id) ? 20 : undefined,
        }
      : undefined;

  const heading = (title: string, count?: number) => (
    <h3 className="text-sm font-semibold">
      {title}
      {count ? <span className="font-normal text-text-secondary"> · {count}</span> : null}
    </h3>
  );

  return (
    <div ref={boxRef} className="relative grid gap-6 lg:grid-cols-2 lg:gap-x-24">
      {/* Files */}
      <div className="min-w-0 space-y-3">
        {filesTop}
        {heading(t('uploadedFiles'), files.length)}
        {files.length === 0 ? (
          <p className="text-sm text-text-secondary">{t('noFiles')}</p>
        ) : (
          <ul className="rounded-md border border-border bg-surface">
            {files.map((f, index) => {
              const linked = connections.some((c) => c.fileId === f.id);
              return (
                <li
                  key={f.id}
                  ref={(el) => fileDnd.setItemRef(f.id, el)}
                  style={shift(fileDnd, f.id, index)}
                  onPointerEnter={() => setHovered(f.id)}
                  onPointerLeave={() => setHovered((h) => (h === f.id ? null : h))}
                  className={cn(
                    'relative flex items-stretch border-b border-border bg-surface first:rounded-t-md last:rounded-b-md last:border-b-0',
                    fileDnd.isDragging(f.id) && 'rounded-md shadow-lg ring-1 ring-border',
                  )}
                >
                  {files.length > 1 &&
                    grip((e) => fileDnd.startDrag(e, f.id, index), fileDnd.moveDrag, fileDnd.endDrag)}
                  <div className={cn('min-w-0 flex-1', files.length < 2 && 'pl-2', wired && 'pr-3')}>
                    {renderFile(f)}
                  </div>
                  {wired && f.file_path && (
                    <button
                      type="button"
                      data-port-out={f.id}
                      aria-label={t('connectFile').replace('{name}', fileLabel(f))}
                      title={t('wireHint')}
                      onPointerDown={(e) => startWire(e, f.id)}
                      onPointerMove={moveWire}
                      onPointerUp={endWire}
                      onPointerCancel={() => setDrawing(null)}
                      style={{ touchAction: 'none' }}
                      className={cn(
                        'absolute -right-[8px] top-1/2 z-20 h-4 w-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 transition-transform duration-150 hover:scale-125',
                        linked ? 'border-black bg-black' : 'border-border-strong bg-surface hover:border-black',
                      )}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {filesBottom}
      </div>

      {/* The score PDF, the voices and the bars */}
      <div className="min-w-0 space-y-3">
        <p className="text-sm text-text-secondary">{wired ? t('wireHint') : t('wireDesktopOnly')}</p>
        {heading(t('scoreNodesTitle'))}
        <div className="rounded-md border border-border bg-surface">
          <div className="px-3 py-2">
            <div className="text-sm font-medium">{t('scoreFileLabel')}</div>
            <div className="text-xs text-text-secondary">{t('scoreFileHint')}</div>
          </div>
          {input('score', t('nodeInput'))}
        </div>

        <div className="pt-3">{heading(t('voicesTitle'), tracks.length)}</div>
        {tracks.length > 0 && (
          <ul className="flex flex-col gap-3">
            {tracks.map((track, index) => (
              <li
                key={track.id}
                ref={(el) => trackDnd.setItemRef(track.id, el)}
                style={shift(trackDnd, track.id, index)}
                className={cn('rounded-md border border-border bg-surface', trackDnd.isDragging(track.id) && 'shadow-lg')}
              >
                <div className="flex items-stretch">
                  {tracks.length > 1 &&
                    grip((e) => trackDnd.startDrag(e, track.id, index), trackDnd.moveDrag, trackDnd.endDrag)}
                  <div className={cn('min-w-0 flex-1 py-1.5 pr-1.5', tracks.length < 2 && 'pl-2')}>
                    {renderVoiceHeader(track)}
                  </div>
                </div>
                {TRACK_RECORDING_FIELDS.map((field) =>
                  input(voiceTarget(track.id, field), SLOT_LABELS[field].map((k) => t(k)).join(' · ')),
                )}
              </li>
            ))}
          </ul>
        )}
        {voicesBottom}

        {/* The bars: one source (what is connected picks how they are
            read), applied with the node's own button. */}
        <div className="space-y-3 pt-3">
          {heading(t('barsTitle'))}
          <div className="rounded-md border border-border bg-surface">
            <div className="px-3 py-2">
              <div className="text-sm font-medium">{t('barsSource')}</div>
              <div className="text-xs text-text-secondary">{t('barsSourceHint')}</div>
            </div>
            {input('bars', t('nodeInput'))}
            {barsBody && <div className="space-y-3 border-t border-border p-3">{barsBody}</div>}
          </div>
        </div>
      </div>

      {/* The wires, over everything but never in the way. */}
      {wired && (
        <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible" aria-hidden>
          {connections.map(({ target, fileId }) => {
            const a = ports.out[fileId];
            const b = ports.in[target];
            if (!a || !b) return null;
            const lit = hovered === fileId || drawing?.fileId === fileId;
            return (
              <path
                key={`${target}-${fileId}`}
                d={curve(a, b)}
                fill="none"
                stroke={lit ? 'rgb(var(--c-text))' : 'rgb(var(--c-text-tertiary))'}
                strokeWidth={lit ? 2 : 1.5}
              />
            );
          })}
          {drawing && ports.out[drawing.fileId] && (
            <path
              d={curve(
                ports.out[drawing.fileId],
                drawing.over && ports.in[drawing.over] ? ports.in[drawing.over] : drawing.at,
              )}
              fill="none"
              stroke="rgb(var(--c-accent))"
              strokeWidth={2}
              strokeDasharray="5 4"
            />
          )}
        </svg>
      )}
    </div>
  );
};
