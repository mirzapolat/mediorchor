import { useState } from 'react';
import { FileArchive } from 'lucide-react';
import { ActionCard } from './ActionCard';
import { useI18n } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import { pieceFileUrl, type PieceOverviewFile } from '@/lib/pieceFiles';
import { createZip, safeFileName } from '@/lib/zip';
import type { Piece } from '@/types';

const isPdf = (f: PieceOverviewFile) =>
  Boolean(f.file_path) && (f.kind === 'score' || /\.pdf$/i.test(f.file_name ?? ''));

// One click: every score PDF of every piece as one ZIP, named in programme
// order ("01 Ave verum corpus.pdf"; several PDFs of a piece get their title).
export const ScoresZipBanner = ({
  projectName,
  pieces,
  files,
}: {
  projectName: string;
  pieces: Piece[];
  files: PieceOverviewFile[];
}) => {
  const { t } = useI18n();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState(false);
  const [missing, setMissing] = useState(0);

  const entries = pieces.flatMap((piece, index) => {
    const pdfs = files.filter((f) => f.piece_id === piece.id && isPdf(f));
    const prefix = `${String(index + 1).padStart(2, '0')} ${piece.name}`;
    return pdfs.map((f) => ({
      path: f.file_path as string,
      name: `${safeFileName(pdfs.length > 1 ? `${prefix} – ${f.title || f.file_name}` : prefix)}.pdf`,
    }));
  });
  const pieceCount = new Set(files.filter(isPdf).map((f) => f.piece_id)).size;
  if (entries.length === 0) return null;

  const download = async () => {
    if (progress) return;
    setError(false);
    setMissing(0);
    setProgress({ done: 0, total: entries.length });
    try {
      const used = new Set<string>();
      const zipFiles: Array<{ name: string; data: Uint8Array }> = [];
      let skipped = 0;
      for (const entry of entries) {
        const response = await fetch(pieceFileUrl(entry.path));
        // A PDF missing on the server is left out, the rest still comes.
        if (!response.ok) {
          skipped += 1;
          continue;
        }
        // Two PDFs with the same name must not overwrite each other.
        let name = entry.name;
        for (let n = 2; used.has(name); n++) name = entry.name.replace(/\.pdf$/, ` (${n}).pdf`);
        used.add(name);
        zipFiles.push({ name, data: new Uint8Array(await response.arrayBuffer()) });
        setProgress({ done: zipFiles.length + skipped, total: entries.length });
      }
      setMissing(skipped);
      if (zipFiles.length === 0) throw new Error('nothing');
      const url = URL.createObjectURL(createZip(zipFiles));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeFileName(`${projectName} – ${t('scoresZipName')}`)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      track('scores-zip');
    } catch {
      setError(true);
    }
    setProgress(null);
  };

  return (
    <ActionCard
      icon={FileArchive}
      title={t('scoresZipTitle')}
      busy={progress !== null}
      onClick={() => void download()}
      statusTone={error || missing ? 'danger' : 'muted'}
      status={
        error
          ? t('scoresZipError')
          : missing && !progress
            ? t('scoresZipMissing').replace('{n}', String(missing))
            : progress
              ? `${t('scoresZipLoading')} ${progress.done}/${progress.total}`
              : `${entries.length} ${entries.length === 1 ? 'PDF' : 'PDFs'} · ${pieceCount} ${
                  pieceCount === 1 ? t('pieceSingular') : t('pieces')
                } · ZIP`
      }
    />
  );
};
