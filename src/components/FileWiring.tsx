import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { AudioLines as AudioLinesIcon, FileText, GripVertical, Mic, Ruler, Users, X, type LucideIcon } from 'lucide-react';
import { fileIcon, fileTone } from '@/components/PieceFileParts';
import { GroupPill } from '@/components/GroupPill';
import { noteName } from '@/tonetrainer/core';
import type { TrainerVoice } from '@/lib/trainer';
import { useDragReorder } from '@/hooks/useDragReorder';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { TRACK_RECORDING_FIELDS, type TrackRecordingField } from '@/lib/pieceFiles';
import { isNotationFileName } from '@/lib/musicxml';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import type { PieceFile, PieceTrack, ProjectGroup } from '@/types';

// Where a file can be connected: the piece's score PDF, one of a voice's
// four recordings, the bars' source (a MusicXML or MuseScore's bar timing
// only matter there), or the singing trainer's MusicXML.
type NodeTarget = 'score' | 'bars' | 'trainer';
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
  if (target === 'trainer') return file.kind === 'notation' && isNotationFileName(file.file_name ?? '');
  return file.kind === 'audio';
};

// The four recordings in reading order: other voices muted / quiet, each
// without and with metronome — said shortly, the metronome as a badge.
const SLOT_LABELS: Record<TrackRecordingField, { others: TranslationKey; click: boolean; full: [TranslationKey, TranslationKey] }> = {
  file_id: { others: 'slotMutedShort', click: false, full: ['slotOthersMuted', 'slotWithoutMetronome'] },
  click_file_id: { others: 'slotMutedShort', click: true, full: ['slotOthersMuted', 'slotWithMetronome'] },
  quiet_file_id: { others: 'slotQuietShort', click: false, full: ['slotOthersQuiet', 'slotWithoutMetronome'] },
  quiet_click_file_id: { others: 'slotQuietShort', click: true, full: ['slotOthersQuiet', 'slotWithMetronome'] },
};

// A node on the right: a tinted icon tile, its title and state, actions,
// and its inputs (or outputs) as rows below.
const NodeCard = ({
  icon: Icon,
  tone = 'text-text-secondary',
  title,
  hint,
  status,
  actions,
  accent = false,
  children,
  ...rest
}: {
  icon: LucideIcon;
  tone?: string;
  title: ReactNode;
  hint?: string;
  status?: ReactNode;
  actions?: ReactNode;
  accent?: boolean;
  children?: ReactNode;
  'data-trainer-node'?: boolean;
}) => (
  <div {...rest} className={cn('min-w-0 rounded-2xl border bg-surface', accent ? 'border-accent/50' : 'border-border')}>
    <div className="flex min-h-[3.25rem] items-center gap-3 py-2 pl-3 pr-2">
      <span
        className={cn(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
          accent ? 'bg-accent/15 text-accent' : cn('bg-surface-muted', tone),
        )}
      >
        <Icon size={16} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold" title={hint}>
          {title}
        </div>
        {status && <div className="truncate text-xs text-text-tertiary">{status}</div>}
      </div>
      {actions}
    </div>
    {children}
  </div>
);

