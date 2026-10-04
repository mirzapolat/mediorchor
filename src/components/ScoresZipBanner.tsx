import { useState } from 'react';
import { FileArchive, FolderArchive } from 'lucide-react';
import { ActionCard } from './ActionCard';
import { useI18n } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import { pieceFileUrl, type PieceOverviewFile } from '@/lib/pieceFiles';
import { createZip, safeFileName } from '@/lib/zip';
import type { Piece } from '@/types';

const isPdf = (f: PieceOverviewFile) =>
  Boolean(f.file_path) && (f.kind === 'score' || /\.pdf$/i.test(f.file_name ?? ''));
const isMidi = (f: PieceOverviewFile) =>
  Boolean(f.file_path) && (f.kind === 'midi' || /\.midi?$/i.test(f.file_name ?? ''));
const isMusicXml = (f: PieceOverviewFile) =>
  Boolean(f.file_path) && (f.kind === 'notation' || /\.(musicxml|mxl|xml)$/i.test(f.file_name ?? ''));

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

// One click: every score PDF of every piece as one ZIP.
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
  const { progress, error, missing, download } = useZipDownload(
    `${projectName} – ${t('scoresZipName')}`,
    'scores-zip',
  );

  const entries = entriesFor(pieces, files, isPdf, '.pdf');
  const pieceCount = new Set(files.filter(isPdf).map((f) => f.piece_id)).size;
  if (entries.length === 0) return null;

  return (
    <ActionCard
      icon={FileArchive}
      title={t('scoresZipTitle')}
      busy={progress !== null}
      onClick={() => void download(entries)}
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

// Scores, MIDIs and MusicXML of every piece as one ZIP, one folder per kind
// ("Noten/", "MIDI/", "MusicXML/"). Only shown when there is more than PDFs.
export const AllFilesZipBanner = ({
  projectName,
  pieces,
  files,
}: {
  projectName: string;
  pieces: Piece[];
  files: PieceOverviewFile[];
}) => {
  const { t } = useI18n();
  const { progress, error, missing, download } = useZipDownload(
    `${projectName} – ${t('allFilesZipName')}`,
    'all-files-zip',
  );

  const pdfs = entriesFor(pieces, files, isPdf, '.pdf', `${safeFileName(t('scoresZipName'))}/`);
  // A PDF is never also counted as MIDI/MusicXML, a MIDI never as MusicXML.
  const midis = entriesFor(pieces, files, (f) => !isPdf(f) && isMidi(f), '.mid', 'MIDI/');
  const xmls = entriesFor(
    pieces,
    files,
    (f) => !isPdf(f) && !isMidi(f) && isMusicXml(f),
    '.musicxml',
    'MusicXML/',
  );
  if (midis.length === 0 && xmls.length === 0) return null;
  const entries = [...pdfs, ...midis, ...xmls];

  const counts = [
    pdfs.length ? `${pdfs.length} PDF` : null,
    midis.length ? `${midis.length} MIDI` : null,
    xmls.length ? `${xmls.length} MusicXML` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ActionCard
      icon={FolderArchive}
      title={t('allFilesZipTitle')}
      busy={progress !== null}
      onClick={() => void download(entries)}
      statusTone={error || missing ? 'danger' : 'muted'}
      status={
        error
          ? t('scoresZipError')
          : missing && !progress
            ? t('allFilesZipMissing').replace('{n}', String(missing))
            : progress
              ? `${t('scoresZipLoading')} ${progress.done}/${progress.total}`
              : `${counts} · ZIP`
      }
    />
  );
};
