import { useState, type DragEvent, type ReactNode } from 'react';
import { File as FileIcon, FileAudio, FileCode2, FileText, Loader2, Upload, XCircle, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { uploadPieceFile } from '@/lib/pieceFiles';
import { guessFileKind } from '@/lib/pieceTimeline';
import { isMuseScoreFileName } from '@/lib/mpos';
import { cn } from '@/lib/cn';
import type { PieceFile } from '@/types';

// Pieces of a piece's file management shared by its "Dateien" page and its
// configuration (the node editor's file column).

interface UploadItem {
  key: string;
  name: string;
  state: 'busy' | 'error';
  note?: string;
}

// Uploads files to a piece one after another; each finished one is handed
// to `onAdded` as its new row. `uploadList` shows those in progress or failed.
export const usePieceUploads = (
  pieceId: string,
  nextPosition: () => number,
  onAdded: (file: PieceFile) => void,
  folderId: string | null = null,
) => {
  const { t } = useI18n();
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  // `into`: the folder to upload into (a drop onto a folder), else `folderId`.
  const addFiles = async (picked: File[], into: string | null = folderId) => {
    let position = nextPosition();
    for (const file of picked) {
      // Only uploads in progress or failed are listed; a finished one joins
      // the uploaded files.
      const key = crypto.randomUUID();
      const fail = (note: string) =>
        setUploads((list) => list.map((u) => (u.key === key ? { ...u, state: 'error', note } : u)));
      setUploads((list) => [...list, { key, name: file.name, state: 'busy' }]);

      const result = await uploadPieceFile(pieceId, file);
      if (!result.path) {
        fail(result.error ?? t('uploadError'));
        continue;
      }
      const { data, error } = await api
        .from('piece_files')
        .insert({
          piece_id: pieceId,
          kind: guessFileKind(file),
          title: file.name.replace(/\.[^.]+$/, ''),
          file_path: result.path,
          file_name: file.name,
          folder_id: into,
          position: position++,
        })
        .select('*')
        .single();
      if (error || !data) {
        fail(error?.message ?? t('uploadError'));
        continue;
      }
      onAdded(data as PieceFile);
      setUploads((list) => list.filter((u) => u.key !== key));
    }
  };

  const uploadList =
    uploads.length > 0 ? (
      <ul className="space-y-1.5">
        {uploads.map((u) => (
          <li key={u.key} className="flex items-center gap-2 text-sm">
            {u.state === 'busy' ? (
              <Loader2 size={15} className="flex-shrink-0 animate-spin text-text-tertiary" />
            ) : (
              <XCircle size={15} className="flex-shrink-0 text-danger" />
            )}
            <span className="min-w-0 flex-1 truncate">{u.name}</span>
            {u.note && <span className="flex-shrink-0 text-xs text-danger">{u.note}</span>}
          </li>
        ))}
      </ul>
    ) : null;

  return { addFiles, uploadList };
};

// Drop target for many files at once (click opens the picker).
export const MultiDropzone = ({ onFiles, compact = false }: { onFiles: (files: File[]) => void; compact?: boolean }) => {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  return (
    <label
      onDragOver={(e: DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 text-center transition-colors duration-150 focus-within:border-black',
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
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </label>
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
