import { useState } from 'react';
import { Download, FileArchive, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { pieceFileUrl, type PieceOverviewFile } from '@/lib/pieceFiles';
import { createZip, safeFileName } from '@/lib/zip';
import { cn } from '@/lib/cn';
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
    } catch {
      setError(true);
    }
    setProgress(null);
  };

  return (
    <button
      type="button"
      onClick={() => void download()}
      disabled={progress !== null}
      className={cn(
        'group mb-3 flex w-full max-w-3xl items-center gap-3 rounded-xl border border-border bg-surface px-3 py-3 text-left transition-colors duration-150 hover:bg-surface-subtle sm:gap-4 sm:px-5',
        progress && 'cursor-progress',
      )}
    >
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-surface-muted text-text-secondary transition-colors duration-150 group-hover:bg-black group-hover:text-white">
        <FileArchive size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{t('scoresZipTitle')}</span>
        <span className={cn('block text-sm', error || missing ? 'text-danger' : 'text-text-secondary')}>
          {error
            ? t('scoresZipError')
            : missing && !progress
              ? t('scoresZipMissing').replace('{n}', String(missing))
            : progress
              ? `${t('scoresZipLoading')} ${progress.done}/${progress.total}`
              : `${entries.length} ${entries.length === 1 ? 'PDF' : 'PDFs'} · ${pieceCount} ${
                  pieceCount === 1 ? t('pieceSingular') : t('pieces')
                } · ZIP`}
        </span>
      </span>
      {progress ? (
        <Loader2 size={18} className="flex-shrink-0 animate-spin text-text-secondary" />
      ) : (
        <Download size={18} className="flex-shrink-0 text-text-tertiary transition-colors group-hover:text-text" />
      )}
    </button>
  );
};
