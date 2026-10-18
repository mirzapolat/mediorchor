import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageSpinner } from '@/components/Spinner';
import { NoAccess } from '@/components/NoAccess';
import { useAuth } from '@/hooks/useAuth';
import { usePieceScope } from '@/layouts/pieceScope';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { loadPieceFiles, loadPieceInScope } from '@/lib/pieceFiles';
import { createPracticeStorage } from '@/lib/practiceStorage';
import { allowedTrainerVoices, loadTrainerXml, trainerFile } from '@/lib/trainer';
import type { Piece } from '@/types';

// The trainer brings its own score engraving (OpenSheetMusicDisplay, large):
// loaded only when a piece is practised.
const PracticeView = lazy(() => import('@/tonetrainer/react').then((m) => ({ default: m.PracticeView })));

// A piece practised with the microphone: the whole screen, no sidebar.
// `?bar=<n>` opens with that measure (0-based) in a loop. Everyone in a
// group sings only the voices mapped to it (the piece's configuration),
// editors too; without a group, any.
export const PieceTrainingPage = () => {
  const { t } = useI18n();
  const { base, projectId } = usePieceScope();
  const { pieceId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { resolved: theme } = useTheme();

  const [piece, setPiece] = useState<Piece | null>(null);
  const [xml, setXml] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [loaded, files, voices] = await Promise.all([
        loadPieceInScope(pieceId ?? '', projectId),
        loadPieceFiles(pieceId ?? ''),
        user ? allowedTrainerVoices(pieceId ?? '', projectId, user.id) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      setPiece(loaded);
      setAllowed(voices);
      const file = loaded ? trainerFile(loaded, files) : null;
      if (file) {
        try {
          const text = await loadTrainerXml(file);
          if (!cancelled) setXml(text);
        } catch {
          if (!cancelled) setError(t('trainerLoadFailed'));
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [pieceId, projectId, user, t]);

  const storage = useMemo(() => (user ? createPracticeStorage(user.id) : null), [user]);

  const overview = `${base}/${pieceId}/training`;
  const bar = searchParams.get('bar');
  const loopMeasure = bar != null && /^\d+$/.test(bar) ? Number(bar) : undefined;

  if (loading) return <PageSpinner />;
  if (!piece || !storage) return <NoAccess />;

  // Not (or no longer) open for practice, or the file didn't load.
  if (!xml) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-text-secondary">{error ?? t('trainerUnavailable')}</p>
        <button
          type="button"
          onClick={() => navigate(overview)}
          className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-text"
        >
          <ArrowLeft size={16} />
          {piece.name}
        </button>
      </div>
    );
  }

  return (
    <Suspense fallback={<PageSpinner />}>
      <PracticeView
        scoreId={piece.id}
        title={piece.name}
        xml={xml}
        storage={storage}
        theme={theme}
        initialLoopMeasure={loopMeasure}
        allowedTrackIds={allowed}
        // Back leads to the progress (the piece's Training page), so no
        // extra button for it.
        onBack={() => navigate(overview)}
      />
    </Suspense>
  );
};
