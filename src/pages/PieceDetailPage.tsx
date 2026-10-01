import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileCode2,
  FileMusic,
  FileText,
  Link as LinkIcon,
  MapPin,
  Maximize2,
  Minimize2,
  Music,
  Paperclip,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import { PageSpinner } from '@/components/Spinner';
import { Button } from '@/components/Button';
import { OverflowMenu } from '@/components/OverflowMenu';
import { EmptyState } from '@/components/EmptyState';
import { NoAccess } from '@/components/NoAccess';
import { Avatar } from '@/components/Avatar';
import { MetronomeDebug } from '@/components/MetronomeDebug';
import { PieceScore } from '@/components/PieceScore';
import { PieceBarGrid } from '@/components/PieceBarGrid';
import { PiecePlayerBar, type LoopPicking } from '@/components/PiecePlayerBar';
import { usePracticePlayer } from '@/hooks/usePracticePlayer';
import { useCanPlaceBars, useMediaQuery } from '@/hooks/useMediaQuery';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { api } from '@/lib/api';
import { loadPiece, loadPieceFiles, pieceFileDownloadUrl, pieceFileUrl } from '@/lib/pieceFiles';
import { timelineLabels } from '@/lib/pieceTimeline';
import { ensureScorePreview } from '@/lib/scorePreview';
import { useProjectContext } from '@/layouts/projectContext';
import { cn } from '@/lib/cn';
import type { BarAnchor, Piece, PieceFile, PieceFileKind } from '@/types';

type Tab = 'score' | 'credits' | 'files';

const FOLLOW_KEY = 'anwesenheit.pieces.follow';

const FILE_GROUPS: Array<{ kind: PieceFileKind; label: TranslationKey; icon: LucideIcon }> = [
  { kind: 'score', label: 'fileKindScore', icon: FileText },
  { kind: 'audio', label: 'fileKindAudio', icon: Music },
  { kind: 'notation', label: 'fileKindNotation', icon: FileCode2 },
  { kind: 'midi', label: 'fileKindMidi', icon: FileMusic },
  { kind: 'other', label: 'fileKindOther', icon: Paperclip },
  { kind: 'link', label: 'fileKindLink', icon: LinkIcon },
];

