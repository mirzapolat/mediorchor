import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, FileUp, MapPin, Repeat, Trash2, X } from 'lucide-react';
import { AudioPlayer } from '@/components/AudioPlayer';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageHeader } from '@/components/PageHeader';
import { PageSpinner } from '@/components/Spinner';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { pieceFileDownloadUrl, pieceFileUrl, removePieceFiles, uploadPieceFile } from '@/lib/pieceFiles';
import { useProjectContext } from '@/layouts/projectContext';
import { cn } from '@/lib/cn';
import type { BarAnchor, Piece, PieceBlock } from '@/types';

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5];

// pdf.js is heavy; load it only when a practice page actually shows a score.
const PdfScoreView = lazy(() =>
  import('@/components/PdfScoreView').then((m) => ({ default: m.PdfScoreView })),
);

// Practice page for an audio block with bar (Takt) metadata: the recording is
// laid out as a grid of bars. Tapping a bar starts playback right there,
// shift-click selects a range, and the current bar fills up live while
// playing. Bars are assumed to be evenly spaced across the recording.
export const PiecePracticePage = () => {
  const { t } = useI18n();
  const { project, canManage } = useProjectContext();
  const { pieceId, blockId } = useParams();
  const navigate = useNavigate();

  const [piece, setPiece] = useState<Piece | null>(null);
  const [block, setBlock] = useState<PieceBlock | null>(null);
  const [loading, setLoading] = useState(true);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Selected bars (absolute bar numbers). selEnd === null → play to the end.
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [loop, setLoop] = useState(false);
  const [rate, setRate] = useState(1);
  const loopRef = useRef({ loop, selStart, selEnd });
  loopRef.current = { loop, selStart, selEnd };

  // Score PDF + bar anchors.
  const scoreInputRef = useRef<HTMLInputElement>(null);
  const [anchors, setAnchors] = useState<Record<string, BarAnchor>>({});
  const anchorsRef = useRef(anchors);
  const [anchorMode, setAnchorMode] = useState(false);
  const [placeBar, setPlaceBar] = useState<number | null>(null);
  const [scoreBusy, setScoreBusy] = useState(false);
  const [removeScoreOpen, setRemoveScoreOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const anchorDrag = useRef<{ bar: number; moved: boolean } | null>(null);
  const suppressAnchorClick = useRef(false);

  const load = useCallback(async () => {
    const [pieceResult, blockResult] = await Promise.all([
      api.from('pieces').select('*').eq('id', pieceId).maybeSingle(),
      api.from('piece_blocks').select('*').eq('id', blockId).maybeSingle(),
    ]);
    const loadedBlock = (blockResult.data as PieceBlock | null) ?? null;
    setPiece((pieceResult.data as Piece | null) ?? null);
    setBlock(loadedBlock);
    const loadedAnchors = loadedBlock?.bar_anchors ?? {};
    setAnchors(loadedAnchors);
    anchorsRef.current = loadedAnchors;
    setLoading(false);
  }, [pieceId, blockId]);

  useEffect(() => {
    void load();
  }, [load]);

  const firstBar = block?.bars_start ?? 1;
  const lastBar = block?.bars_end ?? 1;
  const totalBars = lastBar - firstBar + 1;
  const barDuration = duration > 0 ? duration / totalBars : 0;
  const timeForBar = useCallback(
    (bar: number) => (bar - firstBar) * barDuration,
    [firstBar, barDuration],
  );

  // Drive time display, loop and range-stop from a rAF loop so the progress
  // fill inside the current bar moves smoothly (timeupdate only fires ~4×/s).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        const { loop: looping, selStart: start, selEnd: end } = loopRef.current;
        const startTime = start != null ? timeForBar(start) : 0;
        const endTime =
          end != null ? timeForBar(end + 1) : audio.duration || Number.POSITIVE_INFINITY;
        if (!audio.paused && audio.currentTime >= endTime - 0.02) {
          if (looping) {
            audio.currentTime = startTime;
          } else if (end != null) {
            audio.pause();
            audio.currentTime = startTime;
          }
        }
        if (looping && audio.ended && start != null) {
          audio.currentTime = startTime;
          void audio.play();
        }
        setCurrentTime(audio.currentTime);
        setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
        setPlaying(!audio.paused && !audio.ended);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [timeForBar]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, block]);

  if (loading) return <PageSpinner />;
  if (!piece || !block || block.type !== 'audio' || !block.has_bars || !block.file_path) {
    navigate(`/projects/${project.id}/pieces/${pieceId}`);
    return null;
  }

  const currentBar =
    barDuration > 0
      ? Math.min(lastBar, firstBar + Math.floor(currentTime / barDuration))
      : null;

  const playFromBar = (bar: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = timeForBar(bar);
    audio.playbackRate = rate;
    void audio.play();
  };

  const clickBar = (bar: number, shiftKey: boolean) => {
    if (anchorMode) {
      // In anchor mode the grid chooses which bar to place next.
      setPlaceBar(bar);
      return;
    }
    if (shiftKey && selStart != null && bar > selStart) {
      setSelEnd(bar);
      return;
    }
    setSelStart(bar);
    setSelEnd(null);
    playFromBar(bar);
  };

  const clearSelection = () => {
    setSelStart(null);
    setSelEnd(null);
  };

  const bars = Array.from({ length: totalBars }, (_, i) => firstBar + i);
  const inSelection = (bar: number) =>
    selStart != null &&
    (selEnd != null ? bar >= selStart && bar <= selEnd : bar === selStart);

  // ---- Score PDF + anchors -------------------------------------------------

  const persistAnchors = (next: Record<string, BarAnchor>) => {
    anchorsRef.current = next;
    setAnchors(next);
    void api
      .from('piece_blocks')
      .update({ bar_anchors: next })
      .eq('id', block.id)
      .then(({ error }) => setSaveError(error?.message ?? null));
  };

  // Next bar the anchor mode will place: explicit grid choice, else the first
  // bar that has no anchor yet.
  const nextPlaceBar = placeBar ?? bars.find((bar) => !anchors[String(bar)]) ?? null;

  const placeAnchor = (page: number, x: number, y: number) => {
    if (!anchorMode || nextPlaceBar == null) return;
    persistAnchors({ ...anchorsRef.current, [String(nextPlaceBar)]: { page, x, y } });
    setPlaceBar(null);
  };

  const removeAnchor = (bar: number) => {
    const next = { ...anchorsRef.current };
    delete next[String(bar)];
    persistAnchors(next);
  };

  const startAnchorDrag = (e: ReactPointerEvent<HTMLButtonElement>, bar: number) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    anchorDrag.current = { bar, moved: false };
  };

  const moveAnchorDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = anchorDrag.current;
    if (!drag || e.buttons === 0) return;
    const overlayEl = e.currentTarget.parentElement;
    if (!overlayEl) return;
    drag.moved = true;
    const rect = overlayEl.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const existing = anchorsRef.current[String(drag.bar)];
    if (!existing) return;
    const next = { ...anchorsRef.current, [String(drag.bar)]: { ...existing, x, y } };
    anchorsRef.current = next;
    setAnchors(next);
  };

  const endAnchorDrag = () => {
    const drag = anchorDrag.current;
    anchorDrag.current = null;
    if (drag?.moved) {
      // The pointerup of a drag still fires a click; don't treat it as remove.
      suppressAnchorClick.current = true;
      persistAnchors(anchorsRef.current);
    }
  };

  const uploadScore = async (file: File) => {
    setScoreBusy(true);
    const result = await uploadPieceFile(block.piece_id, file);
    if (result.path) {
      if (block.score_path) void removePieceFiles([block.score_path]);
      await api
        .from('piece_blocks')
        .update({ score_path: result.path, score_name: file.name })
        .eq('id', block.id);
      setBlock({ ...block, score_path: result.path, score_name: file.name });
    }
    setScoreBusy(false);
  };

  const removeScore = async () => {
    if (block.score_path) void removePieceFiles([block.score_path]);
    await api
      .from('piece_blocks')
      .update({ score_path: null, score_name: null, bar_anchors: {} })
      .eq('id', block.id);
    setBlock({ ...block, score_path: null, score_name: null });
    persistAnchors({});
    setAnchorMode(false);
    setRemoveScoreOpen(false);
  };

  // Bar buttons pinned onto a PDF page.
  const scoreOverlay = (page: number) => (
    <>
      {bars
        .filter((bar) => anchors[String(bar)]?.page === page)
        .map((bar) => {
          const anchor = anchors[String(bar)];
          const isCurrent = playing && currentBar === bar;
          const selected = inSelection(bar);
          return (
            <button
              key={bar}
              type="button"
              style={{
                left: `${anchor.x * 100}%`,
                top: `${anchor.y * 100}%`,
                touchAction: anchorMode ? 'none' : undefined,
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!anchorMode) {
                  clickBar(bar, e.shiftKey);
                } else if (suppressAnchorClick.current) {
                  suppressAnchorClick.current = false;
                } else {
                  removeAnchor(bar);
                }
              }}
              onPointerDown={anchorMode ? (e) => startAnchorDrag(e, bar) : undefined}
              onPointerMove={anchorMode ? moveAnchorDrag : undefined}
              onPointerUp={anchorMode ? endAnchorDrag : undefined}
              onPointerCancel={anchorMode ? endAnchorDrag : undefined}
              className={cn(
                'absolute z-10 flex h-7 min-w-[1.75rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border px-1 text-xs font-semibold tabular-nums shadow-sm transition-all duration-150',
                // Bright red so the buttons stand out against the black-and-white
                // score; the bar currently playing grows and gets a glowing halo.
                isCurrent
                  ? 'scale-150 border-2 border-white bg-[#dc2626] text-white shadow-[0_0_0_3px_#dc2626,0_0_14px_4px_rgba(220,38,38,0.6)]'
                  : selected
                    ? 'border-[#dc2626] bg-white text-[#dc2626]'
                    : 'border-[#dc2626] bg-[#ef4444] text-white hover:bg-[#dc2626]',
                anchorMode && 'cursor-move',
              )}
            >
              {bar}
            </button>
          );
        })}
    </>
  );

  return (
    <>
      <button
        onClick={() => navigate(`/projects/${project.id}/pieces/${piece.id}`)}
        className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
      >
        <ArrowLeft size={16} />
        {piece.name}
      </button>

      <input
        ref={scoreInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void uploadScore(file);
        }}
      />

      <PageHeader
        title={block.title || block.file_name || t('blockAudio')}
        subtitle={`${totalBars} ${t('barsCount').toLowerCase()} (${firstBar}–${lastBar})`}
        actions={
          // Score PDF and bar anchors are project content — management only.
          canManage ? (
            <>
              <Button
                variant="secondary"
                disabled={scoreBusy}
                onClick={() => scoreInputRef.current?.click()}
              >
                <FileUp size={16} />
                {scoreBusy ? t('loading') : block.score_path ? t('replaceScorePdf') : t('addScorePdf')}
              </Button>
              {block.score_path && (
                <>
                  <Button
                    variant={anchorMode ? 'primary' : 'secondary'}
                    onClick={() => {
                      setAnchorMode((v) => !v);
                      setPlaceBar(null);
                    }}
                  >
                    {anchorMode ? <Check size={16} /> : <MapPin size={16} />}
                    {anchorMode ? t('done') : t('anchorBars')}
                  </Button>
                  <Button variant="secondary" onClick={() => setRemoveScoreOpen(true)}>
                    <Trash2 size={16} />
                    {t('removeScorePdf')}
                  </Button>
                </>
              )}
            </>
          ) : undefined
        }
      />

      <Card className="mb-6 space-y-3">
        <AudioPlayer
          src={pieceFileUrl(block.file_path)}
          downloadUrl={
            block.file_name ? pieceFileDownloadUrl(block.file_path, block.file_name) : undefined
          }
          audioRef={audioRef}
          extraControls={
            <>
              <button
                type="button"
                onClick={() => setLoop((v) => !v)}
                aria-label={t('loop')}
                title={t('loop')}
                aria-pressed={loop}
                className={cn(
                  'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md transition-colors duration-150',
                  loop
                    ? 'bg-black text-white hover:bg-black-hover'
                    : 'text-text-secondary hover:bg-[#f0f0f0] hover:text-text',
                )}
              >
                <Repeat size={16} />
              </button>
              <select
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                aria-label={t('playbackSpeed')}
                title={t('playbackSpeed')}
                className="h-8 flex-shrink-0 rounded-md border border-border bg-white px-1.5 text-sm text-text-secondary focus:outline-none focus:border-black transition-colors duration-150"
              >
                {PLAYBACK_RATES.map((r) => (
                  <option key={r} value={r}>
                    {r}×
                  </option>
                ))}
              </select>
            </>
          }
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-secondary">
          <span>
            {t('bar')}{' '}
            <span className="font-semibold text-text tabular-nums">{currentBar ?? '—'}</span>
          </span>
          {selStart != null && (
            <span className="inline-flex items-center gap-1.5">
              {t('selection')}:{' '}
              <span className="font-medium text-text tabular-nums">
                {selEnd != null ? `${selStart}–${selEnd}` : `${t('bar')} ${selStart}`}
              </span>
              <button
                type="button"
                onClick={clearSelection}
                aria-label={t('clearSelection')}
                title={t('clearSelection')}
                className="flex h-5 w-5 items-center justify-center rounded text-text-tertiary hover:text-text transition-colors duration-150"
              >
                <X size={13} />
              </button>
            </span>
          )}
          <span className="text-text-tertiary">{t('barGridHint')}</span>
        </div>
      </Card>

      {block.score_path && (
        <div className="mb-6">
          {saveError && (
            <p className="mb-3 rounded-md border border-accent bg-white px-4 py-3 text-sm text-accent">
              {t('anchorSaveError')}: {saveError}
            </p>
          )}
          {anchorMode && (
            <div className="mb-3 rounded-md border border-black bg-[#f5f5f5] px-4 py-3 text-sm">
              <span className="font-medium">
                {nextPlaceBar != null
                  ? t('placeAnchorHint').replace('{n}', String(nextPlaceBar))
                  : t('allBarsAnchored')}
              </span>{' '}
              <span className="text-text-secondary">{t('anchorEditHint')}</span>
            </div>
          )}
          <Suspense fallback={<PageSpinner />}>
            <PdfScoreView
              url={pieceFileUrl(block.score_path)}
              overlay={scoreOverlay}
              onPageClick={anchorMode ? placeAnchor : undefined}
              clickCursor={anchorMode && nextPlaceBar != null ? 'crosshair' : 'default'}
            />
          </Suspense>
        </div>
      )}

      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))' }}
      >
        {bars.map((bar) => {
          const isCurrent = !anchorMode && playing && currentBar === bar;
          const selected = !anchorMode && inSelection(bar);
          const isPlaceTarget = anchorMode && nextPlaceBar === bar;
          const anchored = Boolean(anchors[String(bar)]);
          const progress =
            isCurrent && barDuration > 0
              ? Math.min(1, Math.max(0, (currentTime - timeForBar(bar)) / barDuration))
              : 0;
          return (
            <button
              key={bar}
              type="button"
              onClick={(e) => clickBar(bar, e.shiftKey)}
              className={cn(
                'relative aspect-square overflow-hidden rounded-md border text-sm font-medium tabular-nums transition-colors duration-150',
                isCurrent || isPlaceTarget
                  ? 'border-black bg-black text-white'
                  : selected
                    ? 'border-black bg-white text-text'
                    : 'border-border bg-surface text-text-secondary hover:border-black hover:text-text',
              )}
            >
              {isCurrent && (
                <span
                  className="absolute inset-y-0 left-0 bg-white/25"
                  style={{ width: `${progress * 100}%` }}
                />
              )}
              <span className="relative">{bar}</span>
              {anchorMode && anchored && (
                <span
                  className={cn(
                    'absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full',
                    isPlaceTarget ? 'bg-white' : 'bg-black',
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      <ConfirmDialog
        open={removeScoreOpen}
        title={t('removeScorePdf')}
        message={t('confirmRemoveScore')}
        confirmLabel={t('remove')}
        destructive
        onConfirm={removeScore}
        onCancel={() => setRemoveScoreOpen(false)}
      />
    </>
  );
};
