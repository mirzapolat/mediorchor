import { useCallback, useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  AudioWaveform,
  Check,
  Copy,
  Download,
  File as FileIcon,
  FileAudio,
  FileCode2,
  FileText,
  Loader2,
  MapPin,
  Plus,
  ListMinus,
  Trash2,
  Upload,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { PageSpinner } from '@/components/Spinner';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Switch } from '@/components/Switch';
import { FileWiring, parseVoiceTarget, type WireTarget } from '@/components/FileWiring';
import { BarSyncEditor, FermataIcon, type SyncVoice } from '@/components/BarSyncEditor';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import {
  deletePiece,
  deletePieceFile,
  loadPieceCredits,
  loadPieceFiles,
  loadPieceInScope,
  loadPieceTracks,
  persistOrder,
  pieceFileDownloadUrl,
  pieceFileUrl,
  removePieceFromProject,
  TRACK_RECORDING_FIELDS,
  uploadPieceFile,
} from '@/lib/pieceFiles';
import { NotationError, parseNotation } from '@/lib/musicxml';
import { TimingError, isMuseScoreFileName, isTimingFileName, mposBarFrames, readMpos } from '@/lib/mpos';
import { pdfPageSizes } from '@/lib/pdfPages';
import {
  formatTime,
  guessFileKind,
  syncedDuration,
  timelineLabels,
} from '@/lib/pieceTimeline';
import { usePieceScope } from '@/layouts/pieceScope';
import { NoAccess } from '@/components/NoAccess';
import { useCanPlaceBars } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import type { BarSyncPoint, Piece, PieceCredit, PieceFile, PieceTimeline, PieceTrack } from '@/types';

interface UploadItem {
  key: string;
  name: string;
  state: 'busy' | 'error';
  note?: string;
}


const Section = ({
  title,
  hint,
  children,
  action,
  className,
  plain = false,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  // Without the card: its parts bring their own (the files and nodes).
  plain?: boolean;
}) => {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-text-secondary">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </>
  );
  return plain ? (
    <div className={cn('space-y-4', className)}>{body}</div>
  ) : (
    <Card className={cn('space-y-4 p-4 sm:p-5', className)}>{body}</Card>
  );
};

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

// What a file is, at a glance: score PDF, recording, notation (MusicXML,
// MuseScore, its bar timing, MIDI) or anything else.
const fileIcon = (f: PieceFile): LucideIcon => {
  const name = f.file_name ?? '';
  if (/\.pdf$/i.test(name) || f.kind === 'score') return FileText;
  if (f.kind === 'audio') return FileAudio;
  if (f.kind === 'notation' || f.kind === 'midi' || isMuseScoreFileName(name)) return FileCode2;
  return FileIcon;
};

// A file's one name, editable without its ending (".pdf" stays). Renaming
// changes both the shown name and the stored file name (used for downloads).
// `beforeEnding` sits between the name and its ending (the download switch).
const FileName = ({
  file,
  onRename,
  beforeEnding,
}: {
  file: PieceFile;
  onRename: (patch: Partial<PieceFile>) => void;
  beforeEnding?: ReactNode;
}) => {
  const { t } = useI18n();
  const stored = file.file_name ?? '';
  const ext = /\.[a-z0-9]{1,8}$/i.exec(stored)?.[0] ?? '';
  const name = file.title.trim() || stored.slice(0, stored.length - ext.length);
  const Icon = fileIcon(file);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-1">
      <Icon size={18} className="flex-shrink-0 text-text-secondary" aria-hidden />
      <input
          key={name}
          defaultValue={name}
          aria-label={t('displayName')}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (!v) {
              e.target.value = name;
              return;
            }
            if (v !== name || v + ext !== stored) onRename({ title: v, file_name: v + ext });
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="h-9 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-base font-medium hover:border-border focus:border-black focus:outline-none sm:text-sm"
        />
      {beforeEnding}
      {ext && <span className="w-12 flex-shrink-0 text-sm text-text-tertiary">{ext}</span>}
    </div>
  );
};

