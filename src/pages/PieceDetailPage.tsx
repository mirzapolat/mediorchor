import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileCode2,
  FileMusic,
  FileText,
  Grid3x3,
  Link as LinkIcon,
  MapPin,
  Music,
  Paperclip,
  Pencil,
  Settings2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import { PageSpinner } from '@/components/Spinner';
import { Button } from '@/components/Button';
import { HeaderAction } from '@/components/HeaderAction';
import { EmptyState } from '@/components/EmptyState';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { PieceScore } from '@/components/PieceScore';
import { PieceBarGrid } from '@/components/PieceBarGrid';
import { PiecePlayerBar, type LoopPicking } from '@/components/PiecePlayerBar';
import { usePracticePlayer } from '@/hooks/usePracticePlayer';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Markdown } from '@/lib/markdown';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { api } from '@/lib/api';
import { loadPieceFiles, pieceFileDownloadUrl, pieceFileUrl } from '@/lib/pieceFiles';
import { timelineLabels } from '@/lib/pieceTimeline';
import { useProjectContext } from '@/layouts/projectContext';
import { cn } from '@/lib/cn';
import type { BarAnchor, Piece, PieceFile, PieceFileKind } from '@/types';

type Tab = 'score' | 'notes' | 'files';
type ScoreView = 'pdf' | 'grid';

const ZOOMS = [1, 1.5, 2, 2.5];
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

const Notes = memo(
  ({ piece, canManage, onSaved }: { piece: Piece; canManage: boolean; onSaved: (notes: string) => void }) => {
    const { t } = useI18n();
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(piece.notes);
    const [busy, setBusy] = useState(false);

    const save = async () => {
      setBusy(true);
      const { error } = await api.from('pieces').update({ notes: value }).eq('id', piece.id);
      setBusy(false);
      if (!error) {
        onSaved(value);
        setEditing(false);
      }
    };

    if (editing) {
      return (
        <div className="space-y-3">
          <MarkdownEditor id="piece-notes" value={value} onChange={setValue} minHeight={220} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? t('loading') : t('save')}
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div>
        {piece.notes.trim() ? (
          <Markdown source={piece.notes} className="space-y-3 leading-relaxed text-text" />
        ) : (
          <p className="text-sm text-text-secondary">{t('noNotes')}</p>
        )}
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setValue(piece.notes);
              setEditing(true);
            }}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text"
          >
            <Pencil size={14} />
            {piece.notes.trim() ? t('editNotes') : t('addNotes')}
          </button>
        )}
      </div>
    );
  },
);
Notes.displayName = 'Notes';

const SectionTitle = ({ children }: { children: string }) => (
  <h2 className="mb-3 hidden text-sm font-semibold lg:block">{children}</h2>
);