// A small caps label over a group of nodes, with room for an action.
const SectionLabel = ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
  <div className="flex min-h-[2rem] items-center justify-between gap-3">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{children}</h3>
    {action}
  </div>
);

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
  filesEmpty,
  filesBottom,
  voicesBottom,
  voicesAction,
  barsStatus,
  barsBody,
  trainerBody,
  trainerVoices = [],
  groups = [],
  voiceMap,
  onMapVoice,
  scoreHeader,
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
  // In place of the nodes while there are none.
  filesEmpty?: ReactNode;
  filesBottom?: ReactNode;
  voicesBottom?: ReactNode;
  // On the voices' label (e.g. "Add voice").
  voicesAction?: ReactNode;
  // Under the bars node's title: how the bars are read.
  barsStatus?: ReactNode;
  // The bars node's own controls (what was read, apply, fitting, …).
  barsBody?: ReactNode;
  // Under the trainer node: its state while there are no voices to list.
  trainerBody?: ReactNode;
  // The voices the trainer found, each an output wired to the groups that
  // sing it (a third column; only inside a project, which has groups).
  trainerVoices?: TrainerVoice[];
  groups?: ProjectGroup[];
  // Group id → the voice ids it sings.
  voiceMap?: Map<string, string[]>;
  onMapVoice?: (groupId: string, trackId: string, on: boolean) => void;
  // On the score node's title row (the connected PDF's download switch).
  scoreHeader?: ReactNode;
  onReorderFiles: (files: PieceFile[]) => void;
  onReorderTracks: (tracks: PieceTrack[]) => void;
  onConnect: (target: WireTarget, fileId: string | null) => void;
}) => {
  const { t } = useI18n();
  const wired = useMediaQuery('(min-width: 1024px)');
  const boxRef = useRef<HTMLDivElement>(null);
  // `trainerTop`: where the trainer node starts, so the groups node beside
  // it lines up with it.
  const [ports, setPorts] = useState<{ out: Record<string, Point>; in: Record<string, Point>; trainerTop: number }>({
    out: {},
    in: {},
    trainerTop: 0,
  });
  // A wire being drawn from a file's point.
  const [drawing, setDrawing] = useState<{ fileId: string; at: Point; over: WireTarget | null } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  // A wire being drawn from a trainer voice to a group.
  const [voiceDrawing, setVoiceDrawing] = useState<{ trackId: string; at: Point; over: string | null } | null>(null);
  // The groups column: inside a project, once the trainer has voices.
  const mapping = groups.length > 0 && trainerVoices.length > 0 && onMapVoice != null;
  const voiceLinks = groups.flatMap((g) =>
    (voiceMap?.get(g.id) ?? [])
      .filter((trackId) => trainerVoices.some((v) => v.id === trackId))
      .map((trackId) => ({ groupId: g.id, trackId })),
  );

  const fileDnd = useDragReorder(files, (f) => f.id, onReorderFiles, 8);
  const trackDnd = useDragReorder(tracks, (x) => x.id, onReorderTracks, 12);

  // Every connection: input → file.
  const connections: Array<{ target: WireTarget; fileId: string }> = [
    ...tracks.flatMap((track) =>
      TRACK_RECORDING_FIELDS.flatMap((field) =>
        track[field] ? [{ target: voiceTarget(track.id, field), fileId: track[field] as string }] : [],
      ),
    ),
    ...(['score', 'bars', 'trainer'] as const).flatMap((key) =>
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
        const trainer = box.querySelector('[data-trainer-node]')?.getBoundingClientRect();
        const next = {
          out: read('data-port-out'),
          in: read('data-port-in'),
          trainerTop: trainer ? Math.round(trainer.top - origin.top) : 0,
        };
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

  // Voice → group wires: the same gesture as for files.
  const groupAt = (clientX: number, clientY: number): string | null =>
    document.elementFromPoint(clientX, clientY)?.closest('[data-group-input]')?.getAttribute('data-group-input') ??
    null;
  const startVoiceWire = (e: PointerEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setVoiceDrawing({ trackId, at: local(e.clientX, e.clientY), over: null });
  };
  const moveVoiceWire = (e: PointerEvent) => {
    if (!voiceDrawing) return;
    setVoiceDrawing({ ...voiceDrawing, at: local(e.clientX, e.clientY), over: groupAt(e.clientX, e.clientY) });
  };
  const endVoiceWire = (e: PointerEvent) => {
    if (!voiceDrawing) return;
    const groupId = groupAt(e.clientX, e.clientY);
    const { trackId } = voiceDrawing;
    setVoiceDrawing(null);
    if (groupId && !(voiceMap?.get(groupId) ?? []).includes(trackId)) onMapVoice?.(groupId, trackId, true);
  };
  const voiceName = (trackId: string) => trainerVoices.find((v) => v.id === trackId)?.name ?? trackId;

  // A soft S-curve from a file's point to an input.
  const curve = (a: Point, b: Point) => {
    const dx = Math.max(30, Math.abs(b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  };

  // One input: its point (wide screens), what it is, and what is connected
  // (a chip with the file's icon), or where to drag a file.
  const input = (target: WireTarget, label?: ReactNode, name = '') => {
    const voice = parseVoiceTarget(target);
    const fileId = voice
      ? (tracks.find((x) => x.id === voice.trackId)?.[voice.field] ?? null)
      : picks[target as NodeTarget];
    const file = fileById(fileId);
    const fits = drawnFile ? accepts(drawnFile, target) : false;
    const Icon = file ? fileIcon(file) : null;
    return (
      <div
        key={target}
        data-input={target}
        className={cn(
          'group/input relative flex h-10 items-center gap-2 border-t border-border pl-4 pr-2 transition-colors duration-150',
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
              'absolute -left-[7px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 transition-colors duration-150',
              file ? 'border-black bg-black' : 'border-border-strong bg-surface',
              drawing && fits && 'border-accent',
            )}
          />
        )}
        {label && <span className="flex flex-shrink-0 items-center gap-1.5 text-xs text-text-secondary">{label}</span>}
        <span className={cn('flex min-w-0 flex-1', label ? 'justify-end' : 'justify-start')}>
          {file && Icon ? (
            <span
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg bg-surface-muted px-2 py-1 text-xs font-medium"
              title={fileLabel(file)}
            >
              <Icon size={13} className={cn('flex-shrink-0', fileTone(file))} aria-hidden />
              <span className="truncate">{fileLabel(file)}</span>
            </span>
          ) : (
            <span className="truncate text-xs text-text-tertiary">{wired ? t('dropFileHere') : t('notConnected')}</span>
          )}
        </span>
        {file ? (
          <button
            type="button"
            onClick={() => onConnect(target, null)}
            aria-label={`${t('disconnect')}: ${name || fileLabel(file)}`}
            title={t('disconnect')}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary opacity-0 transition-opacity duration-150 hover:bg-surface-hover hover:text-text focus:opacity-100 group-hover/input:opacity-100 max-lg:opacity-100"
          >
            <X size={14} />
          </button>
        ) : (
          <span className="w-7 flex-shrink-0" />
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

  return (
    <div
      ref={boxRef}
      // Files: a narrow column of tall nodes, leaving room for the wires and
      // the score, bars and voices.
      className="relative grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-x-40 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] xl:gap-x-48"
    >
      {/* Files */}
      <div className="min-w-0 space-y-2">
        <SectionLabel action={filesTop}>{t('files')}</SectionLabel>
        {files.length === 0 ? (
          (filesEmpty ?? <p className="text-sm text-text-secondary">{t('noFiles')}</p>)
        ) : (
          // Each file its own node (a card like the voices), its output on
          // the right edge.
          <ul className="flex flex-col gap-2">
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
                    'group/node relative flex items-stretch rounded-2xl border bg-surface transition-[border-color,box-shadow] duration-150 hover:shadow-sm',
                    linked ? 'border-border-strong' : 'border-border',
                    fileDnd.isDragging(f.id) && 'shadow-lg ring-1 ring-border',
                  )}
                >
                  {files.length > 1 && (
                    <span className="flex opacity-40 transition-opacity duration-150 group-hover/node:opacity-100">
                      {grip((e) => fileDnd.startDrag(e, f.id, index), fileDnd.moveDrag, fileDnd.endDrag)}
                    </span>
                  )}
                  <div className={cn('min-w-0 flex-1', files.length < 2 && 'pl-3', wired && 'pr-2')}>
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

      {/* Right: what the files feed — the score and the bars, the voices,
          and the singing trainer with the groups its voices are sung by. */}
      <div className="min-w-0 space-y-6">
        {!wired && <p className="text-xs text-text-secondary">{t('wireDesktopOnly')}</p>}

        <section className="space-y-2">
          <SectionLabel>{t('sectionScoreAndBars')}</SectionLabel>
          <NodeCard
            icon={FileText}
            tone="text-danger"
            title={t('scoreFileLabel')}
            hint={t('scoreFileHint')}
            status={picks.score ? t('connected') : t('notConnected')}
            actions={scoreHeader}
          >
            {input('score')}
          </NodeCard>
          {/* The bars: one source (what is connected picks how they are
              read), applied with the node's own button. */}
          <NodeCard icon={Ruler} tone="text-chart-1" title={t('barsSource')} hint={t('barsSourceHint')} status={barsStatus}>
            {input('bars')}
            {barsBody && <div className="space-y-3 border-t border-border p-3">{barsBody}</div>}
          </NodeCard>
        </section>

        <section className="space-y-2">
          <SectionLabel action={voicesAction}>
            {t('voicesTitle')}
            {tracks.length > 0 && <span className="ml-1.5 font-normal normal-case tracking-normal">{tracks.length}</span>}
          </SectionLabel>
          {tracks.length > 0 && (
            <ul className="flex flex-col gap-2">
              {tracks.map((track, index) => {
                const recorded = TRACK_RECORDING_FIELDS.filter((field) => track[field]).length;
                return (
                  <li
                    key={track.id}
                    ref={(el) => trackDnd.setItemRef(track.id, el)}
                    style={shift(trackDnd, track.id, index)}
                    className={cn('group/node rounded-2xl', trackDnd.isDragging(track.id) && 'shadow-lg')}
                  >
                    <NodeCard
                      icon={AudioLinesIcon}
                      tone="text-chart-4"
                      title={renderVoiceHeader(track)}
                      status={`${recorded}/4 ${t('recordingsShort')}`}
                      actions={
                        tracks.length > 1 && (
                          <span className="flex self-stretch opacity-40 transition-opacity duration-150 group-hover/node:opacity-100">
                            {grip((e) => trackDnd.startDrag(e, track.id, index), trackDnd.moveDrag, trackDnd.endDrag)}
                          </span>
                        )
                      }
                    >
                      {TRACK_RECORDING_FIELDS.map((field) => {
                        const slot = SLOT_LABELS[field];
                        const full = slot.full.map((k) => t(k)).join(' – ');
                        return input(
                          voiceTarget(track.id, field),
                          <span title={full} className="flex items-center gap-1.5">
                            {t(slot.others)}
                            {slot.click && (
                              <span className="rounded bg-surface-muted px-1.5 py-px text-[10px] font-semibold text-text-secondary">
                                {t('slotClick')}
                              </span>
                            )}
                          </span>,
                          full,
                        );
                      })}
                    </NodeCard>
                  </li>
                );
              })}
            </ul>
          )}
          {voicesBottom}
        </section>

        {/* The singing trainer: a MusicXML connected here opens the piece for
            practice with the microphone; its voices are outputs, wired to
            the project's groups that sing them (several per group = a
            choice in the trainer). On small screens the voices are tapped
            on and off instead. */}
        <section className="space-y-2">
          <SectionLabel>{t('trainTitle')}</SectionLabel>
          <div className={cn('grid items-start gap-4', mapping && 'md:grid-cols-2 md:gap-x-16')}>
            <NodeCard
              data-trainer-node
              icon={Mic}
              accent
              title={t('trainerNode')}
              hint={t('trainerNodeHint')}
              status={trainerVoices.length ? `${trainerVoices.length} ${t('voicesTitle')}` : t('trainerSubtitle')}
            >
              {input('trainer')}
              {/* The voices found: outputs to wire to the groups. */}
              {trainerVoices.map((v) => {
                const linked = voiceLinks.some((l) => l.trackId === v.id);
                return (
                  <div key={v.id} className="relative flex h-10 items-center gap-2 border-t border-border pl-4 pr-4">
                    <span className="min-w-0 flex-1 truncate text-sm">{v.name}</span>
                    <span className="flex-shrink-0 rounded bg-surface-muted px-1.5 py-px text-[10px] font-semibold tabular-nums text-text-secondary">
                      {noteName(v.low)}–{noteName(v.high)}
                    </span>
                    {wired && mapping && (
                      <button
                        type="button"
                        data-port-out={`voice:${v.id}`}
                        aria-label={t('connectVoice').replace('{name}', v.name)}
                        title={t('voiceWireHint')}
                        onPointerDown={(e) => startVoiceWire(e, v.id)}
                        onPointerMove={moveVoiceWire}
                        onPointerUp={endVoiceWire}
                        onPointerCancel={() => setVoiceDrawing(null)}
                        onPointerEnter={() => setHovered(`voice:${v.id}`)}
                        onPointerLeave={() => setHovered((h) => (h === `voice:${v.id}` ? null : h))}
                        style={{ touchAction: 'none' }}
                        className={cn(
                          'absolute -right-[8px] top-1/2 z-20 h-4 w-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 transition-transform duration-150 hover:scale-125',
                          linked ? 'border-black bg-black' : 'border-border-strong bg-surface hover:border-black',
                        )}
                      />
                    )}
                  </div>
                );
              })}
              {trainerBody && <div className="border-t border-border p-3">{trainerBody}</div>}
            </NodeCard>

            {mapping && (
              <NodeCard icon={Users} title={t('groupsNode')} status={t('groupsNodeHint')}>
                {groups.map((g) => {
                  const mapped = voiceMap?.get(g.id) ?? [];
                  const over = voiceDrawing?.over === g.id;
                  return (
                    <div
                      key={g.id}
                      data-group-input={g.id}
                      className={cn(
                        'relative border-t border-border py-2 pl-4 pr-2 transition-colors duration-150',
                        voiceDrawing && 'bg-accent/10',
                        over && 'bg-accent/25',
                      )}
                    >
                      {wired && (
                        <span
                          data-port-in={`group:${g.id}`}
                          aria-hidden
                          className={cn(
                            'absolute -left-[7px] top-[1.15rem] h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 transition-colors duration-150',
                            mapped.length ? 'border-black bg-black' : 'border-border-strong bg-surface',
                            voiceDrawing && 'border-accent',
                          )}
                        />
                      )}
                      <GroupPill name={g.name} color={g.color} />
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {wired
                          ? mapped.length === 0
                            ? <span className="text-xs text-text-tertiary">{t('groupAllVoices')}</span>
                            : mapped.map((trackId) => (
                                <span
                                  key={trackId}
                                  className="inline-flex items-center gap-1 rounded-full bg-surface-muted py-0.5 pl-2 pr-0.5 text-xs"
                                >
                                  {voiceName(trackId)}
                                  <button
                                    type="button"
                                    onClick={() => onMapVoice?.(g.id, trackId, false)}
                                    aria-label={`${t('disconnect')}: ${voiceName(trackId)}`}
                                    className="flex h-5 w-5 items-center justify-center rounded-full text-text-tertiary hover:bg-surface-hover hover:text-text"
                                  >
                                    <X size={12} />
                                  </button>
                                </span>
                              ))
                          : trainerVoices.map((v) => {
                              const on = mapped.includes(v.id);
                              return (
                                <button
                                  key={v.id}
                                  type="button"
                                  aria-pressed={on}
                                  onClick={() => onMapVoice?.(g.id, v.id, !on)}
                                  className={cn(
                                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150',
                                    on ? 'border-black bg-black text-white' : 'border-border text-text-secondary hover:text-text',
                                  )}
                                >
                                  {v.name}
                                </button>
                              );
                            })}
                      </div>
                    </div>
                  );
                })}
              </NodeCard>
            )}
          </div>
        </section>
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
          {voiceLinks.map(({ groupId, trackId }) => {
            const a = ports.out[`voice:${trackId}`];
            const b = ports.in[`group:${groupId}`];
            if (!a || !b) return null;
            const lit = hovered === `voice:${trackId}`;
            return (
              <path
                key={`${groupId}-${trackId}`}
                d={curve(a, b)}
                fill="none"
                stroke={lit ? 'rgb(var(--c-text))' : 'rgb(var(--c-text-tertiary))'}
                strokeWidth={lit ? 2 : 1.5}
              />
            );
          })}
          {voiceDrawing && ports.out[`voice:${voiceDrawing.trackId}`] && (
            <path
              d={curve(
                ports.out[`voice:${voiceDrawing.trackId}`],
                voiceDrawing.over && ports.in[`group:${voiceDrawing.over}`]
                  ? ports.in[`group:${voiceDrawing.over}`]
                  : voiceDrawing.at,
              )}
              fill="none"
              stroke="rgb(var(--c-accent))"
              strokeWidth={2}
              strokeDasharray="5 4"
            />
          )}
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