// A recording's length in seconds (metadata only), null when unreadable.
const recordingLength = (file: PieceFile): Promise<number | null> =>
  new Promise((resolve) => {
    if (!file.file_path) return resolve(null);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => resolve(null);
    audio.src = pieceFileUrl(file.file_path);
  });

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
  // The bars' source as connected, until applied (undefined: as applied).
  const [barsPick, setBarsPick] = useState<string | null | undefined>(undefined);
  const [durationError, setDurationError] = useState(false);
  const [toDelete, setToDelete] = useState<PieceFile | null>(null);
  const [deletePieceOpen, setDeletePieceOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placeNote, setPlaceNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmPlace, setConfirmPlace] = useState(false);
  // A change that resets the fitting, waiting for confirmation.
  const [pendingReset, setPendingReset] = useState<(() => Promise<void>) | null>(null);

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

  // New bars for the piece; its length follows them. `reset` drops the
  // fitting to the recordings (see reread); otherwise sync points whose bars
  // no longer match are left out by themselves, and ones set on bars from
  // another source mean other bars.
  const applyTimeline = async (read: PieceTimeline, reset: boolean, fileId: string | null) => {
    const timeline = { ...read, file_id: fileId };
    const bar_sync = !reset && piece.timeline?.source === timeline.source ? piece.bar_sync : [];
    await updatePiece({ timeline, bar_sync, duration_s: syncedDuration(timeline, bar_sync) });
  };

  // Reads the bars from a MusicXML.
  const readNotation = async (blob: Blob, reset: boolean, fileId: string | null): Promise<string | null> => {
    try {
      await applyTimeline(await parseNotation(blob), reset, fileId);
      setTimingError(null);
      return null;
    } catch (e) {
      const message =
        e instanceof NotationError && e.message === 'timewise' ? t('notationTimewise') : t('notationUnreadable');
      setTimingError(message);
      return message;
    }
  };

  // Reads the bars from MuseScore's timing export (all it needs).
  const readTiming = async (blob: Blob, reset: boolean, fileId: string | null): Promise<string | null> => {
    try {
      await applyTimeline(await readMpos(blob), reset, fileId);
      setTimingError(null);
      return null;
    } catch {
      setTimingError(t('timingUnreadable'));
      return t('timingUnreadable');
    }
  };

  const fetchFile = async (file: PieceFile): Promise<Blob> =>
    (await fetch(pieceFileUrl(file.file_path as string))).blob();

  // MusicXML files and MuseScore timing exports (both kept as notation files).
  const notationFiles = files.filter(
    (f) => f.kind === 'notation' && f.file_path && !isTimingFileName(f.file_name ?? ''),
  );
  const timingFiles = files.filter((f) => f.kind === 'notation' && f.file_path && isTimingFileName(f.file_name ?? ''));
  const scoreFiles = files.filter((f) => (f.kind === 'score' || /\.pdf$/i.test(f.file_name ?? '')) && f.file_path);
  const notationFile = notationFiles.find((f) => f.id === piece.notation_file_id) ?? null;
  const timingFile = timingFiles.find((f) => f.id === piece.timing_file_id) ?? null;

  // Uploads files; nothing is connected or read by itself — files are wired
  // to the score, the voices and the bars by hand.
  const addFiles = async (picked: File[]) => {
    let nextPosition = files.length;

    for (const file of picked) {
      // Only uploads in progress or failed are listed; a finished one joins
      // the uploaded files.
      const key = crypto.randomUUID();
      const fail = (note: string) =>
        setUploads((list) => list.map((u) => (u.key === key ? { ...u, state: 'error', note } : u)));
      setUploads((list) => [...list, { key, name: file.name, state: 'busy' }]);

      const kind = guessFileKind(file);
      const result = await uploadPieceFile(piece.id, file);
      if (!result.path) {
        fail(result.error ?? t('uploadError'));
        continue;
      }
      const position = nextPosition++;
      const { data, error } = await api
        .from('piece_files')
        .insert({
          piece_id: piece.id,
          kind,
          title: file.name.replace(/\.[^.]+$/, ''),
          file_path: result.path,
          file_name: file.name,
          position,
        })
        .select('*')
        .single();
      if (error || !data) {
        fail(error?.message ?? t('uploadError'));
        continue;
      }
      const row = data as PieceFile;
      setFiles((list) => [...list, row]);
      setUploads((list) => list.filter((u) => u.key !== key));
    }
  };

  // Takes the bars from the MusicXML or MuseScore's timing again, as
  // uploaded: the fitted bars go; the voices' lead-ins stay as set in the
  // bar editor. `picks` names other files to read than the piece's.
  const reread = async (
    source: 'notation' | 'mscore',
    picks: { notation?: PieceFile | null; timing?: PieceFile | null } = {},
  ) => {
    const notation = picks.notation !== undefined ? picks.notation : notationFile;
    const timing = picks.timing !== undefined ? picks.timing : timingFile;
    const file = source === 'notation' ? notation : timing;
    if (!file?.file_path) return;
    setTimingBusy(true);
    if (source === 'notation') await readNotation(await fetchFile(file), true, file.id);
    else await readTiming(await fetchFile(file), true, file.id);
    setTimingBusy(false);
  };

  // New evenly spaced bars; like reading a file again, the fitting is reset.
  const saveEven = async (count: number, fileId: string | null) => {
    // Keeps the first bar's number; the editor's numbering shifts it.
    const first = piece.timeline?.source === 'even' ? piece.timeline.first : 1;
    await updatePiece({
      timeline: { source: 'even', first, last: first + count - 1, file_id: fileId },
      bar_sync: [],
    });
  };

  // Places every bar on the score PDF where MuseScore's timing export says
  // it sits — right only when the PDF comes from the same MuseScore file.
  const placeFromMuseScore = async () => {
    const pdf = scoreFiles.find((f) => f.id === piece.score_file_id);
    if (!timingFile || !pdf?.file_path) return;
    setPlacing(true);
    setPlaceNote(null);
    try {
      const [text, pages] = await Promise.all([
        fetchFile(timingFile).then((b) => b.text()),
        pdfPageSizes(pieceFileUrl(pdf.file_path)),
      ]);
      const anchors = mposBarFrames(text, pages);
      const { error } = await api.from('pieces').update({ bar_anchors: anchors }).eq('id', piece.id);
      if (error) throw new Error(error.message);
      setPiece((p) => (p ? { ...p, bar_anchors: anchors } : p));
      setPlaceNote({ ok: true, text: t('placedFromMuseScore').replace('{n}', String(Object.keys(anchors).length)) });
    } catch (e) {
      const mismatch = e instanceof TimingError && (e.message === 'fit' || e.message === 'pages');
      setPlaceNote({ ok: false, text: mismatch ? t('placeMismatch') : e instanceof Error && !(e instanceof TimingError) ? e.message : t('timingUnreadable') });
    }
    setPlacing(false);
  };

  // Runs a change that resets the fitting, asking first when there is one.
  const withReset = (action: () => Promise<void>) => {
    if (isFitted) setPendingReset(() => action);
    else void action();
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
    const rest = tracks.filter((x) => x.id !== track.id);
    setTracks(rest);
    arrangeAudio(rest);
    await api.from('piece_tracks').delete().eq('id', track.id);
  };

  const reorderVoices = (next: PieceTrack[]) => {
    setTracks(next.map((x, i) => ({ ...x, position: i })));
    void persistOrder('piece_tracks', next);
    arrangeAudio(next);
  };

  // The uploaded files in a new order (links keep theirs).
  const reorderFiles = (next: PieceFile[]) => {
    setFiles((fs) => [...next.map((f, i) => ({ ...f, position: i })), ...fs.filter((f) => f.kind === 'link')]);
    void persistOrder('piece_files', next);
  };

  // Keeps the recordings together, where the first one is: those the voices
  // use in the voices' order (each voice's four in a row), then the rest.
  const arrangeAudio = (voices: PieceTrack[]) => {
    const list = files.filter((f) => f.kind !== 'link');
    const audio = list.filter((f) => f.kind === 'audio');
    if (audio.length === 0) return;
    const used: PieceFile[] = [];
    for (const voice of voices) {
      for (const field of TRACK_RECORDING_FIELDS) {
        const file = audio.find((f) => f.id === voice[field]);
        if (file && !used.includes(file)) used.push(file);
      }
    }
    const block = [...used, ...audio.filter((f) => !used.includes(f))];
    const others = list.filter((f) => f.kind !== 'audio');
    const at = list.findIndex((f) => f.kind === 'audio');
    const next = [...others.slice(0, at), ...block, ...others.slice(at)];
    if (next.some((f, i) => f.id !== list[i].id)) reorderFiles(next);
  };

  // A wire from a file to an input (null: the input is disconnected).
  const connect = (target: WireTarget, fileId: string | null) => {
    const voice = parseVoiceTarget(target);
    if (voice) {
      const track = tracks.find((x) => x.id === voice.trackId);
      if (!track) return;
      void updateTrack(track, { [voice.field]: fileId });
      arrangeAudio(tracks.map((x) => (x.id === track.id ? { ...x, [voice.field]: fileId } : x)));
      return;
    }
    if (target === 'score') void updatePiece({ score_file_id: fileId });
    // The bars only change when applied.
    else {
      setBarsPick(fileId === appliedBarsFileId ? undefined : fileId);
      setTimingError(null);
    }
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
  const expected = syncedDuration(timeline, piece.bar_sync);
  // Voices to fit the bars with: each with the first of its recordings.
  const syncVoices: SyncVoice[] = tracks.flatMap((track) => {
    const file = TRACK_RECORDING_FIELDS.map((field) => recordings.find((f) => f.id === track[field])).find(Boolean);
    return file?.file_path
      ? [{ id: track.id, title: track.title, path: file.file_path, offset: track.offset_s }]
      : [];
  });
  const syncCount = (piece.bar_sync ?? []).length;
  // Something "Read again" would undo.
  const isFitted = syncCount > 0;
  const fermataCount = timeline?.source === 'notation' ? (timeline.fermatas ?? 0) : 0;

  // Saves the fitted bars and changed lead-ins; the piece's length follows
  // the bars unless it was set by hand.
  const saveSync = async (sync: BarSyncPoint[], offsets: Record<string, number>, barShift: number) => {
    const before = syncedDuration(timeline, piece.bar_sync);
    const after = syncedDuration(timeline, sync);
    const patch: Partial<Piece> = { bar_sync: sync, bar_shift: barShift };
    if (after != null && (piece.duration_s == null || before == null || Math.abs(piece.duration_s - before) < 0.5)) {
      patch.duration_s = Math.round(after * 1000) / 1000;
    }
    await Promise.all([
      updatePiece(patch),
      ...Object.entries(offsets).map(([id, offset_s]) => {
        const track = tracks.find((x) => x.id === id);
        return track ? updateTrack(track, { offset_s }) : Promise.resolve();
      }),
    ]);
    setSyncOpen(false);
  };
  // The file the bars were read from, and the one connected now (applied
  // with the bars node's button). Its kind says how the bars are read.
  const barsFileOf = (tl: PieceTimeline | null) =>
    tl?.file_id ?? (tl?.source === 'mscore' ? piece.timing_file_id : tl?.source === 'notation' ? piece.notation_file_id : null);
  const appliedBarsFileId = barsFileOf(timeline);
  const barsFileId = barsPick !== undefined ? barsPick : appliedBarsFileId;
  const barsFile = files.find((f) => f.id === barsFileId && f.file_path) ?? null;
  const barsPending = barsPick !== undefined;
  const mode: PieceTimeline['source'] = barsFile
    ? isTimingFileName(barsFile.file_name ?? '')
      ? 'mscore'
      : barsFile.kind === 'audio'
        ? 'even'
        : 'notation'
    : (timeline?.source ?? 'mscore');

  // Reads the bars from the connected file (a new count for even bars).
  const applyBars = () => {
    if (!barsFile) return;
    if (mode === 'even') {
      const count = parseInt(barCount, 10);
      if (!(count >= 1)) return setTimingError(t('barRangeInvalid'));
      setTimingError(null);
      return withReset(async () => {
        await saveEven(count, barsFile.id);
        // The piece is as long as the recording the bars are spread over.
        const seconds = await recordingLength(barsFile);
        if (seconds != null) await updatePiece({ duration_s: Math.round(seconds * 1000) / 1000 });
        setBarsPick(undefined);
      });
    }
    withReset(async () => {
      if (mode === 'mscore') {
        if (piece.timing_file_id !== barsFile.id) await updatePiece({ timing_file_id: barsFile.id });
        await reread('mscore', { timing: barsFile });
      } else {
        if (piece.notation_file_id !== barsFile.id) await updatePiece({ notation_file_id: barsFile.id });
        await reread('notation', { notation: barsFile });
      }
      setBarsPick(undefined);
    });
  };
  const uploadedFiles = files.filter((f) => f.kind !== 'link');
  const links = files.filter((f) => f.kind === 'link');
  const fileLabel = (f: PieceFile) => f.title.trim() || f.file_name || '—';
  return (
    // A page of its own (no sidebar): wide screens get the room for the wires.
    <div className="mx-auto max-w-2xl space-y-4 pb-10 lg:max-w-[1600px]">
      <button
        onClick={() => navigate(back)}
        className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
      >
        <ArrowLeft size={16} />
        {piece.name}
      </button>
      {/* Title, and on the right what leaves the page: removing, deleting, done. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold sm:text-2xl">{t('setUpPiece')}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t('setUpHint')}</p>
        </div>
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
          <Button onClick={() => navigate(back)}>
            <Check size={15} />
            {t('done')}
          </Button>
        </div>
      </div>

      {/* The piece and who worked on it; below, files wired to the score,
          the bars and the voices. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('details')} className="lg:col-span-2">
          <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
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
                  onBlur={(e) =>
                    e.target.value.trim() !== piece.composer && void updatePiece({ composer: e.target.value.trim() })
                  }
                />
              </div>
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
            </div>
            <div className="min-w-0 space-y-2">
              <div className="text-sm font-medium" title={t('creditsHint')}>
                {t('credits')}
              </div>
              {credits.length > 0 && (
                <ul className="space-y-2">
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
              <button
                type="button"
                onClick={() => void addCredit()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-text-secondary hover:bg-surface-hover hover:text-text"
              >
                <Plus size={15} />
                {t('addCredit')}
              </button>
            </div>
          </div>
        </Section>

        <Section title={t('filesAndVoicesTitle')} hint={t('filesAndVoicesHint')} className="py-2 lg:col-span-2" plain>
          <FileWiring
            files={uploadedFiles}
            tracks={tracks}
            picks={{
              score: piece.score_file_id,
              bars: barsFileId,
            }}
            fileLabel={fileLabel}
            onReorderFiles={reorderFiles}
            onReorderTracks={reorderVoices}
            onConnect={connect}
            filesTop={
              <>
                <MultiDropzone onFiles={(picked) => void addFiles(picked)} />
                {uploads.length > 0 && (
                  <ul className="space-y-1.5">
                    {uploads.map((u) => (
                      <li key={u.key} className="flex items-center gap-2 text-sm">
                        {u.state === 'busy' ? (
                          <Loader2 size={15} className="flex-shrink-0 animate-spin text-text-tertiary" />
                        ) : (
                          <XCircle size={15} className="flex-shrink-0 text-danger" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{u.name}</span>
                        {u.note && <span className="flex-shrink-0 text-xs text-danger">{u.note}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            }
            renderFile={(f) => {
              // A recording a voice uses, and the score PDF, are switched on
              // their node (right).
              const managed =
                f.id === piece.score_file_id ||
                tracks.some((track) => TRACK_RECORDING_FIELDS.some((field) => track[field] === f.id));
              return (
                <div className="flex items-center gap-1.5 py-2.5">
                  <FileName
                    file={f}
                    onRename={(patch) => void updateFile(f, patch)}
                    beforeEnding={
                      managed ? (
                        // Keeps the endings in line with the rows that have a switch.
                        <span className="w-[3.25rem] flex-shrink-0" />
                      ) : (
                        <Switch
                          checked={f.downloadable}
                          onChange={(downloadable) => void updateFile(f, { downloadable })}
                          label={t('downloadSwitch')}
                          title={t('downloadSwitchHint')}
                          icon={Download}
                        />
                      )
                    }
                  />
                  {f.file_path && (
                    <a
                      href={pieceFileDownloadUrl(f.file_path, f.file_name ?? fileLabel(f))}
                      aria-label={t('downloadFile')}
                      title={t('downloadFile')}
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
                    >
                      <Download size={15} />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setToDelete(f)}
                    aria-label={t('delete')}
                    title={t('delete')}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            }}
            renderVoiceHeader={(track) => (
              <div className="flex items-center gap-1.5">
                <input
                  defaultValue={track.title}
                  aria-label={t('voiceName')}
                  placeholder={t('voiceName')}
                  onBlur={(e) => e.target.value.trim() !== track.title && void updateTrack(track, { title: e.target.value.trim() })}
                  className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-base font-semibold hover:border-border focus:border-black focus:outline-none sm:text-sm"
                />
                <Switch
                  checked={track.downloadable}
                  onChange={(downloadable) => void updateTrack(track, { downloadable })}
                  label={t('downloadSwitch')}
                  title={t('downloadVoiceHint')}
                  icon={Download}
                />
                <button
                  type="button"
                  onClick={() => void removeVoice(track)}
                  aria-label={t('removeVoice')}
                  title={t('removeVoice')}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
                >
                  <X size={15} />
                </button>
              </div>
            )}
            scoreHeader={
              score && (
                <Switch
                  checked={score.downloadable}
                  onChange={(downloadable) => void updateFile(score, { downloadable })}
                  label={t('downloadSwitch')}
                  title={t('downloadSwitchHint')}
                  icon={Download}
                />
              )
            }
            voicesBottom={
              <Button variant="secondary" onClick={() => void addVoice()}>
                <Plus size={15} />
                {t('addVoice')}
              </Button>
            }
            barsBody={
              <>
                <p className="text-sm">
                  {barsFile ? (
                    <>
                      <span className="text-text-secondary">{t('barsReadAs')} </span>
                      <span className="font-medium">
                        {t(mode === 'mscore' ? 'timingFromMuseScore' : mode === 'notation' ? 'timingFromNotation' : 'timingEven')}
                      </span>
                    </>
                  ) : (
                    <span className="text-text-secondary">{t('barsConnectHint')}</span>
                  )}
                </p>
                <p className="text-xs text-text-secondary">{t('timingRecommended')}</p>
                {timingFiles.length === 0 && <MuseScoreTip name={piece.name} />}
                {/* The piece's length: follows the applied source (its bars, or
                    the recording even bars are spread over), editable. */}
                <label className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-medium">{t('pieceLength')}</span>
                  <input
                    // Re-mounted when the saved value changes (e.g. when applied).
                    key={piece.duration_s ?? 'none'}
                    placeholder="m:ss"
                    inputMode="numeric"
                    defaultValue={piece.duration_s != null ? formatTime(piece.duration_s) : ''}
                    onBlur={(e) => {
                      const v = parseDuration(e.target.value);
                      if (v === undefined) return setDurationError(true);
                      setDurationError(false);
                      if (v !== piece.duration_s) void updatePiece({ duration_s: v });
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    className="h-8 w-20 rounded-md border border-border bg-surface px-2 text-right text-base tabular-nums focus:border-black focus:outline-none sm:text-sm"
                  />
                  <span className={cn('text-xs', durationError ? 'text-danger' : 'text-text-secondary')}>
                    {durationError ? t('durationInvalid') : t('durationHint')}
                  </span>
                </label>
                {!barsPending && timeline && timeline.source !== 'even' && (
                  <div className="space-y-2">
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
                      {timeline.source === 'notation' && timeline.tempoChanges > 0 && (
                        <Chip>
                          {timeline.tempoChanges} {t('tempoChanges')}
                        </Chip>
                      )}
                      {timeline.source === 'notation' && timeline.meterChanges > 0 && (
                        <Chip>
                          {timeline.meterChanges} {t('meterChanges')}
                        </Chip>
                      )}
                      {fermataCount > 0 && (
                        <Chip>
                          <FermataIcon size={12} className="-mt-0.5 mr-1 inline" />
                          {fermataCount} {t(fermataCount === 1 ? 'fermata' : 'fermatasLower')}
                        </Chip>
                      )}
                      {expected != null && <Chip>{formatTime(expected)}</Chip>}
                    </div>
                    {timeline.source === 'mscore' && (
                      <p className="text-sm text-text-secondary">
                        {timeline.labels === 'notation' ? t('timingLabelsFromNotation') : t('timingLabelsCounted')}
                      </p>
                    )}
                  </div>
                )}
                {barsFile && mode === 'even' && (
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
                )}
                {barsPending && barsFile && <p className="text-sm font-medium text-text">{t('barsNotApplied')}</p>}
                {/* Applying the source, fitting the bars to the recordings and
                    placing them in the score PDF. */}
                <div className="flex flex-wrap gap-2">
                  {barsFile && (
                    <Button
                      onClick={applyBars}
                      disabled={timingBusy || (mode === 'even' && !barCount)}
                      title={t('rereadNotationHint')}
                    >
                      {timingBusy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                      {t('applyBars')}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => setSyncOpen(true)}
                    disabled={!timeline || syncVoices.length === 0}
                    title={timeline && syncVoices.length === 0 ? t('syncNeedsRecording') : undefined}
                  >
                    <AudioWaveform size={15} />
                    {t('syncOpen')}
                  </Button>
                  {score && labels.length > 0 && (
                    <Button
                      variant="secondary"
                      onClick={() => navigate(`${back}?place=1`)}
                      disabled={!canPlaceBars}
                      title={!canPlaceBars ? t('placeBarsDesktopOnly') : undefined}
                    >
                      <MapPin size={15} />
                      {t('placeBarsInPdf')}
                    </Button>
                  )}
                  {!barsPending && timeline?.source === 'mscore' && score && (
                      <Button
                        variant="secondary"
                        onClick={() => (placed > 0 ? setConfirmPlace(true) : void placeFromMuseScore())}
                        disabled={placing}
                        title={t('placeFromMuseScoreHint')}
                      >
                        {placing ? <Loader2 size={15} className="animate-spin" /> : <MapPin size={15} />}
                        {t('placeFromMuseScore')}
                      </Button>
                    )}
                </div>
                {placeNote && (
                  <p className={cn('text-sm', placeNote.ok ? 'text-success-strong' : 'text-danger')}>{placeNote.text}</p>
                )}
                {timingError && <p className="text-sm text-danger">{timingError}</p>}
                {fermataCount > 0 && syncCount === 0 && (
                  <p className="flex gap-2 rounded-md bg-info-soft px-3 py-2 text-sm text-text">
                    <FermataIcon size={16} className="mt-1 flex-shrink-0" />
                    <span>
                      {fermataCount === 1
                        ? t('syncFermataWarningOne')
                        : t('syncFermataWarning').replace('{n}', String(fermataCount))}
                    </span>
                  </p>
                )}
              </>
            }
            filesBottom={
              <div className="space-y-2 pt-3">
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
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                  <input
                    value={linkTitle}
                    onChange={(e) => setLinkTitle(e.target.value)}
                    placeholder={t('displayName')}
                    aria-label={t('displayName')}
                    className="h-10 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-base focus:border-black focus:outline-none sm:text-sm"
                  />
                  <input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://"
                    aria-label={t('linkUrl')}
                    inputMode="url"
                    className="h-10 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-base focus:border-black focus:outline-none sm:text-sm"
                  />
                  <Button variant="secondary" onClick={() => void addLink()} disabled={!linkUrl.trim()} className="h-10">
                    <Plus size={15} />
                    {t('add')}
                  </Button>
                </div>
                {linkError && <p className="text-sm text-danger">{linkError}</p>}
              </div>
            }
          />
        </Section>

      </div>

      {syncOpen && timeline && syncVoices.length > 0 && (
        <BarSyncEditor
          piece={piece}
          voices={syncVoices}
          onClose={() => setSyncOpen(false)}
          onSave={saveSync}
        />
      )}
      <ConfirmDialog
        open={confirmPlace}
        title={t('placeFromMuseScore')}
        message={t('placeFromMuseScoreConfirm').replace('{n}', String(placed))}
        confirmLabel={t('placeFromMuseScoreConfirmButton')}
        destructive
        onConfirm={() => {
          setConfirmPlace(false);
          void placeFromMuseScore();
        }}
        onCancel={() => setConfirmPlace(false)}
      />
      <ConfirmDialog
        open={pendingReset != null}
        title={t('resetFittingTitle')}
        message={t('rereadResetMessage')}
        confirmLabel={t('resetFittingConfirm')}
        destructive
        onConfirm={() => {
          const action = pendingReset;
          setPendingReset(null);
          void action?.();
        }}
        onCancel={() => setPendingReset(null)}
      />
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

// How to export MuseScore's bar timing, with commands to copy (the score's
// file name taken from the piece's name).
const MuseScoreTip = ({ name }: { name: string }) => {
  const { t } = useI18n();
  const base = name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Stück';
  const commands = [
    { os: 'macOS', line: `/Applications/MuseScore\\ 4.app/Contents/MacOS/mscore -o "${base}.mpos" "${base}.mscz"` },
    { os: 'Windows (PowerShell)', line: `& "C:\\Program Files\\MuseScore 4\\bin\\MuseScore4.exe" -o "${base}.mpos" "${base}.mscz"` },
  ];
  return (
    <div className="space-y-2.5 rounded-md border border-border bg-surface-subtle p-3 text-sm">
      <p>{t('timingTip')}</p>
      {commands.map((c) => (
        <CommandLine key={c.os} label={c.os} line={c.line} />
      ))}
      <p className="text-text-secondary">{t('timingTipAfter')}</p>
    </div>
  );
};

const CommandLine = ({ label, line }: { label: string; line: string }) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-text-secondary">{label}</div>
      <div className="flex items-stretch gap-1.5">
        <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap rounded-md border border-border bg-surface px-2.5 py-2 font-mono text-xs">
          {line}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(line).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
          aria-label={t('copy')}
          title={t('copy')}
          className="flex w-9 flex-shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-secondary hover:bg-surface-hover hover:text-text"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
};

const Chip = ({ children }: { children: ReactNode }) => (
  <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-text-secondary">
    {children}
  </span>
);

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
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span title={linked ? t('midiCreditLinked') : undefined} className="flex-shrink-0">
          <Avatar name={value || '?'} photoUrl={linked ? credit.photo_url : null} size={32} />
        </span>
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
            className="h-9 min-w-0 rounded-md border border-border bg-surface px-3 text-base focus:border-black focus:outline-none sm:text-sm"
          />
          <input
            defaultValue={credit.role}
            aria-label={t('creditRole')}
            placeholder={t('midiCreditRole')}
            onBlur={(e) => e.target.value.trim() !== credit.role && onChange({ role: e.target.value.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="h-9 min-w-0 rounded-md border border-border bg-surface px-3 text-base focus:border-black focus:outline-none sm:text-sm"
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
    </div>
  );
};