const toolButton =
  'flex h-9 min-w-[2.25rem] items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text disabled:opacity-40';

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
  // null until chosen: the score once bars are placed on it, else the grid.
  const [viewChoice, setView] = useState<ScoreView | null>(null);
  const [zoom, setZoom] = useState(1);
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
  const editingAnchors = canManage && searchParams.get('place') === '1';
  // Desktop: the player floats over the score column instead of spanning
  // the page bottom.
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const load = useCallback(async () => {
    const [pieceResult, pieceFiles] = await Promise.all([
      api.from('pieces').select('*').eq('id', pieceId).maybeSingle(),
      loadPieceFiles(pieceId ?? ''),
    ]);
    setPiece((pieceResult.data as Piece | null) ?? null);
    setFiles(pieceFiles);
    setLoading(false);
  }, [pieceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tracks = useMemo(() => files.filter((f) => f.kind === 'audio' && f.file_path), [files]);
  const score = files.find((f) => f.kind === 'score' && f.file_path) ?? null;
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

  // Space: play/pause, ←/→: bar back/forward, Esc: end loop.
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
      } else if (e.key === 'Escape') {
        setPicking(null);
        setLoop(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, prevBar, nextBar, setLoop]);

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

  const onNotesSaved = useCallback(
    (notes: string) => setPiece((p) => (p ? { ...p, notes } : p)),
    [],
  );

  if (loading) return <PageSpinner />;
  if (!piece) {
    navigate(`/projects/${project.id}/pieces`);
    return null;
  }

  const hasAnchors = labels.some((l) => piece.bar_anchors[l]);
  const view: ScoreView = editingAnchors ? 'pdf' : (viewChoice ?? (hasAnchors ? 'pdf' : 'grid'));
  const showGrid = bars.length > 0 && (!score || view === 'grid');
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
        follow={score && hasAnchors && !showGrid ? { on: follow, onChange: setFollow } : undefined}
      />
    ) : null;

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'score', label: t('scoreTab') },
    { id: 'notes', label: t('notes') },
    { id: 'files', label: `${t('files')}${files.length ? ` · ${files.length}` : ''}` },
  ];

  const setUpUrl = `/projects/${project.id}/pieces/${piece.id}/setup`;

  const backLink = (
    <button
      onClick={() => navigate(`/projects/${project.id}/pieces`)}
      className="mb-4 inline-flex items-center gap-2 self-start text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
    >
      <ArrowLeft size={16} />
      {t('pieces')}
    </button>
  );

  const header = (
    <header className={cn('mb-4 flex gap-3', isDesktop ? 'flex-col' : 'items-start justify-between')}>
      <div className="min-w-0">
        <h1 className="text-xl font-bold sm:text-2xl">{piece.name}</h1>
        {(piece.composer || piece.description) && (
          <p className="mt-1 text-sm text-text-secondary">
            {[piece.composer, piece.description].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
      {canManage &&
        (isDesktop ? (
          <Button variant="secondary" onClick={() => navigate(setUpUrl)} className="w-full">
            <Settings2 size={16} />
            {t('setUp')}
          </Button>
        ) : (
          <HeaderAction icon={Settings2} label={t('setUp')} variant="secondary" onClick={() => navigate(setUpUrl)} />
        ))}
    </header>
  );

  // Score / bars switch, zoom and "place bars". Above the score on phones,
  // in the side panel on desktop.
  const toolbar =
    !nothingYet && (score || bars.length > 0) && !editingAnchors ? (
      <div className={cn('flex flex-wrap items-center gap-2', isDesktop ? 'mb-0' : 'mb-3')}>
        {score && bars.length > 0 && (
          <div className={cn('flex rounded-md border border-border bg-surface-muted p-0.5', isDesktop && 'w-full')}>
            {(['pdf', 'grid'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={cn(
                  'flex h-8 items-center justify-center gap-1.5 rounded px-2.5 text-sm font-medium transition-colors duration-150',
                  isDesktop && 'flex-1',
                  view === v ? 'bg-surface text-text shadow-sm' : 'text-text-secondary hover:text-text',
                )}
              >
                {v === 'pdf' ? <FileText size={14} /> : <Grid3x3 size={14} />}
                {v === 'pdf' ? t('scoreView') : t('barsView')}
              </button>
            ))}
          </div>
        )}
        {score && !showGrid && (
          <div className="flex">
            <button
              type="button"
              className={cn(toolButton, 'rounded-r-none')}
              disabled={zoom === ZOOMS[0]}
              onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}
              aria-label={t('zoomOut')}
            >
              <ZoomOut size={15} />
            </button>
            <button
              type="button"
              className={cn(toolButton, '-ml-px rounded-l-none')}
              disabled={zoom === ZOOMS[ZOOMS.length - 1]}
              onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}
              aria-label={t('zoomIn')}
            >
              <ZoomIn size={15} />
            </button>
          </div>
        )}
        {canManage && score && labels.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setView('pdf');
              setSearchParams({ place: '1' }, { replace: true });
            }}
            className={cn(toolButton, 'ml-auto')}
          >
            <MapPin size={15} />
            <span className="hidden sm:inline">{t('placeBars')}</span>
          </button>
        )}
      </div>
    ) : null;

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
      {!isDesktop && toolbar}

      {score && !hasAnchors && bars.length > 0 && !editingAnchors && view === 'pdf' && (
        <p className="mb-3 rounded-md bg-surface-muted px-3 py-2 text-sm text-text-secondary">
          {canManage ? t('noMarkersManager') : t('noMarkers')}
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
            follow={follow && player.playing}
            zoom={zoom}
            onBarTap={tapLabel}
            editing={editingAnchors}
            onEditingDone={stopEditing}
            onAnchorsChange={saveAnchors}
          />
        )
      )}
    </>
  );

  const notesAndFiles = (
    <>
      <section className={cn(tab !== 'notes' && 'max-lg:hidden')}>
        <SectionTitle>{t('notes')}</SectionTitle>
        <Notes piece={piece} canManage={canManage} onSaved={onNotesSaved} />
      </section>
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
      <div className="grid min-h-[calc(100dvh-4rem)] grid-cols-[minmax(0,1fr)_20rem] items-start gap-8">
        <section className="flex flex-col self-stretch">
          <div className="flex-1">{scoreContent}</div>
          {playerBar}
        </section>
        <aside className="sticky top-3 -mt-5 max-h-[calc(100dvh-1.5rem)] space-y-6 overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.12)]">
          <div>
            {backLink}
            {header}
            {toolbar}
          </div>
          <div className="space-y-8 border-t border-border pt-5">{notesAndFiles}</div>
        </aside>
      </div>
    );
  }

  return (
    // Tall enough that the player sits at the bottom even on short pages.
    <div className="flex min-h-[calc(100dvh-5.5rem)] flex-col sm:min-h-[calc(100dvh-6.5rem)] md:min-h-[calc(100dvh-3rem)]">
      {backLink}
      {header}

      {/* Phone/tablet: tabs. */}
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

      <div className="mb-6 flex-1">
        <section className={cn(tab !== 'score' && 'hidden')}>{scoreContent}</section>
        <div className="space-y-8">{notesAndFiles}</div>
      </div>

      {playerBar}
    </div>
  );
};
