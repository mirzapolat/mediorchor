import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, Settings2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { PageSpinner } from '@/components/Spinner';
import { useAuth } from '@/hooks/useAuth';
import { usePieceLayout } from '@/layouts/PieceLayout';
import { usePieceScope } from '@/layouts/pieceScope';
import { useI18n } from '@/lib/i18n';
import { createPracticeStorage } from '@/lib/practiceStorage';
import type { SessionRecord } from '@/tonetrainer/core';

// The trainer's charts come with its (large) chunk, like the trainer itself.
const ProgressView = lazy(() => import('@/tonetrainer/react').then((m) => ({ default: m.ProgressView })));
const PracticeTimeChart = lazy(() => import('@/tonetrainer/react').then((m) => ({ default: m.PracticeTimeChart })));

// A piece's "Training" page: one's own progress with this piece over time
// (practice time, accuracy per run, stubborn and improved bars) and the
// start of the full-screen trainer — whole piece or a single bar.
export const PieceTrainingOverviewPage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { base, canEdit } = usePieceScope();
  const { piece } = usePieceLayout();
  const { user } = useAuth();
  const storage = useMemo(() => (user ? createPracticeStorage(user.id) : null), [user]);
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);

  const ready = piece.trainer_file_id != null;
  useEffect(() => {
    if (!storage || !ready) return;
    void storage.sessions(piece.id).then(setSessions);
  }, [storage, piece.id, ready]);

  const run = `${base}/${piece.id}/training/run`;
  const start = (measure?: number) => navigate(measure != null ? `${run}?bar=${measure}` : run);

  if (!ready) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-xl font-bold sm:text-2xl">{t('trainTitle')}</h1>
        <div className="rounded-2xl border border-dashed border-accent/50 p-5">
          <p className="text-sm text-text-secondary">{canEdit ? t('trainSetupHint') : t('trainerUnavailable')}</p>
          {canEdit && (
            <Button variant="secondary" className="mt-4" onClick={() => navigate(`${base}/${piece.id}/setup`)}>
              <Settings2 size={16} />
              {t('pieceConfigTitle')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-6">
      <h1 className="text-xl font-bold sm:text-2xl">{t('trainTitle')}</h1>

      {/* The start, in the trainer's colour. */}
      <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-accent/40 bg-accent/10 p-5">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent">
          <Mic size={20} aria-hidden />
        </span>
        <p className="min-w-0 flex-1 text-sm text-text-secondary">{t('trainText')}</p>
        <Button onClick={() => start()}>
          <Mic size={16} />
          {t('trainStart')}
        </Button>
      </section>

      {storage && sessions === null ? (
        <PageSpinner />
      ) : sessions && sessions.length === 0 ? (
        <p className="text-sm text-text-secondary">{t('trainNoSessions')}</p>
      ) : (
        storage && (
          <Suspense fallback={<PageSpinner />}>
            <PracticeTimeChart sessions={sessions ?? []} />
            <ProgressView scoreId={piece.id} title={piece.name} storage={storage} onPractice={start} embedded />
          </Suspense>
        )
      )}
    </div>
  );
};
