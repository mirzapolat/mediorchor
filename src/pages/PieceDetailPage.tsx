import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MapPin, Maximize2, Minimize2, Music, Settings2 } from 'lucide-react';
import { PageSpinner } from '@/components/Spinner';
import { Button } from '@/components/Button';
import { OverflowMenu } from '@/components/OverflowMenu';
import { EmptyState } from '@/components/EmptyState';
import { NoAccess } from '@/components/NoAccess';
import { PieceScore } from '@/components/PieceScore';
import { PieceBarGrid } from '@/components/PieceBarGrid';
import { PiecePlayerBar, type LoopPicking } from '@/components/PiecePlayerBar';
import { usePracticePlayer } from '@/hooks/usePracticePlayer';
import { useCanPlaceBars, useMediaQuery } from '@/hooks/useMediaQuery';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import {
  loadPieceFiles,
  loadPieceInScope,
  loadPieceTracks,
  pieceScoreFile,
  playerTracks,
  pieceFileUrl,
} from '@/lib/pieceFiles';
import { timelineLabels } from '@/lib/pieceTimeline';
import { ensureScorePreview } from '@/lib/scorePreview';
import { usePieceScope } from '@/layouts/pieceScope';
import { cn } from '@/lib/cn';
import type { BarAnchor, Piece, PieceFile, PieceTrack } from '@/types';

const FOLLOW_KEY = 'anwesenheit.pieces.follow';

