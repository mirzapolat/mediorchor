import { useEffect, useState } from 'react';
import { FileArchive, Loader2 } from 'lucide-react';
import { Button } from './Button';
import { useI18n } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import { pieceFileUrl, type PieceOverviewFile } from '@/lib/pieceFiles';
import { createZip, safeFileName } from '@/lib/zip';
import type { Piece } from '@/types';

const isPdf = (f: PieceOverviewFile) =>
  Boolean(f.file_path) && f.downloadable && (f.kind === 'score' || /\.pdf$/i.test(f.file_name ?? ''));

const extension = (f: PieceOverviewFile, fallback: string) =>
  /\.[a-z0-9]{1,8}$/i.exec(f.file_name ?? f.file_path ?? '')?.[0].toLowerCase() ?? fallback;

interface ZipEntry {
  path: string;
  name: string;
}

// Entries for one kind of file, named in programme order ("01 Ave verum
// corpus.pdf"; several files of a piece get their title), under `folder/`.
const entriesFor = (
  pieces: Piece[],
  files: PieceOverviewFile[],
  matches: (f: PieceOverviewFile) => boolean,
  fallbackExt: string,
  folder = '',
): ZipEntry[] =>
  pieces.flatMap((piece, index) => {
    const own = files.filter((f) => f.piece_id === piece.id && matches(f));
    const prefix = `${String(index + 1).padStart(2, '0')} ${piece.name}`;
    return own.map((f) => ({
      path: f.file_path as string,
      name: `${folder}${safeFileName(own.length > 1 ? `${prefix} – ${f.title || f.file_name}` : prefix)}${extension(f, fallbackExt)}`,
    }));
  });

// Fetches the entries, packs them into a ZIP and hands it to the browser.
const useZipDownload = (zipName: string, trackEvent: string) => {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState(false);
  const [missing, setMissing] = useState(0);

  const download = async (entries: ZipEntry[]) => {
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
        // A file missing on the server is left out, the rest still comes.
        if (!response.ok) {
          skipped += 1;
          continue;
        }
        // Two files with the same name must not overwrite each other.
        let name = entry.name;
        for (let n = 2; used.has(name); n++) name = entry.name.replace(/(\.[^./]+)?$/, ` (${n})$1`);
        used.add(name);
        zipFiles.push({ name, data: new Uint8Array(await response.arrayBuffer()) });
        setProgress({ done: zipFiles.length + skipped, total: entries.length });
      }
      setMissing(skipped);
      if (zipFiles.length === 0) throw new Error('nothing');
      const url = URL.createObjectURL(createZip(zipFiles));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeFileName(zipName)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      track(trackEvent);
    } catch {
      setError(true);
    }
    setProgress(null);
  };

  return { progress, error, missing, download };
};

// One click in the page header: every score PDF of every piece as one ZIP.
// Collapses to its icon on phones; `onStatus` hears what to tell afterwards
// (a failure, or PDFs that were missing on the server).
export const ScoresZipButton = ({
  projectName,
  pieces,
  files,
  onStatus,
}: {
  projectName: string;
  pieces: Piece[];
  files: PieceOverviewFile[];
  onStatus: (status: { text: string; error: boolean } | null) => void;
}) => {
  const { t } = useI18n();
  const { progress, error, missing, download } = useZipDownload(
    `${projectName} – ${t('scoresZipName')}`,
    'scores-zip',
  );
  useEffect(() => {
    if (progress) return;
    onStatus(
      error
        ? { text: t('scoresZipError'), error: true }
        : missing
          ? { text: t('scoresZipMissing').replace('{n}', String(missing)), error: true }
          : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, missing, progress]);

  const entries = entriesFor(pieces, files, isPdf, '.pdf');
  if (entries.length === 0) return null;
  const label = progress ? `${t('scoresZipLoading')} ${progress.done}/${progress.total}` : t('scoresZipTitle');

  return (
    <Button
      variant="secondary"
      onClick={() => void download(entries)}
      disabled={progress !== null}
      aria-label={label}
      title={`${label} · ${entries.length} ${entries.length === 1 ? 'PDF' : 'PDFs'} · ZIP`}
      className="h-9 max-sm:w-9 max-sm:px-0"
    >
      {progress ? <Loader2 size={16} className="animate-spin" /> : <FileArchive size={16} />}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
};
