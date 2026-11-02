import { useCallback, useEffect, useState } from 'react';
import { Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { ArrowLeft, BarChart3, FileMusic, FolderOpen, Info, Mic, Music, Settings, Workflow } from 'lucide-react';
import { RAIL, SidebarFold, sidebarLabel, useRailTip, useSidebar } from '@/components/Sidebar';
import { MobileContext, NavShell } from '@/components/NavShell';
import { FadingText } from '@/components/FadingText';
import { PageSpinner } from '@/components/Spinner';
import { NoAccess } from '@/components/NoAccess';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { loadPieceInScope } from '@/lib/pieceFiles';
import { usePieceScope } from './pieceScope';
import type { Piece } from '@/types';
import { PAGE_PADDING } from '@/lib/pagePadding';

// What the piece pages share through the layout: the piece as shown in the
// sidebar, kept current when its configuration changes it.
export interface PieceLayoutContext {
  piece: Piece;
  patchPiece: (patch: Partial<Piece>) => void;
}

export const usePieceLayout = () => useOutletContext<{ pieceLayout: PieceLayoutContext }>().pieceLayout;

const PieceHeader = ({ piece, onBack }: { piece: Piece; onBack: () => void }) => {
  const { t } = useI18n();
  const { collapsed } = useSidebar();
  const backTip = useRailTip(t('pieces'));
  return (
    <>
      <button
        onClick={onBack}
        {...backTip}
        className={cn(
          'flex h-14 flex-shrink-0 items-center gap-2 border-b border-border text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text',
          RAIL.icon16,
        )}
      >
        <ArrowLeft size={16} className="flex-shrink-0" />
        <FadingText className={sidebarLabel(collapsed)}>{t('pieces')}</FadingText>
      </button>

      <div className={cn('flex flex-shrink-0 items-start gap-2.5 border-b border-border py-3', RAIL.tile)}>
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-muted text-text-secondary">
          <Music size={16} />
        </span>
        <div className={cn('min-w-0 flex-1 pt-1', sidebarLabel(collapsed))}>
          <FadingText className="block font-semibold">{piece.name}</FadingText>
          {(piece.composer || piece.description.trim()) && (
            <SidebarFold>
              {piece.composer && <p className="mt-0.5 truncate text-sm text-text-secondary">{piece.composer}</p>}
              {/* The short description, as on the pieces list. */}
              {piece.description.trim() && (
                <p className="mt-1.5 line-clamp-3 text-xs text-text-tertiary">{piece.description.trim()}</p>
              )}
            </SidebarFold>
          )}
        </div>
      </div>
    </>
  );
};

// A piece opened from a pieces list gets its own sidebar (like an event):
// back to the list, its title and composer, and its pages — the score and
// player ("Noten"), training, files and, for those who edit it, its
// configuration. The full-screen trainer is outside this layout.
export const PieceLayout = () => {
  const { t } = useI18n();
  const parent = useOutletContext<Record<string, unknown>>();
  const scope = usePieceScope();
  const { pieceId } = useParams();
  const navigate = useNavigate();
  const [piece, setPiece] = useState<Piece | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadPieceInScope(pieceId ?? '', scope.projectId).then((loaded) => {
      if (cancelled) return;
      setPiece(loaded);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [pieceId, scope.projectId]);

  const patchPiece = useCallback((patch: Partial<Piece>) => setPiece((p) => (p ? { ...p, ...patch } : p)), []);

  if (loading) return <PageSpinner />;
  // Unknown piece or no access (e.g. a shared link opened with another account).
  if (!piece) return <NoAccess standalone />;

  const base = `${scope.base}/${piece.id}`;
  const canTrain = piece.trainer_file_id != null;

  return (
    <NavShell
      header={<PieceHeader piece={piece} onBack={() => navigate(scope.base)} />}
      items={[
        { to: base, end: true, label: t('pieceSheetPage'), icon: FileMusic },
        // Only once a MusicXML is on the trainer node (configuration).
        canTrain && { to: `${base}/training`, label: t('trainTitle'), icon: Mic },
        { to: `${base}/files`, label: t('files'), icon: FolderOpen },
        { to: `${base}/details`, label: t('pieceDetailsPage'), icon: Info },
        // The project's training report: its managers only, and only while
        // the piece has training (the same signal as "Training" above).
        canTrain && scope.projectId && scope.canManageProject && { to: `${base}/report`, label: t('reportTitle'), icon: BarChart3 },
        scope.canEdit && { to: `${base}/setup`, label: t('pieceConfigTitle'), icon: Workflow },
        (scope.canEdit || scope.canDelete || (scope.projectId && scope.canManageProject)) && {
          to: `${base}/settings`,
          label: t('settings'),
          icon: Settings,
        },
      ]}
      back={{ to: scope.base, label: t('pieces') }}
      context={
        <MobileContext
          icon={Music}
          title={piece.name}
          meta={piece.composer || undefined}
          description={piece.description.trim() || null}
        />
      }
      contentClassName={PAGE_PADDING}
    >
      <Outlet context={{ ...parent, pieceScope: scope, pieceLayout: { piece, patchPiece } }} />
    </NavShell>
  );
};
