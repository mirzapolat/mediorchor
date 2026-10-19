import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { File as FileIcon, FileAudio, FileCode2, FileText, FolderUp, Loader2, RotateCw, Upload, X, XCircle, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { removePieceFiles, uploadPieceFile } from '@/lib/pieceFiles';
import { guessFileKind } from '@/lib/pieceTimeline';
import { isMuseScoreFileName } from '@/lib/mpos';
import { cn } from '@/lib/cn';
import { config } from '@/lib/config';
import { sizeBucket, track } from '@/lib/analytics';
import type { PieceFile } from '@/types';

// Pieces of a piece's file management shared by its "Dateien" page and its
// configuration (the node editor's file column).

// A file picked or dropped for upload, with the folders it sits in below the
// drop target (empty for a plain file; ["Noten", "Sopran"] for a file from a
// dropped "Noten" folder's "Sopran" subfolder).
export interface PickedFile {
  file: File;
  dirs: string[];
}

const asPicked = (files: File[]): PickedFile[] =>
  files.map((file) => ({
    file,
    // A folder chosen with the picker names each file's path in it.
    dirs: (file.webkitRelativePath || '').split('/').slice(0, -1).filter(Boolean),
  }));

// What was dropped, folders walked through. Entries must be taken while
// the drop event runs; reading them may follow later.
export const pickedFromDrop = (dataTransfer: DataTransfer): Promise<PickedFile[]> => {
  const entries = Array.from(dataTransfer.items ?? [])
    .map((item) => (item.kind === 'file' ? item.webkitGetAsEntry?.() ?? null : null))
    .filter((e): e is FileSystemEntry => e !== null);
  if (entries.length === 0) return Promise.resolve(asPicked(Array.from(dataTransfer.files)));
  const out: PickedFile[] = [];
  const walk = async (entry: FileSystemEntry, dirs: string[]): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) => (entry as FileSystemFileEntry).file(resolve, () => resolve(null)));
      // Hidden system files (.DS_Store, Thumbs.db) stay behind.
      if (file && !/^(\.|Thumbs\.db$|desktop\.ini$)/i.test(file.name)) out.push({ file, dirs });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries hands out a batch at a time until it returns none.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, [...dirs, entry.name]);
    }
  };
  return Promise.all(entries.map((e) => walk(e, []))).then(() => out);
};

interface UploadItem {
  key: string;
  name: string;
  state: 'busy' | 'error';
  progress: number;
  note?: string;
  // To try again.
  retry?: () => void;
}

const PARALLEL_UPLOADS = 3;