// Downloads and links, grouped by what they are.
const FileList = memo(({ files }: { files: PieceFile[] }) => {
  const { t } = useI18n();
  if (files.length === 0) {
    return <p className="text-sm text-text-secondary">{t('noFiles')}</p>;
  }
  return (
    <div className="space-y-4">
      {FILE_GROUPS.map(({ kind, label, icon: Icon }) => {
        const group = files.filter((f) => f.kind === kind);
        if (group.length === 0) return null;
        return (
          <div key={kind}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
              {t(label)}
            </h3>
            <ul className="divide-y divide-border rounded-md border border-border bg-surface">
              {group.map((f) => {
                // Only plain web links are ever rendered as a clickable href.
                const href =
                  kind === 'link'
                    ? /^https?:\/\//i.test(f.url ?? '')
                      ? (f.url as string)
                      : '#'
                    : f.file_path && f.file_name
                      ? pieceFileDownloadUrl(f.file_path, f.file_name)
                      : '#';
                const name = f.title || f.file_name || f.url || '—';
                return (
                  <li key={f.id}>
                    <a
                      href={href}
                      {...(kind === 'link' ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
                      className="flex min-h-[3rem] items-center gap-3 px-3 py-2 text-sm transition-colors duration-150 hover:bg-surface-subtle"
                    >
                      <Icon size={16} className="flex-shrink-0 text-text-secondary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{name}</span>
                        {name !== (f.file_name ?? f.url) && (
                          <span className="block truncate text-xs text-text-tertiary">
                            {f.file_name ?? f.url}
                          </span>
                        )}
                      </span>
                      {kind === 'link' ? (
                        <ExternalLink size={15} className="flex-shrink-0 text-text-tertiary" />
                      ) : (
                        <Download size={15} className="flex-shrink-0 text-text-tertiary" />
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
});
FileList.displayName = 'FileList';

// Who made the MIDI files, with their profile photo. Display only:
// nothing here links anywhere.
const Credits = memo(({ piece }: { piece: Piece }) => {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3">
      <Avatar name={piece.midi_credit_name} photoUrl={piece.midi_credit_photo_url} size={40} />
      <div className="min-w-0">
        <p className="truncate font-medium">{piece.midi_credit_name}</p>
        <p className="text-sm text-text-secondary">{t('midiCreditRole')}</p>
      </div>
    </div>
  );
});
Credits.displayName = 'Credits';

const SectionTitle = ({ children }: { children: string }) => (
  <h2 className="mb-3 hidden text-sm font-semibold lg:block">{children}</h2>
);

// A piece's practice page: the score with tappable bars, a player at the
// bottom that switches voices at the same bar, loops sections and slows
// down, plus notes and all downloads. Built phone-first: on small screens
// score / notes / files are tabs; on wide screens notes and files sit beside
// the score.
export const PieceDetailPage = () => {
  const { t } = useI18n();
  const { project, canManage } = useProjectContext();
  const { pieceId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [piece, setPiece] = useState<Piece | null>(null);
  const [files, setFiles] = useState<PieceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('score');
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
  const wantsEditing = canManage && canPlaceBars && searchParams.get('place') === '1';
  // Only one person places bars at a time: the editor opens once the lock
  // is ours, and whoever holds it is named when it isn't.
  const [lockHeld, setLockHeld] = useState(false);
  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const editingAnchors = wantsEditing && lockHeld;
  // Desktop: the player floats over the score column instead of spanning
  // the page bottom.
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const load = useCallback(async () => {
    const [loadedPiece, pieceFiles] = await Promise.all([
      loadPiece(pieceId ?? ''),
      loadPieceFiles(pieceId ?? ''),
    ]);
    setPiece(loadedPiece);
    setFiles(pieceFiles);
    setLoading(false);
  }, [pieceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tracks = useMemo(() => files.filter((f) => f.kind === 'audio' && f.file_path), [files]);
  const score = files.find((f) => f.kind === 'score' && f.file_path) ?? null;

  // The link-preview image of this piece (top of the score), made once by a
  // manager's browser when missing.
  useEffect(() => {
    if (canManage && pieceId && score && navigator.onLine) void ensureScorePreview(pieceId, score);
  }, [canManage, pieceId, score]);

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

  // Metronome debugging (append ?metronome-debug to the URL); read-only.
  if (searchParams.has('metronome-debug')) return <MetronomeDebug piece={piece} tracks={tracks} />;

  const hasAnchors = labels.some((l) => piece.bar_anchors[l]);
  const hasCredit = piece.midi_credit_name.trim() !== '';
  // The bar grid is only the fallback for pieces without a score PDF.
  const showGrid = bars.length > 0 && !score;
  const nothingYet = !score && bars.length === 0 && tracks.length === 0;

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

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'score', label: t('scoreTab') },
    // Only when someone is credited.
    ...(hasCredit ? [{ id: 'credits' as const, label: t('credits') }] : []),
    { id: 'files', label: `${t('files')}${files.length ? ` · ${files.length}` : ''}` },
  ];

  const setUpUrl = `/projects/${project.id}/pieces/${piece.id}/setup`;

  // Back link on the left, the managers' "⋯" menu on the right.
  const topRow = (
    <div className="mb-4 flex items-center justify-between gap-3">
      <button
        onClick={() => navigate(`/projects/${project.id}/pieces`)}
        className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
      >
        <ArrowLeft size={16} />
        {t('pieces')}
      </button>
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
        {canManage && (
          <OverflowMenu
            label={t('moreActions')}
            items={[
              { icon: Settings2, label: t('setUp'), onSelect: () => navigate(setUpUrl) },
              ...(score && labels.length > 0 && canPlaceBars
                ? [
                    {
                      icon: MapPin,
                      label: hasAnchors ? t('editMarkers') : t('placeBars'),
                      onSelect: () => {
                        setTab('score');
                        setSearchParams({ place: '1' }, { replace: true });
                      },
                    },
                  ]
                : []),
            ]}
          />
        )}
      </div>
    </div>
  );

  const header = (
    <header className="mb-4 min-w-0">
      <h1 className="text-xl font-bold sm:text-2xl">{piece.name}</h1>
      {(piece.composer || piece.description) && (
        <p className="mt-1 text-sm text-text-secondary">
          {[piece.composer, piece.description].filter(Boolean).join(' · ')}
        </p>
      )}
    </header>
  );

  const scoreContent = nothingYet ? (
    <div className="rounded-md border border-dashed border-border">
      <EmptyState icon={Music} message={canManage ? t('pieceEmptyManager') : t('pieceEmpty')} />
      {canManage && (
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
      {score && !hasAnchors && bars.length > 0 && !editingAnchors && (
        <p className="mb-3 rounded-md bg-surface-muted px-3 py-2 text-sm text-text-secondary">
          {canManage ? t(canPlaceBars ? 'noMarkersManager' : 'noMarkersManagerPhone') : t('noMarkers')}
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

  // In fullscreen the page lifts above the whole app (sidebar, top bar).
  // The wrapper is always rendered so the score isn't re-mounted.
  const overlayClass = fullscreen ? 'fixed inset-0 z-[70] overflow-y-auto overscroll-contain bg-bg' : undefined;

  const notesAndFiles = (
    <>
      {hasCredit && (
        <section className={cn(tab !== 'credits' && 'max-lg:hidden')}>
          <SectionTitle>{t('credits')}</SectionTitle>
          <Credits piece={piece} />
        </section>
      )}
      <section className={cn(tab !== 'files' && 'max-lg:hidden')}>
        <SectionTitle>{t('files')}</SectionTitle>
        <FileList files={files} />
      </section>
    </>
  );

  // Desktop: the score fills the main column; title, controls, notes and
  // files live in a floating panel on the right (like the left sidebar).
  if (isDesktop) {
    return (
      <div className={overlayClass}>
        {exitButton}
        <div
          className={cn(
            'grid items-start gap-8',
            fullscreen
              ? 'mx-auto min-h-[100dvh] max-w-6xl grid-cols-1 px-8 pt-16'
              : 'min-h-[calc(100dvh-4rem)] grid-cols-[minmax(0,1fr)_20rem]',
          )}
        >
          <section className="flex flex-col self-stretch">
            <div className="flex-1">{scoreContent}</div>
            {playerBar}
          </section>
          {!fullscreen && (
            <aside className="sticky top-3 -mt-5 h-[calc(100dvh-1.5rem)] space-y-6 overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.12)]">
              <div>
                {topRow}
                {header}
              </div>
              <div className="space-y-8 border-t border-border pt-5">{notesAndFiles}</div>
            </aside>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={overlayClass}>
      {exitButton}
      {/* Tall enough that the player sits at the bottom even on short pages. */}
      <div
        className={cn(
          'flex flex-col',
          fullscreen
            ? 'min-h-[100dvh] px-4 pb-4 pt-14 sm:px-6 sm:pb-6'
            : 'min-h-[calc(100dvh-5.5rem)] sm:min-h-[calc(100dvh-6.5rem)] md:min-h-[calc(100dvh-3rem)]',
        )}
      >
        {!fullscreen && topRow}
        {!fullscreen && header}

        {/* Phone/tablet: tabs. */}
        {!fullscreen && (
          <div role="tablist" className="mb-4 flex rounded-md border border-border bg-surface-muted p-1">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                type="button"
                role="tab"
                aria-selected={tab === tb.id}
                onClick={() => setTab(tb.id)}
                className={cn(
                  'h-9 flex-1 rounded text-sm font-medium transition-colors duration-150',
                  tab === tb.id ? 'bg-surface text-text shadow-sm' : 'text-text-secondary hover:text-text',
                )}
              >
                {tb.label}
              </button>
            ))}
          </div>
        )}

        <div className="mb-6 flex-1">
          <section className={cn(tab !== 'score' && !fullscreen && 'hidden')}>{scoreContent}</section>
          {!fullscreen && <div className="space-y-8">{notesAndFiles}</div>}
        </div>

        {playerBar}
      </div>
    </div>
  );
};
