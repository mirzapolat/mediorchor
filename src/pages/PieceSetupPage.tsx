import { useCallback, useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { PageSpinner } from '@/components/Spinner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SortableList } from '@/components/SortableList';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { api } from '@/lib/api';
import {
  deletePiece,
  deletePieceFile,
  loadPieceFiles,
  persistOrder,
  pieceFileUrl,
  uploadPieceFile,
} from '@/lib/pieceFiles';
import { NotationError, parseNotation } from '@/lib/musicxml';
import {
  detectLeadIn,
  formatTime,
  guessFileKind,
  guessVoice,
  timelineDuration,
  timelineLabels,
} from '@/lib/pieceTimeline';
import { useProjectContext } from '@/layouts/projectContext';
import { cn } from '@/lib/cn';
import type { Piece, PieceFile, PieceFileKind, PieceTimeline } from '@/types';

interface UploadItem {
  key: string;
  name: string;
  state: 'busy' | 'done' | 'error';
  note?: string;
}

const KIND_OPTIONS: Array<{ kind: Exclude<PieceFileKind, 'link'>; label: TranslationKey }> = [
  { kind: 'score', label: 'fileKindScore' },
  { kind: 'audio', label: 'fileKindAudio' },
  { kind: 'notation', label: 'fileKindNotation' },
  { kind: 'midi', label: 'fileKindMidi' },
  { kind: 'other', label: 'fileKindOther' },
];

const Section = ({
  title,
  hint,
  children,
  action,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) => (
  <Card className="space-y-4 p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="font-semibold">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-text-secondary">{hint}</p>}
      </div>
      {action}
    </div>
    {children}
  </Card>
);

// Drop target for many files at once (click opens the picker).
const MultiDropzone = ({ onFiles }: { onFiles: (files: File[]) => void }) => {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  return (
    <label
      onDragOver={(e: DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors duration-150 focus-within:border-black',
        dragging ? 'border-black bg-surface-muted' : 'border-border bg-surface-subtle hover:border-text-tertiary',
      )}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-hover text-text-secondary">
        <Upload size={18} />
      </span>
      <span className="text-sm font-medium">{dragging ? t('dropzoneRelease') : t('pieceDropTitle')}</span>
      <span className="max-w-sm text-xs text-text-secondary">{t('pieceDropHint')}</span>
      <input
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </label>
  );
};

// Loads each recording's length (metadata only) to compare with the bars.
const useTrackDurations = (tracks: PieceFile[]) => {
  const [durations, setDurations] = useState<Record<string, number>>({});
  const key = tracks.map((t) => t.file_path).join('|');
  useEffect(() => {
    const audios = tracks
      .filter((t) => t.file_path)
      .map((track) => {
        const audio = new Audio();
        audio.preload = 'metadata';
        audio.onloadedmetadata = () =>
          setDurations((d) => ({ ...d, [track.id]: audio.duration }));
        audio.src = pieceFileUrl(track.file_path as string);
        return audio;
      });
    return () => audios.forEach((a) => a.removeAttribute('src'));
    // Only when the set of recordings changes.
  }, [key]);
  return durations;
};

// Set-up for one piece (managers): details, all files in one drop, voice
// tracks, where the bar timing comes from and whether the recordings match.
export const PieceSetupPage = () => {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const { pieceId } = useParams();
  const navigate = useNavigate();

  const [piece, setPiece] = useState<Piece | null>(null);
  const [files, setFiles] = useState<PieceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [evenFirst, setEvenFirst] = useState('1');
  const [evenLast, setEvenLast] = useState('');
  const [timingBusy, setTimingBusy] = useState(false);
  const [timingError, setTimingError] = useState<string | null>(null);
  const [timingMode, setTimingMode] = useState<'notation' | 'even' | null>(null);
  const [toDelete, setToDelete] = useState<PieceFile | null>(null);
  const [deletePieceOpen, setDeletePieceOpen] = useState(false);

  const back = `/projects/${project.id}/pieces/${pieceId}`;

  const load = useCallback(async () => {
    const [pieceResult, pieceFiles] = await Promise.all([
      api.from('pieces').select('*').eq('id', pieceId).maybeSingle(),
      loadPieceFiles(pieceId ?? ''),
    ]);
    const loaded = (pieceResult.data as Piece | null) ?? null;
    setPiece(loaded);
    setFiles(pieceFiles);
    if (loaded?.timeline?.source === 'even') {
      setEvenFirst(String(loaded.timeline.first));
      setEvenLast(String(loaded.timeline.last));
    }
    setLoading(false);
  }, [pieceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tracks = files.filter((f) => f.kind === 'audio');
  const durations = useTrackDurations(tracks);

  if (loading) return <PageSpinner />;
  if (!piece) {
    navigate(`/projects/${project.id}/pieces`);
    return null;
  }

  const updatePiece = async (patch: Partial<Piece>) => {
    setPiece((p) => (p ? { ...p, ...patch } : p));
    await api.from('pieces').update(patch).eq('id', piece.id);
  };

  const updateFile = async (file: PieceFile, patch: Partial<PieceFile>) => {
    setFiles((fs) => fs.map((f) => (f.id === file.id ? { ...f, ...patch } : f)));
    await api.from('piece_files').update(patch).eq('id', file.id);
  };

  const setTimeline = async (timeline: PieceTimeline | null) => updatePiece({ timeline });

  const readNotation = async (blob: Blob): Promise<string | null> => {
    try {
      await setTimeline(await parseNotation(blob));
      setTimingError(null);
      return null;
    } catch (e) {
      const message = e instanceof NotationError && e.message === 'timewise' ? t('notationTimewise') : t('notationUnreadable');
      setTimingError(message);
      return message;
    }
  };

  const addFiles = async (picked: File[]) => {
    // Notation first: the recordings are then checked against its bars.
    const ordered = [...picked].sort(
      (a, b) => Number(guessFileKind(b) === 'notation') - Number(guessFileKind(a) === 'notation'),
    );
    const counts: Partial<Record<PieceFileKind, number>> = {};
    for (const f of files) counts[f.kind] = (counts[f.kind] ?? 0) + 1;

    for (const file of ordered) {
      const key = crypto.randomUUID();
      const setItem = (item: Partial<UploadItem>) =>
        setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...item } : u)));
      setUploads((list) => [...list, { key, name: file.name, state: 'busy' }]);

      const kind = guessFileKind(file);
      const [result, leadIn] = await Promise.all([
        uploadPieceFile(piece.id, file),
        kind === 'audio' ? detectLeadIn(file) : Promise.resolve(null),
      ]);
      if (!result.path) {
        setItem({ state: 'error', note: result.error ?? t('uploadError') });
        continue;
      }
      const position = counts[kind] ?? 0;
      counts[kind] = position + 1;
      const { error } = await api.from('piece_files').insert({
        piece_id: piece.id,
        kind,
        title: kind === 'audio' ? guessVoice(file.name) : file.name.replace(/\.[^.]+$/, ''),
        file_path: result.path,
        file_name: file.name,
        offset_s: leadIn ?? 0,
        position,
      });
      if (error) {
        setItem({ state: 'error', note: error.message });
        continue;
      }
      let note: string | undefined = t(KIND_OPTIONS.find((k) => k.kind === kind)!.label);
      if (kind === 'notation') {
        const problem = await readNotation(file);
        if (problem) {
          setItem({ state: 'error', note: problem });
          continue;
        }
        note = t('notationRead');
      }
      setItem({ state: 'done', note });
    }
    setFiles(await loadPieceFiles(piece.id));
  };

  const reorderKind = (kind: PieceFileKind) => (next: PieceFile[]) => {
    setFiles((fs) => [...fs.filter((f) => f.kind !== kind), ...next.map((f, i) => ({ ...f, position: i }))]);
    void persistOrder('piece_files', next);
  };

  const rereadNotation = async () => {
    const notation = files.find((f) => f.kind === 'notation' && f.file_path);
    if (!notation?.file_path) return;
    setTimingBusy(true);
    const response = await fetch(pieceFileUrl(notation.file_path));
    await readNotation(await response.blob());
    setTimingBusy(false);
  };

  const saveEven = async () => {
    const first = parseInt(evenFirst, 10);
    const last = parseInt(evenLast, 10);
    if (!(first >= 0 && last >= first)) {
      setTimingError(t('barRangeInvalid'));
      return;
    }
    setTimingError(null);
    await setTimeline({ source: 'even', first, last });
  };

  const addLink = async () => {
    const raw = linkUrl.trim();
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    let url: string | null = null;
    try {
      const parsed = new URL(withScheme);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') url = parsed.toString();
    } catch {
      url = null;
    }
    if (!url) {
      setLinkError(t('invalidUrl'));
      return;
    }
    setLinkError(null);
    await api.from('piece_files').insert({
      piece_id: piece.id,
      kind: 'link',
      title: linkTitle.trim() || url,
      url,
      position: files.filter((f) => f.kind === 'link').length,
    });
    setLinkTitle('');
    setLinkUrl('');
    setFiles(await loadPieceFiles(piece.id));
  };

  const removeFile = async () => {
    if (!toDelete) return;
    await deletePieceFile(toDelete);
    setToDelete(null);
    setFiles(await loadPieceFiles(piece.id));
  };

  const timeline = piece.timeline;
  const notationFile = files.find((f) => f.kind === 'notation' && f.file_path);
  const score = files.find((f) => f.kind === 'score' && f.file_path);
  const labels = timelineLabels(timeline);
  const placed = labels.filter((l) => piece.bar_anchors[l]).length;
  const expected = timelineDuration(timeline);
  const mode = timingMode ?? (timeline?.source ?? (notationFile ? 'notation' : 'even'));

  const fileRow = (f: PieceFile) => (
    <div className="space-y-2 p-3">
      <div className="flex items-center gap-2">
        <input
          defaultValue={f.title}
          aria-label={f.kind === 'audio' ? t('voiceName') : t('displayName')}
          placeholder={f.file_name ?? ''}
          onBlur={(e) => e.target.value !== f.title && void updateFile(f, { title: e.target.value.trim() })}
          className="h-9 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-base font-medium hover:border-border focus:border-black focus:outline-none sm:text-sm"
        />
        <button
          type="button"
          onClick={() => setToDelete(f)}
          aria-label={t('delete')}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
        >
          <Trash2 size={15} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2 text-xs text-text-secondary">
        <span className="min-w-0 max-w-full truncate">{f.kind === 'link' ? f.url : f.file_name}</span>
        {f.kind !== 'link' && (
          <select
            value={f.kind}
            aria-label={t('fileKind')}
            onChange={(e) => void updateFile(f, { kind: e.target.value as PieceFileKind })}
            className="h-7 rounded-md border border-border bg-surface px-1.5 text-xs text-text-secondary focus:border-black focus:outline-none"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {t(k.label)}
              </option>
            ))}
          </select>
        )}
        {f.kind === 'audio' && (
          <>
            <label className="inline-flex items-center gap-1.5">
              {t('leadIn')}
              <input
                type="number"
                step={0.01}
                min={0}
                defaultValue={f.offset_s}
                onBlur={(e) => {
                  const v = Math.max(0, parseFloat(e.target.value) || 0);
                  if (v !== f.offset_s) void updateFile(f, { offset_s: v });
                }}
                className="h-7 w-16 rounded-md border border-border bg-surface px-1.5 text-right text-xs tabular-nums focus:border-black focus:outline-none"
              />
              s
            </label>
            {durations[f.id] > 0 && <TrackCheck duration={durations[f.id]} expected={expected} offset={f.offset_s} />}
          </>
        )}
      </div>
    </div>
  );

  const groups: Array<{ kind: PieceFileKind; title: TranslationKey; hint?: TranslationKey }> = [
    { kind: 'audio', title: 'voicesTitle', hint: 'voicesHint' },
    { kind: 'score', title: 'fileKindScore', hint: 'scoresHint' },
    { kind: 'notation', title: 'fileKindNotation' },
    { kind: 'midi', title: 'fileKindMidi' },
    { kind: 'other', title: 'fileKindOther' },
    { kind: 'link', title: 'fileKindLink' },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10">
      <button
        onClick={() => navigate(back)}
        className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
      >
        <ArrowLeft size={16} />
        {piece.name}
      </button>
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">{t('setUpPiece')}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t('setUpHint')}</p>
      </div>

      <Section title={t('details')}>
        <Input
          id="piece-name"
          label={t('pieceName')}
          defaultValue={piece.name}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== piece.name) void updatePiece({ name: v });
          }}
        />
        <Input
          id="piece-composer"
          label={t('composer')}
          defaultValue={piece.composer}
          onBlur={(e) => e.target.value.trim() !== piece.composer && void updatePiece({ composer: e.target.value.trim() })}
        />
        <Input
          id="piece-description"
          label={
            <>
              {t('shortDescription')} <span className="font-normal text-text-tertiary">({t('optional')})</span>
            </>
          }
          placeholder={t('shortDescriptionPlaceholder')}
          defaultValue={piece.description}
          onBlur={(e) =>
            e.target.value.trim() !== piece.description && void updatePiece({ description: e.target.value.trim() })
          }
        />
      </Section>

      <Section title={t('addFiles')}>
        <MultiDropzone onFiles={(picked) => void addFiles(picked)} />
        {uploads.length > 0 && (
          <ul className="space-y-1.5">
            {uploads.map((u) => (
              <li key={u.key} className="flex items-center gap-2 text-sm">
                {u.state === 'busy' ? (
                  <Loader2 size={15} className="flex-shrink-0 animate-spin text-text-tertiary" />
                ) : u.state === 'done' ? (
                  <CheckCircle2 size={15} className="flex-shrink-0 text-success" />
                ) : (
                  <XCircle size={15} className="flex-shrink-0 text-danger" />
                )}
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                {u.note && (
                  <span className={cn('flex-shrink-0 text-xs', u.state === 'error' ? 'text-danger' : 'text-text-secondary')}>
                    {u.note}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('timingTitle')} hint={t('timingHint')}>
        <div className="flex rounded-md border border-border bg-surface-muted p-0.5">
          {(['notation', 'even'] as const).map((src) => {
            const active = mode === src;
            return (
              <button
                key={src}
                type="button"
                disabled={src === 'notation' && !notationFile}
                onClick={() => {
                  setTimingMode(src);
                  setTimingError(null);
                  if (src === 'notation' && timeline?.source !== 'notation') void rereadNotation();
                }}
                className={cn(
                  'h-9 flex-1 rounded text-sm font-medium transition-colors duration-150 disabled:opacity-40',
                  active ? 'bg-surface text-text shadow-sm' : 'text-text-secondary hover:text-text',
                )}
              >
                {src === 'notation' ? t('timingFromNotation') : t('timingEven')}
              </button>
            );
          })}
        </div>

        {mode === 'notation' ? (
          <div className="space-y-3">
            {timeline?.source === 'notation' && (
            <div className="flex flex-wrap gap-1.5">
              <Chip>
                {timeline.written} {t('bars')}
              </Chip>
              {timeline.bars.length !== timeline.written && (
                <Chip>
                  {timeline.bars.length} {t('barsPlayed')}
                </Chip>
              )}
              {timeline.repeats > 0 && (
                <Chip>
                  {timeline.repeats} {t('repeatsCount')}
                </Chip>
              )}
              {timeline.tempoChanges > 0 && (
                <Chip>
                  {timeline.tempoChanges} {t('tempoChanges')}
                </Chip>
              )}
              {timeline.meterChanges > 0 && (
                <Chip>
                  {timeline.meterChanges} {t('meterChanges')}
                </Chip>
              )}
              {expected != null && <Chip>{formatTime(expected)}</Chip>}
            </div>
            )}
            {notationFile && (
              <Button variant="secondary" onClick={() => void rereadNotation()} disabled={timingBusy}>
                <RefreshCw size={15} className={cn(timingBusy && 'animate-spin')} />
                {t('rereadNotation')}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {!notationFile && <p className="text-sm text-text-secondary">{t('notationTip')}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Input
                id="even-first"
                label={t('barsStartAt')}
                type="number"
                inputMode="numeric"
                min={0}
                value={evenFirst}
                onChange={(e) => setEvenFirst(e.target.value)}
              />
              <Input
                id="even-last"
                label={t('barsEndAt')}
                type="number"
                inputMode="numeric"
                min={0}
                value={evenLast}
                onChange={(e) => setEvenLast(e.target.value)}
              />
            </div>
            <Button onClick={() => void saveEven()} disabled={!evenLast}>
              {t('save')}
            </Button>
          </div>
        )}
        {timingError && <p className="text-sm text-danger">{timingError}</p>}
      </Section>

      {score && labels.length > 0 && (
        <Section
          title={t('markersTitle')}
          hint={t('markersHint')}
          action={
            <span className="flex-shrink-0 text-sm tabular-nums text-text-secondary">
              {placed}/{labels.length}
            </span>
          }
        >
          <Button variant="secondary" onClick={() => navigate(`${back}?place=1`)}>
            <MapPin size={15} />
            {placed > 0 ? t('editMarkers') : t('placeBars')}
          </Button>
        </Section>
      )}

      {groups.map(({ kind, title, hint }) => {
        const group = files.filter((f) => f.kind === kind);
        if (group.length === 0 && kind !== 'link') return null;
        return (
          <Section key={kind} title={t(title)} hint={hint ? t(hint) : undefined}>
            {group.length > 0 && (
              <SortableList items={group} getId={(f) => f.id} onReorder={reorderKind(kind)} renderItem={fileRow} />
            )}
            {kind === 'link' && (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
                  <input
                    value={linkTitle}
                    onChange={(e) => setLinkTitle(e.target.value)}
                    placeholder={t('displayName')}
                    aria-label={t('displayName')}
                    className="h-10 rounded-md border border-border bg-white px-3 text-base focus:border-black focus:outline-none sm:text-sm"
                  />
                  <input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://"
                    aria-label={t('linkUrl')}
                    inputMode="url"
                    className="h-10 rounded-md border border-border bg-white px-3 text-base focus:border-black focus:outline-none sm:text-sm"
                  />
                  <Button variant="secondary" onClick={() => void addLink()} disabled={!linkUrl.trim()} className="h-10">
                    <Plus size={15} />
                    {t('add')}
                  </Button>
                </div>
                {linkError && <p className="text-sm text-danger">{linkError}</p>}
              </div>
            )}
          </Section>
        );
      })}

      <div className="flex justify-between gap-3 pt-2">
        <Button variant="secondary" onClick={() => setDeletePieceOpen(true)}>
          <Trash2 size={15} />
          {t('deletePiece')}
        </Button>
        <Button onClick={() => navigate(back)}>{t('done')}</Button>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        title={t('delete')}
        message={t('confirmDelete')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={removeFile}
        onCancel={() => setToDelete(null)}
      />
      <ConfirmDialog
        open={deletePieceOpen}
        title={t('deletePiece')}
        message={t('confirmDeletePiece')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={async () => {
          await deletePiece(piece.id);
          navigate(`/projects/${project.id}/pieces`);
        }}
        onCancel={() => setDeletePieceOpen(false)}
      />
    </div>
  );
};

const Chip = ({ children }: { children: ReactNode }) => (
  <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-text-secondary">
    {children}
  </span>
);

// Does the recording fit the bars? MuseScore exports end with a short
// release tail, so a few seconds longer is fine.
const TrackCheck = ({
  duration,
  expected,
  offset,
}: {
  duration: number;
  expected: number | null;
  offset: number;
}) => {
  const { t } = useI18n();
  if (expected == null) return <span className="tabular-nums">{formatTime(duration)}</span>;
  const diff = duration - (expected + offset);
  const ok = diff > -1.5 && diff < 8;
  return (
    <span className={cn('inline-flex items-center gap-1 tabular-nums', ok ? 'text-success-strong' : 'text-danger')}>
      {ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
      {formatTime(duration)}
      {!ok && ` · ${t(diff > 0 ? 'trackLonger' : 'trackShorter').replace('{s}', String(Math.round(Math.abs(diff))))}`}
    </span>
  );
};