// Uploads files to a piece, a few at a time, each with its progress; a
// finished one is handed to `onAdded` as its new row. Files from dropped
// folders go into folders of the same names (`folderFor` finds or makes
// them). `replaceFile` puts a new version under an existing row: its name,
// folder and wherever the piece uses it stay. `uploadList` shows uploads in
// progress or failed.
export const usePieceUploads = (
  pieceId: string,
  options: {
    nextPosition: (folderId: string | null) => number;
    onAdded: (file: PieceFile) => void;
    onReplaced?: (file: PieceFile) => void;
    folderFor?: (parentId: string | null, dirs: string[]) => Promise<string | null>;
    folderId?: string | null;
  },
) => {
  const { t } = useI18n();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const { nextPosition, onAdded, onReplaced, folderFor, folderId = null } = options;

  const patch = (key: string, change: Partial<UploadItem>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)));
  const message = (error: string | null) =>
    error === 'too-large'
      ? t('fileTooLarge').replace('{max}', String(Math.round(config.maxUploadBytes / 1024 / 1024)))
      : error ?? t('uploadError');

  // One file: stored object first, then its row (the object goes again if
  // the row can't be made).
  const uploadOne = async (key: string, item: PickedFile, into: string | null, position: number) => {
    patch(key, { state: 'busy', progress: 0, note: undefined, retry: undefined });
    const fail = (error: string | null) =>
      patch(key, { state: 'error', note: message(error), retry: () => void uploadOne(key, item, into, position) });
    let folder = into;
    if (item.dirs.length && folderFor) {
      folder = await folderFor(into, item.dirs);
      if (folder === null) return fail(t('saveFailed'));
    }
    const result = await uploadPieceFile(pieceId, item.file, (progress) => patch(key, { progress }));
    if (!result.path) return fail(result.error);
    const { data, error } = await api
      .from('piece_files')
      .insert({
        piece_id: pieceId,
        kind: guessFileKind(item.file),
        title: item.file.name.replace(/\.[^.]+$/, ''),
        file_path: result.path,
        file_name: item.file.name,
        folder_id: folder,
        position,
      })
      .select('*')
      .single();
    if (error || !data) {
      void removePieceFiles([result.path]);
      return fail(error?.message ?? null);
    }
    onAdded(data as PieceFile);
    setUploads((list) => list.filter((u) => u.key !== key));
  };

  // `into`: the folder to upload into (a drop onto a folder), else `folderId`.
  const addFiles = async (picked: PickedFile[] | File[], into: string | null = folderId) => {
    const items: PickedFile[] = picked.length && picked[0] instanceof File ? asPicked(picked as File[]) : (picked as PickedFile[]);
    if (items.length === 0) return;
    // Positions are handed out first: uploads finish in any order.
    const next = new Map<string, number>();
    const queue = items.map((item) => {
      const slot = item.dirs.length ? `${into}/${item.dirs.join('/')}` : String(into);
      const position = next.get(slot) ?? (item.dirs.length ? 0 : nextPosition(into));
      next.set(slot, position + 1);
      return { key: crypto.randomUUID(), item, position };
    });
    setUploads((list) => [
      ...list,
      ...queue.map(({ key, item }) => ({ key, name: item.file.name, state: 'busy' as const, progress: 0 })),
    ]);
    track('files-upload', { count: sizeBucket(items.length), folders: items.some((i) => i.dirs.length > 0) });
    let at = 0;
    const worker = async () => {
      while (at < queue.length) {
        const { key, item, position } = queue[at++];
        await uploadOne(key, item, into, position);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, queue.length) }, worker));
  };

  const replaceFile = async (row: PieceFile, file: File) => {
    const key = crypto.randomUUID();
    setUploads((list) => [...list, { key, name: file.name, state: 'busy', progress: 0 }]);
    const run = async () => {
      patch(key, { state: 'busy', progress: 0, note: undefined, retry: undefined });
      const fail = (error: string | null) => patch(key, { state: 'error', note: message(error), retry: () => void run() });
      const result = await uploadPieceFile(pieceId, file, (progress) => patch(key, { progress }));
      if (!result.path) return fail(result.error);
      const ext = /\.[a-z0-9]{1,8}$/i.exec(file.name)?.[0] ?? '';
      const base = row.title.trim() || file.name.replace(/\.[^.]+$/, '');
      const { data, error } = await api
        .from('piece_files')
        .update({ file_path: result.path, file_name: base + ext })
        .eq('id', row.id)
        .select('*')
        .single();
      if (error || !data) {
        void removePieceFiles([result.path]);
        return fail(error?.message ?? null);
      }
      // The old version, and a score's preview image made from it.
      void removePieceFiles([row.file_path, `${pieceId}/preview-${row.id}.jpg`].filter((p): p is string => Boolean(p)));
      onReplaced?.(data as PieceFile);
      track('file-replace');
      setUploads((list) => list.filter((u) => u.key !== key));
    };
    await run();
  };

  const uploadList =
    uploads.length > 0 ? (
      <ul className="space-y-1 rounded-xl border border-border bg-surface p-2">
        {uploads.map((u) => (
          <li key={u.key} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm">
            {u.state === 'busy' ? (
              <Loader2 size={15} className="flex-shrink-0 animate-spin text-text-tertiary" />
            ) : (
              <XCircle size={15} className="flex-shrink-0 text-danger" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate">{u.name}</span>
                {u.state === 'busy' && (
                  <span className="flex-shrink-0 text-xs tabular-nums text-text-tertiary">{Math.round(u.progress * 100)} %</span>
                )}
              </div>
              {u.state === 'busy' ? (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-muted">
                  <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${u.progress * 100}%` }} />
                </div>
              ) : (
                <p className="text-xs text-danger">{u.note}</p>
              )}
            </div>
            {u.state === 'error' && (
              <>
                {u.retry && (
                  <button
                    type="button"
                    onClick={u.retry}
                    aria-label={t('retry')}
                    title={t('retry')}
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text"
                  >
                    <RotateCw size={14} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                  aria-label={t('close')}
                  title={t('close')}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text"
                >
                  <X size={14} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    ) : null;

  return { addFiles, replaceFile, uploadList };
};

// Drop target for many files (or whole folders) at once; a click opens the
// file picker, the link below it the folder picker.
export const MultiDropzone = ({ onPicked, compact = false }: { onPicked: (files: PickedFile[]) => void; compact?: boolean }) => {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1.5">
      <label
        onDragOver={(e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          void pickedFromDrop(e.dataTransfer).then(onPicked);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 text-center transition-colors duration-150 focus-within:border-black',
          compact ? 'py-5' : 'py-8',
          dragging ? 'border-black bg-surface-muted' : 'border-border bg-surface-subtle hover:border-text-tertiary',
        )}
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-hover text-text-secondary">
          <Upload size={18} />
        </span>
        <span className="text-sm font-medium">{dragging ? t('dropzoneRelease') : t('pieceDropTitle')}</span>
        {!compact && <span className="max-w-sm text-xs text-text-secondary">{t('pieceDropHint')}</span>}
        <input
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => {
            onPicked(asPicked(Array.from(e.target.files ?? [])));
            e.target.value = '';
          }}
        />
      </label>
      <button
        type="button"
        onClick={() => folderInput.current?.click()}
        className="inline-flex items-center gap-1.5 rounded px-1 text-xs font-medium text-text-secondary hover:text-text"
      >
        <FolderUp size={14} />
        {t('uploadFolder')}
      </button>
      <input
        ref={folderInput}
        type="file"
        multiple
        className="sr-only"
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => {
          onPicked(asPicked(Array.from(e.target.files ?? [])));
          e.target.value = '';
        }}
      />
    </div>
  );
};

// What a file is, at a glance: score PDF, recording, notation (MusicXML,
// MuseScore, its bar timing, MIDI) or anything else.
export const fileIcon = (f: PieceFile): LucideIcon => {
  const name = f.file_name ?? '';
  if (/\.pdf$/i.test(name) || f.kind === 'score') return FileText;
  if (f.kind === 'audio') return FileAudio;
  if (f.kind === 'notation' || f.kind === 'midi' || isMuseScoreFileName(name)) return FileCode2;
  return FileIcon;
};

// A file's one name, editable without its ending (".pdf" stays). Renaming
// changes both the shown name and the stored file name (used for downloads).
// `beforeEnding` sits between the name and its ending (the download switch).
export const FileName = ({
  file,
  onRename,
  beforeEnding,
}: {
  file: PieceFile;
  onRename: (patch: Partial<PieceFile>) => void;
  beforeEnding?: ReactNode;
}) => {
  const { t } = useI18n();
  const stored = file.file_name ?? '';
  const ext = /\.[a-z0-9]{1,8}$/i.exec(stored)?.[0] ?? '';
  const name = file.title.trim() || stored.slice(0, stored.length - ext.length);
  const Icon = fileIcon(file);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-1">
      <Icon size={18} className="flex-shrink-0 text-text-secondary" aria-hidden />
      <input
        key={name}
        defaultValue={name}
        aria-label={t('displayName')}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (!v) {
            e.target.value = name;
            return;
          }
          if (v !== name || v + ext !== stored) onRename({ title: v, file_name: v + ext });
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="h-9 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-base font-medium hover:border-border focus:border-black focus:outline-none sm:text-sm"
      />
      {beforeEnding}
      {ext && <span className="w-12 flex-shrink-0 text-sm text-text-tertiary">{ext}</span>}
    </div>
  );
};
