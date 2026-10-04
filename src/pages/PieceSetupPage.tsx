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
  ListMinus,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { PageSpinner } from '@/components/Spinner';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SortableList } from '@/components/SortableList';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { api } from '@/lib/api';
import {
  deletePiece,
  deletePieceFile,
  loadPieceCredits,
  loadPieceFiles,
  loadPieceInScope,
  loadPieceTracks,
  persistOrder,
  pieceFileUrl,
  removePieceFromProject,
  uploadPieceFile,
} from '@/lib/pieceFiles';
import { NotationError, parseNotation } from '@/lib/musicxml';
import {
  detectLeadIn,
  firstBarNumber,
  formatTime,
  guessFileKind,
  guessVoice,
  isClickRecording,
  timelineDuration,
  timelineLabels,
} from '@/lib/pieceTimeline';
import { usePieceScope } from '@/layouts/pieceScope';
import { NoAccess } from '@/components/NoAccess';
import { useCanPlaceBars } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import type { Piece, PieceCredit, PieceFile, PieceFileKind, PieceTimeline, PieceTrack } from '@/types';

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

const selectClasses =
  'h-9 min-w-0 rounded-md border border-border bg-surface px-2 text-base focus:border-black focus:outline-none sm:text-sm';

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
const useRecordingDurations = (recordings: PieceFile[]) => {
  const [durations, setDurations] = useState<Record<string, number>>({});
  const key = recordings.map((f) => f.file_path).join('|');
  useEffect(() => {
    const audios = recordings
      .filter((f) => f.file_path)
      .map((file) => {
        const audio = new Audio();
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => setDurations((d) => ({ ...d, [file.id]: audio.duration }));
        audio.src = pieceFileUrl(file.file_path as string);
        return audio;
      });
    return () => audios.forEach((a) => a.removeAttribute('src'));
    // Only when the set of recordings changes.
  }, [key]);
  return durations;
};

// "3:25" (or plain seconds) → seconds; '' → null; undefined when unreadable.
const parseDuration = (value: string): number | null | undefined => {
  const v = value.trim();
  if (!v) return null;
  const m = /^(\d+):([0-5]?\d)$/.exec(v);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : undefined;
};