// A piece's "Noten" page: the score with tappable bars and a player at the
// bottom that switches voices at the same bar, loops sections and slows
// down. Training, files and configuration are the piece's other pages (its
// sidebar, PieceLayout).
export const PieceDetailPage = () => {
  const { t } = useI18n();
  const { base, projectId, canEdit } = usePieceScope();
  const { pieceId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [piece, setPiece] = useState<Piece | null>(null);
  const [files, setFiles] = useState<PieceFile[]>([]);
  const [voiceRows, setVoiceRows] = useState<PieceTrack[]>([]);
  const [loading, setLoading] = useState(true);
  // Whether the score scrolls along with playback; remembered per browser.
  const [follow, setFollowState] = useState(() => {
    try {
      return localStorage.getItem(FOLLOW_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const setFollow = useCallback((on: boolean) => {
    setFollowState(on);
    try {
      localStorage.setItem(FOLLOW_KEY, on ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, []);
  const [picking, setPicking] = useState<LoopPicking>(null);
  // Bars are placed with a mouse or trackpad only, not on phones.
  const canPlaceBars = useCanPlaceBars();
  const wantsEditing = canEdit && canPlaceBars && searchParams.get('place') === '1';
  // Only one person places bars at a time: the editor opens once the lock
  // is ours, and whoever holds it is named when it isn't.
  const [lockHeld, setLockHeld] = useState(false);
  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const editingAnchors = wantsEditing && lockHeld;
  // Desktop: the player floats over the score column instead of spanning
  // the page bottom.
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const load = useCallback(async () => {
    const [loadedPiece, pieceFiles, pieceTracks] = await Promise.all([
      loadPieceInScope(pieceId ?? '', projectId),
      loadPieceFiles(pieceId ?? ''),
      loadPieceTracks(pieceId ?? ''),
    ]);
    setPiece(loadedPiece);
    setFiles(loadedPiece ? pieceFiles : []);
    setVoiceRows(loadedPiece ? pieceTracks : []);
    setLoading(false);
  }, [pieceId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tracks = useMemo(() => playerTracks(voiceRows, files), [voiceRows, files]);
  const score = useMemo(() => (piece ? pieceScoreFile(piece, files) : null), [piece, files]);

  // The link-preview image of this piece (top of the score), made once by a
  // manager's browser when missing.
  useEffect(() => {
    if (canEdit && pieceId && score && navigator.onLine) void ensureScorePreview(pieceId, score);
  }, [canEdit, pieceId, score]);

  const player = usePracticePlayer(piece, tracks);
  const { bars, currentBar, loop, playBar, setLoop, toggle, prevBar, nextBar } = player;
  const timeRef = useRef(player.time);
  timeRef.current = player.time;

  const labels = useMemo(() => timelineLabels(piece?.timeline ?? null), [piece?.timeline]);
  const loopLabels = useMemo(
    () => (loop ? new Set(bars.slice(loop.from, loop.to + 1).map((b) => b.label)) : null),
    [bars, loop],
  );

  const tapIndex = useCallback(
    (index: number, shiftKey: boolean) => {
      if (picking) {
        if (picking.from == null) {
          setPicking({ from: index });
        } else {
          const from = Math.min(picking.from, index);
          const to = Math.max(picking.from, index);
          setPicking(null);
          setLoop({ from, to });
          playBar(from);
        }
        return;
      }
      if (shiftKey && player.currentIndex >= 0) {
        const from = Math.min(player.currentIndex, index);
        const to = Math.max(player.currentIndex, index);
        setLoop({ from, to });
        playBar(from);
        return;
      }
      playBar(index);
    },
    [picking, player.currentIndex, playBar, setLoop],
  );

  // A marker on the PDF stands for every play of that bar: pick the one
  // closest to where playback is now (the other passes are one tap away in
  // the player).
  const tapLabel = useCallback(
    (label: string, shiftKey: boolean) => {
      const candidates = bars.filter((b) => b.label === label);
      if (candidates.length === 0) return;
      const now = timeRef.current;
      const best = candidates.reduce((a, b) =>
        Math.abs(b.start - now) < Math.abs(a.start - now) ? b : a,
      );
      tapIndex(best.index, shiftKey);
    },
    [bars, tapIndex],
  );

  // Practice fullscreen: only the score and the player. Also asks the
  // browser for real fullscreen where allowed (not on iPhone Safari); the
  // in-page mode works either way.
  const [fullscreen, setFullscreen] = useState(false);
  const enterFullscreen = useCallback(() => {
    setFullscreen(true);
    const root = document.documentElement;
    if (root.requestFullscreen && !document.fullscreenElement) {
      void root.requestFullscreen().catch(() => undefined);
    }
  }, []);
  const exitFullscreen = useCallback(() => {
    setFullscreen(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);
  useEffect(() => {
    // Leaving the browser's fullscreen (Esc, system gesture) ends the mode too.
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;
  const loopActiveRef = useRef(false);
  loopActiveRef.current = Boolean(picking || loop);

  // Space: play/pause, ←/→: bar back/forward, F: fullscreen, Esc: end the
  // loop, then leave fullscreen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevBar();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextBar();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        if (fullscreenRef.current) exitFullscreen();
        else enterFullscreen();
      } else if (e.key === 'Escape') {
        if (loopActiveRef.current) {
          setPicking(null);
          setLoop(null);
        } else if (fullscreenRef.current) {
          exitFullscreen();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, prevBar, nextBar, setLoop, enterFullscreen, exitFullscreen]);

  const saveAnchors = useCallback(
    (anchors: Record<string, BarAnchor>) => {
      if (!piece) return;
      setPiece({ ...piece, bar_anchors: anchors });
      // The query only runs once awaited/then'd.
      void api.from('pieces').update({ bar_anchors: anchors }).eq('id', piece.id).then(() => undefined);
    },
    [piece],
  );

  const stopEditing = useCallback(() => {
    searchParams.delete('place');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  // Takes the bar-editing lock and keeps it alive while editing; leaving
  // (or closing the tab) releases it. Refused → back out and say who.
  const lockDeps = useRef({ setSearchParams, t });
  lockDeps.current = { setSearchParams, t };
  useEffect(() => {
    if (!wantsEditing || !pieceId) return;
    let cancelled = false;
    const leave = () =>
      lockDeps.current.setSearchParams(
        (params) => {
          params.delete('place');
          return params;
        },
        { replace: true },
      );
    const take = async () => {
      const { data, error } = await api.rpc('lock_piece_markers', { p_piece_id: pieceId });
      if (cancelled) return;
      const result = data as { locked: boolean; by?: string } | null;
      if (error || !result?.locked) {
        setLockHeld(false);
        setLockedBy(result?.by || lockDeps.current.t('someoneElse'));
        leave();
        return;
      }
      setLockedBy(null);
      setLockHeld(true);
    };
    void take();
    const heartbeat = window.setInterval(() => void take(), 20_000);
    const release = () =>
      fetch('/api/rpc/unlock_piece_markers', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_piece_id: pieceId }),
      }).catch(() => undefined);
    window.addEventListener('pagehide', release);
    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
      window.removeEventListener('pagehide', release);
      setLockHeld(false);
      void release();
    };
  }, [wantsEditing, pieceId]);

  if (loading) return <PageSpinner />;
  // Unknown piece or no access (e.g. a shared link opened with another account).
  if (!piece) return <NoAccess />;

  const hasAnchors = labels.some((l) => piece.bar_anchors[l]);
  // The bar grid is only the fallback for pieces without a score PDF.
  const showGrid = bars.length > 0 && !score;
  const nothingYet = !score && bars.length === 0 && tracks.length === 0;
  const setUpUrl = `${base}/${piece.id}/setup`;

  const playerBar =
    tracks.length > 0 && !editingAnchors ? (
      <PiecePlayerBar
        player={player}
        tracks={tracks}
        picking={picking}
        onPickingChange={setPicking}
        floating={isDesktop}
        // Only meaningful while the score with marked bars is on screen.
        follow={score && hasAnchors ? { on: follow, onChange: setFollow } : undefined}
      />
    ) : null;

  // Above the score, on the right: fullscreen and the editors' marker
  // placing (no title: the sidebar names the page).
  const toolbar = (
    <div className="mb-2 flex items-center justify-end gap-3">
      <div className="flex items-center gap-1">
        {!nothingYet && (
          <button
            type="button"
            onClick={enterFullscreen}
            aria-label={t('fullscreen')}
            title={`${t('fullscreen')} (F)`}
            className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition-colors duration-150 hover:bg-surface-hover hover:text-text"
          >
            <Maximize2 size={17} />
          </button>
        )}
        {canEdit && score && labels.length > 0 && canPlaceBars && (
          <OverflowMenu
            label={t('moreActions')}
            items={[
              {
                icon: MapPin,
                label: hasAnchors ? t('editMarkers') : t('placeBars'),
                onSelect: () => setSearchParams({ place: '1' }, { replace: true }),
              },
            ]}
          />
        )}
      </div>
    </div>
  );

  const scoreContent = nothingYet ? (
    <div className="rounded-md border border-dashed border-border">
      <EmptyState icon={Music} message={canEdit ? t('pieceEmptyManager') : t('pieceEmpty')} />
      {canEdit && (
        <div className="-mt-8 flex justify-center pb-10">
          <Button onClick={() => navigate(setUpUrl)}>
            <Settings2 size={16} />
            {t('setUpPiece')}
          </Button>
        </div>
      )}
    </div>
  ) : (
    <>
      {lockedBy && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-text">
          <span className="min-w-0 flex-1">{t('markersLockedBy').replace('{name}', lockedBy)}</span>
          <button
            type="button"
            onClick={() => setLockedBy(null)}
            aria-label={t('close')}
            className="-my-0.5 flex-shrink-0 text-text-secondary hover:text-text"
          >
            ×
          </button>
        </div>
      )}
      {/* Editors learn they can place the bars; members see the score as it is. */}
      {canEdit && score && !hasAnchors && bars.length > 0 && !editingAnchors && (
        <p className="mb-3 rounded-md bg-surface-muted px-3 py-2 text-sm text-text-secondary">
          {t(canPlaceBars ? 'noMarkersManager' : 'noMarkersManagerPhone')}
        </p>
      )}

      {showGrid ? (
        <PieceBarGrid
          bars={bars}
          currentIndex={player.currentIndex}
          loop={loop}
          pickFrom={picking?.from ?? null}
          onTap={tapIndex}
        />
      ) : (
        score?.file_path && (
          <PieceScore
            url={pieceFileUrl(score.file_path)}
            labels={labels}
            anchors={piece.bar_anchors}
            currentLabel={currentBar?.label ?? null}
            loopLabels={loopLabels}
            pickLabel={picking?.from != null ? (bars[picking.from]?.label ?? null) : null}
            barShift={piece.bar_shift ?? 0}
            follow={follow && player.playing}
            onBarTap={tapLabel}
            editing={editingAnchors}
            onEditingDone={stopEditing}
            onAnchorsChange={saveAnchors}
          />
        )
      )}
    </>
  );

  const exitButton = fullscreen && (
    <button
      type="button"
      onClick={exitFullscreen}
      className="fixed left-3 top-3 z-[80] inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-surface/70 px-3.5 text-sm font-medium text-text shadow-md backdrop-blur-xl transition-colors hover:bg-surface"
    >
      <Minimize2 size={15} />
      {t('exitFullscreen')}
    </button>
  );

  // In fullscreen the page lifts above the whole app (sidebars, top bar).
  // The wrapper is always rendered so the score isn't re-mounted. Tall
  // enough that the player sits at the bottom even on short pages.
  return (
    <div className={fullscreen ? 'fixed inset-0 z-[70] overflow-y-auto overscroll-contain bg-bg' : undefined}>
      {exitButton}
      <div
        className={cn(
          'flex flex-col',
          fullscreen
            ? 'mx-auto min-h-[100dvh] max-w-6xl px-4 pb-4 pt-14 sm:px-6 sm:pb-6 lg:px-8 lg:pt-16'
            : 'min-h-[calc(100dvh-5.5rem)] sm:min-h-[calc(100dvh-6.5rem)] md:min-h-[calc(100dvh-3rem)] lg:min-h-[calc(100dvh-4rem)]',
        )}
      >
        {!fullscreen && toolbar}
        <div className="mb-6 flex-1">{scoreContent}</div>
        {playerBar}
      </div>
    </div>
  );
};