// Set-up for one piece (with the pieces permission), top to bottom: details,
// credits, one drop for all files (listed below it), the bar timing, the
// voices (picking their recordings from the uploaded files), and the score
// PDF, MusicXML and links.
export const PieceSetupPage = () => {
  const { t } = useI18n();
  const { base, projectId, canEdit, canManageProject, canDelete } = usePieceScope();
  const { pieceId } = useParams();
  const navigate = useNavigate();

  const [piece, setPiece] = useState<Piece | null>(null);
  const [files, setFiles] = useState<PieceFile[]>([]);
  const [tracks, setTracks] = useState<PieceTrack[]>([]);
  const [credits, setCredits] = useState<PieceCredit[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [barCount, setBarCount] = useState('');
  const [timingBusy, setTimingBusy] = useState(false);
  const [timingError, setTimingError] = useState<string | null>(null);
  const [timingMode, setTimingMode] = useState<'notation' | 'even' | null>(null);
  const [durationError, setDurationError] = useState(false);
  const [toDelete, setToDelete] = useState<PieceFile | null>(null);
  const [deletePieceOpen, setDeletePieceOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const back = `${base}/${pieceId}`;

  const reloadParts = useCallback(async () => {
    const [pieceFiles, pieceTracks, pieceCredits] = await Promise.all([
      loadPieceFiles(pieceId ?? ''),
      loadPieceTracks(pieceId ?? ''),
      loadPieceCredits(pieceId ?? ''),
    ]);
    setFiles(pieceFiles);
    setTracks(pieceTracks);
    setCredits(pieceCredits);
  }, [pieceId]);

  const load = useCallback(async () => {
    const loaded = await loadPieceInScope(pieceId ?? '', projectId);
    setPiece(loaded);
    if (loaded) {
      await reloadParts();
      if (loaded.timeline?.source === 'even') {
        setBarCount(String(loaded.timeline.last - loaded.timeline.first + 1));
      }
    }
    setLoading(false);
  }, [pieceId, projectId, reloadParts]);

  useEffect(() => {
    void load();
  }, [load]);

  const recordings = files.filter((f) => f.kind === 'audio' && f.file_path);
  const canPlaceBars = useCanPlaceBars();
  const durations = useRecordingDurations(recordings);

  if (!canEdit) return <NoAccess />;
  if (loading) return <PageSpinner />;
  if (!piece) return <NoAccess />;

  const updatePiece = async (patch: Partial<Piece>) => {
    setPiece((p) => (p ? { ...p, ...patch } : p));
    await api.from('pieces').update(patch).eq('id', piece.id);
  };

  const updateFile = async (file: PieceFile, patch: Partial<PieceFile>) => {
    setFiles((fs) => fs.map((f) => (f.id === file.id ? { ...f, ...patch } : f)));
    await api.from('piece_files').update(patch).eq('id', file.id);
  };

  const updateTrack = async (track: PieceTrack, patch: Partial<PieceTrack>) => {
    setTracks((ts) => ts.map((x) => (x.id === track.id ? { ...x, ...patch } : x)));
    await api.from('piece_tracks').update(patch).eq('id', track.id);
  };

  const updateCredit = async (credit: PieceCredit, patch: Partial<PieceCredit>) => {
    setCredits((cs) => cs.map((c) => (c.id === credit.id ? { ...c, ...patch } : c)));
    await api.from('piece_credits').update(patch).eq('id', credit.id);
    // A linked account brings its photo (set by the database).
    if ('user_id' in patch) setCredits(await loadPieceCredits(piece.id));
  };

  // Reads the bars from a MusicXML; the piece's length follows them.
  const readNotation = async (blob: Blob): Promise<string | null> => {
    try {
      const timeline: PieceTimeline = await parseNotation(blob);
      await updatePiece({ timeline, duration_s: timelineDuration(timeline) });
      setTimingError(null);
      return null;
    } catch (e) {
      const message =
        e instanceof NotationError && e.message === 'timewise' ? t('notationTimewise') : t('notationUnreadable');
      setTimingError(message);
      return message;
    }
  };

  const notationFiles = files.filter((f) => f.kind === 'notation' && f.file_path);
  const scoreFiles = files.filter((f) => (f.kind === 'score' || /\.pdf$/i.test(f.file_name ?? '')) && f.file_path);
  const notationFile = notationFiles.find((f) => f.id === piece.notation_file_id) ?? null;

  const addFiles = async (picked: File[]) => {
    // Notation first (its bars then check the recordings); recordings with
    // click last, so the voices they belong to exist.
    const rank = (f: File) =>
      guessFileKind(f) === 'notation' ? 0 : guessFileKind(f) === 'audio' && isClickRecording(f.name) ? 2 : 1;
    const ordered = [...picked].sort((a, b) => rank(a) - rank(b));
    const counts: Partial<Record<PieceFileKind, number>> = {};
    for (const f of files) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
    // Local copies, updated as files land (state updates come later).
    const voices = [...tracks];
    let scoreId = piece.score_file_id;
    let notationId = piece.notation_file_id;

    for (const file of ordered) {
      const key = crypto.randomUUID();
      const setItem = (item: Partial<UploadItem>) =>
        setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...item } : u)));
      setUploads((list) => [...list, { key, name: file.name, state: 'busy' }]);

      const kind = guessFileKind(file);
      const withClick = kind === 'audio' && isClickRecording(file.name);
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
      const voice = kind === 'audio' ? guessVoice(file.name) : '';
      const { data, error } = await api
        .from('piece_files')
        .insert({
          piece_id: piece.id,
          kind,
          title:
            kind === 'audio'
              ? withClick
                ? `${voice} (${t('withMetronome')})`
                : voice
              : file.name.replace(/\.[^.]+$/, ''),
          file_path: result.path,
          file_name: file.name,
          offset_s: leadIn ?? 0,
          position,
        })
        .select('id')
        .single();
      if (error || !data) {
        setItem({ state: 'error', note: error?.message ?? t('uploadError') });
        continue;
      }
      const fileId = (data as { id: string }).id;
      let note: string = t(KIND_OPTIONS.find((k) => k.kind === kind)!.label);

      if (kind === 'audio' && !withClick) {
        // A new voice with this recording (the voice from the file name).
        const { data: track } = await api
          .from('piece_tracks')
          .insert({ piece_id: piece.id, title: voice, file_id: fileId, offset_s: leadIn ?? 0, position: voices.length })
          .select('*')
          .single();
        if (track) voices.push(track as PieceTrack);
        note = `${t('voiceName')} · ${voice}`;
      } else if (withClick) {
        // Joins the voice of the same name, or the only one still without.
        const name = voice.toLowerCase();
        const open = voices.filter((v) => !v.click_file_id);
        const target =
          open.find((v) => v.title.trim().toLowerCase() === name) ?? (open.length === 1 ? open[0] : undefined);
        if (target) {
          target.click_file_id = fileId;
          await api.from('piece_tracks').update({ click_file_id: fileId }).eq('id', target.id);
          note = `${t('withMetronome')} · ${target.title}`;
        }
      } else if (kind === 'score' && !scoreId) {
        scoreId = fileId;
        await updatePiece({ score_file_id: fileId });
      } else if (kind === 'notation' && !notationId) {
        notationId = fileId;
        await updatePiece({ notation_file_id: fileId });
        const problem = await readNotation(file);
        if (problem) {
          setItem({ state: 'error', note: problem });
          continue;
        }
        note = t('notationRead');
      }
      setItem({ state: 'done', note });
    }
    await reloadParts();
  };

  const rereadNotation = async (file: PieceFile | null = notationFile) => {
    if (!file?.file_path) return;
    setTimingBusy(true);
    const response = await fetch(pieceFileUrl(file.file_path));
    await readNotation(await response.blob());
    setTimingBusy(false);
  };

  const saveEven = async () => {
    const count = parseInt(barCount, 10);
    if (!(count >= 1)) {
      setTimingError(t('barRangeInvalid'));
      return;
    }
    setTimingError(null);
    // Keeps the first bar's number; the numbering below shifts it.
    const first = piece.timeline?.source === 'even' ? piece.timeline.first : 1;
    await updatePiece({ timeline: { source: 'even', first, last: first + count - 1 } });
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

  // Voices and the piece lose a deleted file by themselves (database).
  const removeFile = async () => {
    if (!toDelete) return;
    await deletePieceFile(toDelete);
    setToDelete(null);
    const fresh = await loadPieceInScope(piece.id, projectId);
    if (fresh) setPiece(fresh);
    await reloadParts();
  };

  const addVoice = async () => {
    const { data } = await api
      .from('piece_tracks')
      .insert({ piece_id: piece.id, title: '', position: tracks.length })
      .select('*')
      .single();
    if (data) setTracks((ts) => [...ts, data as PieceTrack]);
  };

  const removeVoice = async (track: PieceTrack) => {
    setTracks((ts) => ts.filter((x) => x.id !== track.id));
    await api.from('piece_tracks').delete().eq('id', track.id);
  };

  const reorderVoices = (next: PieceTrack[]) => {
    setTracks(next.map((x, i) => ({ ...x, position: i })));
    void persistOrder('piece_tracks', next);
  };

  const addCredit = async () => {
    const { data } = await api
      .from('piece_credits')
      .insert({ piece_id: piece.id, name: '', position: credits.length })
      .select('*')
      .single();
    if (data) setCredits((cs) => [...cs, data as PieceCredit]);
  };

  const removeCredit = async (credit: PieceCredit) => {
    setCredits((cs) => cs.filter((c) => c.id !== credit.id));
    await api.from('piece_credits').delete().eq('id', credit.id);
  };

  const timeline = piece.timeline;
  const score = scoreFiles.find((f) => f.id === piece.score_file_id) ?? null;
  const labels = timelineLabels(timeline);
  const placed = labels.filter((l) => piece.bar_anchors[l]).length;
  // Shown bar numbers: the first numbered bar plus the piece's shift.
  const firstNumber = firstBarNumber(labels);
  const shownStart = firstNumber == null ? null : firstNumber + (piece.bar_shift ?? 0);
  const expected = timelineDuration(timeline);
  const mode = timingMode ?? timeline?.source ?? (notationFile ? 'notation' : 'even');
  const uploadedFiles = files.filter((f) => f.kind !== 'link');
  const links = files.filter((f) => f.kind === 'link');
  const fileLabel = (f: PieceFile) => f.title.trim() || f.file_name || '—';

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
        <div className="space-y-1.5">
          <Input
            // Re-mounted when the saved value changes (e.g. read from the MusicXML).
            key={piece.duration_s ?? 'none'}
            id="piece-duration"
            label={t('pieceLength')}
            placeholder="m:ss"
            inputMode="numeric"
            defaultValue={piece.duration_s != null ? formatTime(piece.duration_s) : ''}
            onBlur={(e) => {
              const v = parseDuration(e.target.value);
              if (v === undefined) {
                setDurationError(true);
                return;
              }
              setDurationError(false);
              if (v !== piece.duration_s) void updatePiece({ duration_s: v });
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="max-w-[10rem]"
          />
          <p className={cn('text-sm', durationError ? 'text-danger' : 'text-text-secondary')}>
            {durationError ? t('durationInvalid') : t('durationHint')}
          </p>
        </div>
      </Section>

      <Section title={t('credits')} hint={t('creditsHint')}>
        {credits.length > 0 && (
          <ul className="space-y-3">
            {credits.map((c) => (
              <li key={c.id}>
                <CreditRow
                  credit={c}
                  onChange={(patch) => void updateCredit(c, patch)}
                  onRemove={() => void removeCredit(c)}
                />
              </li>
            ))}
          </ul>
        )}
        <Button variant="secondary" onClick={() => void addCredit()}>
          <Plus size={15} />
          {t('addCredit')}
        </Button>
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
        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">
            {t('uploadedFiles')}
            {uploadedFiles.length > 0 && <span className="font-normal text-text-secondary"> · {uploadedFiles.length}</span>}
          </h3>
          {uploadedFiles.length === 0 ? (
            <p className="text-sm text-text-secondary">{t('noFiles')}</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {uploadedFiles.map((f) => (
                <li key={f.id} className="flex items-center gap-2 px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <input
                      defaultValue={f.title}
                      aria-label={t('displayName')}
                      placeholder={f.file_name ?? ''}
                      onBlur={(e) => e.target.value.trim() !== f.title && void updateFile(f, { title: e.target.value.trim() })}
                      className="h-8 w-full rounded-md border border-transparent bg-transparent px-1.5 text-base font-medium hover:border-border focus:border-black focus:outline-none sm:text-sm"
                    />
                    <p className="truncate px-1.5 text-xs text-text-tertiary">{f.file_name}</p>
                  </div>
                  <select
                    value={f.kind}
                    aria-label={t('fileKind')}
                    onChange={(e) => void updateFile(f, { kind: e.target.value as PieceFileKind })}
                    className="h-8 flex-shrink-0 rounded-md border border-border bg-surface px-1.5 text-xs text-text-secondary focus:border-black focus:outline-none"
                  >
                    {KIND_OPTIONS.map((k) => (
                      <option key={k.kind} value={k.kind}>
                        {t(k.label)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setToDelete(f)}
                    aria-label={t('delete')}
                    title={t('delete')}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
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
            <div className="flex items-end gap-3">
              <Input
                id="bar-count"
                label={t('barCount')}
                type="number"
                inputMode="numeric"
                min={1}
                value={barCount}
                onChange={(e) => setBarCount(e.target.value)}
                className="max-w-[10rem]"
              />
              <Button onClick={() => void saveEven()} disabled={!barCount} className="h-10">
                {t('save')}
              </Button>
            </div>
          </div>
        )}
        {timingError && <p className="text-sm text-danger">{timingError}</p>}

        {firstNumber != null && shownStart != null && (
          <div className="space-y-1.5 border-t border-border pt-3">
            <Input
              // Re-mounted when the saved value changes, so it shows that value.
              key={shownStart}
              id="bar-numbering-start"
              label={t('barNumberingStart')}
              type="number"
              inputMode="numeric"
              defaultValue={shownStart}
              onBlur={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isFinite(v) || v === shownStart) {
                  e.target.value = String(shownStart);
                  return;
                }
                void updatePiece({ bar_shift: v - firstNumber });
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              className="max-w-[10rem]"
            />
            <p className="text-sm text-text-secondary">{t('barNumberingHint')}</p>
          </div>
        )}
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
          <Button variant="secondary" onClick={() => navigate(`${back}?place=1`)} disabled={!canPlaceBars}>
            <MapPin size={15} />
            {placed > 0 ? t('editMarkers') : t('placeBars')}
          </Button>
          {!canPlaceBars && <p className="text-sm text-text-secondary">{t('placeBarsDesktopOnly')}</p>}
        </Section>
      )}

      <Section title={t('voicesTitle')} hint={t('voicesPickHint')}>
        {recordings.length === 0 && <p className="text-sm text-text-secondary">{t('voicesNoRecordings')}</p>}
        {tracks.length > 0 && (
          <SortableList
            items={tracks}
            getId={(x) => x.id}
            onReorder={reorderVoices}
            renderItem={(track) => {
              const without = recordings.find((f) => f.id === track.file_id);
              return (
                <div className="space-y-2 p-3">
                  <div className="flex items-center gap-2">
                    <input
                      defaultValue={track.title}
                      aria-label={t('voiceName')}
                      placeholder={t('voiceName')}
                      onBlur={(e) =>
                        e.target.value.trim() !== track.title && void updateTrack(track, { title: e.target.value.trim() })
                      }
                      className="h-9 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-base font-medium hover:border-border focus:border-black focus:outline-none sm:text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => void removeVoice(track)}
                      aria-label={t('removeVoice')}
                      title={t('removeVoice')}
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="grid gap-2 px-2 sm:grid-cols-2">
                    {(['file_id', 'click_file_id'] as const).map((field) => (
                      <label key={field} className="flex min-w-0 flex-col gap-1 text-xs font-medium text-text-secondary">
                        {field === 'file_id' ? t('withoutMetronome') : t('withMetronome')}
                        <select
                          value={track[field] ?? ''}
                          onChange={(e) => {
                            const id = e.target.value || null;
                            const patch: Partial<PieceTrack> = { [field]: id };
                            // A first recording brings its measured lead-in.
                            const picked = recordings.find((f) => f.id === id);
                            if (field === 'file_id' && picked && track.offset_s === 0 && picked.offset_s > 0) {
                              patch.offset_s = picked.offset_s;
                            }
                            void updateTrack(track, patch);
                          }}
                          className={selectClasses}
                        >
                          <option value="">{t('noRecording')}</option>
                          {recordings.map((f) => (
                            <option key={f.id} value={f.id}>
                              {fileLabel(f)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2 text-xs text-text-secondary">
                    <label className="inline-flex items-center gap-1.5">
                      {t('leadIn')}
                      <input
                        key={track.offset_s}
                        type="number"
                        step={0.01}
                        min={0}
                        defaultValue={track.offset_s}
                        onBlur={(e) => {
                          const v = Math.max(0, parseFloat(e.target.value) || 0);
                          if (v !== track.offset_s) void updateTrack(track, { offset_s: v });
                        }}
                        className="h-7 w-16 rounded-md border border-border bg-surface px-1.5 text-right text-xs tabular-nums focus:border-black focus:outline-none"
                      />
                      s
                    </label>
                    {without && durations[without.id] > 0 && (
                      <TrackCheck duration={durations[without.id]} expected={expected} offset={track.offset_s} />
                    )}
                  </div>
                </div>
              );
            }}
          />
        )}
        <Button variant="secondary" onClick={() => void addVoice()}>
          <Plus size={15} />
          {t('addVoice')}
        </Button>
      </Section>

      <Section title={t('miscTitle')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
            {t('scoreFileLabel')}
            <select
              value={piece.score_file_id ?? ''}
              onChange={(e) => void updatePiece({ score_file_id: e.target.value || null })}
              className={cn(selectClasses, 'h-10')}
            >
              <option value="">{t('noFileSelected')}</option>
              {scoreFiles.map((f) => (
                <option key={f.id} value={f.id}>
                  {fileLabel(f)}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-text-secondary">{t('scoreFileHint')}</span>
          </label>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
            {t('notationFileLabel')}
            <select
              value={piece.notation_file_id ?? ''}
              onChange={(e) => {
                const id = e.target.value || null;
                void updatePiece({ notation_file_id: id });
                // The bars follow the chosen file while they come from one.
                const picked = notationFiles.find((f) => f.id === id) ?? null;
                if (picked && mode === 'notation') void rereadNotation(picked);
              }}
              className={cn(selectClasses, 'h-10')}
            >
              <option value="">{t('noFileSelected')}</option>
              {notationFiles.map((f) => (
                <option key={f.id} value={f.id}>
                  {fileLabel(f)}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-text-secondary">{t('notationFileHint')}</span>
          </label>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">{t('fileKindLink')}</h3>
          {links.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border">
              {links.map((f) => (
                <li key={f.id} className="flex items-center gap-2 px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <input
                      defaultValue={f.title}
                      aria-label={t('displayName')}
                      onBlur={(e) => e.target.value.trim() !== f.title && void updateFile(f, { title: e.target.value.trim() })}
                      className="h-8 w-full rounded-md border border-transparent bg-transparent px-1.5 text-base font-medium hover:border-border focus:border-black focus:outline-none sm:text-sm"
                    />
                    <p className="truncate px-1.5 text-xs text-text-tertiary">{f.url}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setToDelete(f)}
                    aria-label={t('delete')}
                    title={t('delete')}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
            <input
              value={linkTitle}
              onChange={(e) => setLinkTitle(e.target.value)}
              placeholder={t('displayName')}
              aria-label={t('displayName')}
              className="h-10 rounded-md border border-border bg-surface px-3 text-base focus:border-black focus:outline-none sm:text-sm"
            />
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://"
              aria-label={t('linkUrl')}
              inputMode="url"
              className="h-10 rounded-md border border-border bg-surface px-3 text-base focus:border-black focus:outline-none sm:text-sm"
            />
            <Button variant="secondary" onClick={() => void addLink()} disabled={!linkUrl.trim()} className="h-10">
              <Plus size={15} />
              {t('add')}
            </Button>
          </div>
          {linkError && <p className="text-sm text-danger">{linkError}</p>}
        </div>
      </Section>

      <div className="flex flex-wrap justify-between gap-3 pt-2">
        <div className="flex flex-wrap gap-2">
          {projectId && canManageProject && (
            <Button variant="secondary" onClick={() => setRemoveOpen(true)}>
              <ListMinus size={15} />
              {t('removeFromProject')}
            </Button>
          )}
          {canDelete && (
            <Button variant="secondary" onClick={() => setDeletePieceOpen(true)}>
              <Trash2 size={15} />
              {t('deletePiece')}
            </Button>
          )}
        </div>
        <Button onClick={() => navigate(back)}>{t('done')}</Button>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        title={t('delete')}
        message={toDelete?.kind === 'audio' ? t('confirmDeleteRecording') : t('confirmDelete')}
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
          navigate(base);
        }}
        onCancel={() => setDeletePieceOpen(false)}
      />
      {projectId && (
        <ConfirmDialog
          open={removeOpen}
          title={t('removeFromProject')}
          message={t('confirmRemoveFromProject')}
          confirmLabel={t('removeFromProject')}
          onConfirm={async () => {
            await removePieceFromProject(projectId, piece.id);
            navigate(base);
          }}
          onCancel={() => setRemoveOpen(false)}
        />
      )}
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

interface AccountResult {
  id: string;
  name: string;
  email: string;
  photo_url: string | null;
}

// One credited person: any name, or an existing account picked from the
// search below the field (its profile photo is then shown), plus what they
// did ("made the MIDIs" when left empty).
const CreditRow = ({
  credit,
  onChange,
  onRemove,
}: {
  credit: PieceCredit;
  onChange: (patch: Partial<PieceCredit>) => void;
  onRemove: () => void;
}) => {
  const { t } = useI18n();
  const [value, setValue] = useState(credit.name);
  const [linked, setLinked] = useState(credit.user_id);
  const [results, setResults] = useState<AccountResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Suggest accounts while typing a name (not for the linked one as is).
  useEffect(() => {
    const query = value.trim();
    if (!searching || !query) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      const { data } = await api.rpc('search_accounts', { p_query: query });
      setResults((data as AccountResult[] | null) ?? []);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [value, searching]);

  const pick = (account: AccountResult) => {
    const accountName = account.name || account.email;
    setValue(accountName);
    setLinked(account.id);
    setSearching(false);
    onChange({ name: accountName, user_id: account.id });
  };

  // Typed by hand: a plain name, no longer tied to an account.
  const commit = () => {
    setSearching(false);
    const trimmed = value.trim();
    if (linked) return; // unchanged pick
    if (trimmed === credit.name && credit.user_id === null) return;
    onChange({ name: trimmed, user_id: null });
  };

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center gap-3">
        <Avatar name={value || '?'} photoUrl={linked ? credit.photo_url : null} size={36} />
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
          <input
            value={value}
            aria-label={t('midiCreditName')}
            placeholder={t('midiCreditPlaceholder')}
            onChange={(e) => {
              setValue(e.target.value);
              setLinked(null);
              setSearching(true);
            }}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="h-10 min-w-0 rounded-md border border-border bg-surface px-3 text-base focus:border-black focus:outline-none sm:text-sm"
          />
          <input
            defaultValue={credit.role}
            aria-label={t('creditRole')}
            placeholder={t('midiCreditRole')}
            onBlur={(e) => e.target.value.trim() !== credit.role && onChange({ role: e.target.value.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="h-10 min-w-0 rounded-md border border-border bg-surface px-3 text-base focus:border-black focus:outline-none sm:text-sm"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('remove')}
          title={t('remove')}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
        >
          <X size={15} />
        </button>
      </div>
      {results.length > 0 && (
        <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
          {results.map((account) => (
            <button
              key={account.id}
              type="button"
              // Keep the field focused so its blur doesn't save the typed text first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(account)}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-muted"
            >
              <Avatar name={account.name || account.email} photoUrl={account.photo_url} size={24} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{account.name || account.email}</span>
                <span className="block truncate text-xs text-text-secondary">{account.email}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {linked && <p className="text-xs text-text-secondary">{t('midiCreditLinked')}</p>}
    </div>
  );
};
