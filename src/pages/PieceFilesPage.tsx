import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Download, ExternalLink, Folder, FolderPlus, GripVertical, Link as LinkIcon, Trash2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { Switch } from '@/components/Switch';
import { FileName, MultiDropzone, fileIcon, usePieceUploads } from '@/components/PieceFileParts';
import { Credits, FileList } from '@/components/PieceDownloads';
import { useDragReorder } from '@/hooks/useDragReorder';
import { usePieceLayout } from '@/layouts/PieceLayout';
import { usePieceScope } from '@/layouts/pieceScope';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import {
  deletePieceFile,
  isFileDownloadable,
  loadPieceCredits,
  loadPieceFiles,
  loadPieceTracks,
  pieceDownloadName,
  pieceFileDownloadUrl,
  TRACK_RECORDING_FIELDS,
} from '@/lib/pieceFiles';
import type { Piece, PieceCredit, PieceFile, PieceFileFolder, PieceTrack } from '@/types';

// One row of the editors' list: files without a folder first, then each
// folder's header followed by its files — one list, so a file is dragged
// into another folder like anywhere else.
type Row = { kind: 'file'; id: string; file: PieceFile } | { kind: 'folder'; id: string; folder: PieceFileFolder };

const rowsOf = (files: PieceFile[], folders: PieceFileFolder[]): Row[] => {
  const fileRows = (folderId: string | null): Row[] =>
    files.filter((f) => (f.folder_id ?? null) === folderId).map((f) => ({ kind: 'file', id: f.id, file: f }));
  // Files whose folder is gone count as without one.
  const known = new Set(folders.map((d) => d.id));
  return [
    ...files
      .filter((f) => !f.folder_id || !known.has(f.folder_id))
      .map((f): Row => ({ kind: 'file', id: f.id, file: f })),
    ...folders.flatMap((d): Row[] => [{ kind: 'folder', id: d.id, folder: d }, ...fileRows(d.id)]),
  ];
};

const downloadHref = (piece: Piece, f: PieceFile) =>
  f.file_path
    ? pieceFileDownloadUrl(f.file_path, pieceDownloadName(piece, f.title.trim(), f.file_name ?? f.file_path))
    : '#';

const sortFiles = (list: PieceFile[]) => [...list].sort((a, b) => a.position - b.position);

// A piece's "Dateien" page. Everyone downloads what is switched to
// downloadable (grouped into the editors' folders, or by kind while there
// are none). Its editors upload and remove files, rename them, switch their
// download, group them into folders and order files and folders by dragging.
// Links are kept in the configuration.
export const PieceFilesPage = () => {
  const { t } = useI18n();
  const { canEdit } = usePieceScope();
  const { piece } = usePieceLayout();
  const [files, setFiles] = useState<PieceFile[]>([]);
  const [folders, setFolders] = useState<PieceFileFolder[]>([]);
  const [voices, setVoices] = useState<PieceTrack[]>([]);
  const [credits, setCredits] = useState<PieceCredit[]>([]);
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState<PieceFile | null>(null);

  const load = useCallback(async () => {
    const [pieceFiles, pieceTracks, pieceCredits, { data: folderRows }] = await Promise.all([
      loadPieceFiles(piece.id),
      loadPieceTracks(piece.id),
      loadPieceCredits(piece.id),
      api.from('piece_file_folders').select('*').eq('piece_id', piece.id).order('position').order('created_at'),
    ]);
    setFiles(pieceFiles);
    setVoices(pieceTracks);
    setCredits(pieceCredits.filter((c) => c.name.trim()));
    setFolders((folderRows as PieceFileFolder[] | null) ?? []);
    setLoading(false);
  }, [piece.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const { addFiles, uploadList } = usePieceUploads(
    piece.id,
    () => files.length,
    (row) => setFiles((list) => [...list, row]),
  );

  const uploaded = files.filter((f) => f.kind !== 'link');
  const links = files.filter((f) => f.kind === 'link' && f.downloadable);
  const rows = rowsOf(uploaded, folders);

  // Writes a new order: positions of files and folders, and each file's
  // folder, only where they changed.
  const commit = (next: Row[]) => {
    let folderId: string | null = null;
    const nextFiles: PieceFile[] = [];
    const nextFolders: PieceFileFolder[] = [];
    for (const row of next) {
      if (row.kind === 'folder') {
        folderId = row.folder.id;
        nextFolders.push({ ...row.folder, position: nextFolders.length });
      } else {
        nextFiles.push({ ...row.file, folder_id: folderId, position: nextFiles.length });
      }
    }
    const before = new Map(uploaded.map((f) => [f.id, f]));
    const beforeFolders = new Map(folders.map((d) => [d.id, d]));
    setFiles([...nextFiles, ...files.filter((f) => f.kind === 'link')]);
    setFolders(nextFolders);
    for (const f of nextFiles) {
      const old = before.get(f.id);
      if (old && (old.position !== f.position || (old.folder_id ?? null) !== f.folder_id)) {
        void api.from('piece_files').update({ position: f.position, folder_id: f.folder_id }).eq('id', f.id).then(() => undefined);
      }
    }
    for (const d of nextFolders) {
      if (beforeFolders.get(d.id)?.position !== d.position) {
        void api.from('piece_file_folders').update({ position: d.position }).eq('id', d.id).then(() => undefined);
      }
    }
  };

  // A dragged file lands in the folder above it; a dragged folder moves with
  // its files (it lands before the folder it was dropped on).
  const dragged = useRef<Row | null>(null);
  const reorder = (next: Row[]) => {
    const moved = dragged.current;
    if (moved?.kind === 'folder') {
      const order = next.filter((r): r is Extract<Row, { kind: 'folder' }> => r.kind === 'folder').map((r) => r.folder);
      commit(rowsOf(uploaded, order));
    } else {
      commit(next);
    }
  };
  const dnd = useDragReorder(rows, (r) => r.id, reorder, 0);
  const startDrag = (e: PointerEvent, row: Row, index: number) => {
    dragged.current = row;
    dnd.startDrag(e, row.id, index);
  };

  const addFolder = async () => {
    const { data } = await api
      .from('piece_file_folders')
      .insert({ piece_id: piece.id, name: t('newFolderName'), position: folders.length })
      .select('*')
      .single();
    if (data) setFolders((list) => [...list, data as PieceFileFolder]);
  };
  const renameFolder = (folder: PieceFileFolder, name: string) => {
    setFolders((list) => list.map((d) => (d.id === folder.id ? { ...d, name } : d)));
    void api.from('piece_file_folders').update({ name }).eq('id', folder.id).then(() => undefined);
  };
  // Its files stay, above the folders.
  const removeFolder = (folder: PieceFileFolder) => {
    setFolders((list) => list.filter((d) => d.id !== folder.id));
    setFiles((list) => list.map((f) => (f.folder_id === folder.id ? { ...f, folder_id: null } : f)));
    void api.from('piece_file_folders').delete().eq('id', folder.id).then(() => undefined);
  };
  const updateFile = (file: PieceFile, patch: Partial<PieceFile>) => {
    setFiles((list) => list.map((f) => (f.id === file.id ? { ...f, ...patch } : f)));
    void api.from('piece_files').update(patch).eq('id', file.id).then(() => undefined);
  };

  if (loading) return <PageSpinner />;

  const grip = (row: Row, index: number) => (
    <button
      type="button"
      aria-label={t('reorder')}
      onPointerDown={(e) => startDrag(e, row, index)}
      onPointerMove={dnd.moveDrag}
      onPointerUp={dnd.endDrag}
      onPointerCancel={dnd.endDrag}
      style={{ touchAction: 'none' }}
      className="flex w-8 flex-shrink-0 cursor-grab items-center justify-center self-stretch text-text-tertiary hover:text-text-secondary active:cursor-grabbing"
    >
      <GripVertical size={16} />
    </button>
  );

  const editorList = (
    <ul className="overflow-hidden rounded-md border border-border bg-surface">
      {rows.map((row, index) => {
        const style = dnd.dragActive
          ? {
              transform: `translateY(${dnd.shiftFor(index)}px)`,
              transition: dnd.isDragging(row.id) ? 'none' : 'transform 150ms ease',
              position: 'relative' as const,
              zIndex: dnd.isDragging(row.id) ? 20 : undefined,
            }
          : undefined;
        if (row.kind === 'folder') {
          return (
            <li
              key={row.id}
              ref={(el) => dnd.setItemRef(row.id, el)}
              style={style}
              className={cn(
                'flex items-center gap-1 border-b border-border bg-surface-muted pr-1 last:border-b-0',
                dnd.isDragging(row.id) && 'shadow-lg ring-1 ring-border',
              )}
            >
              {grip(row, index)}
              <Folder size={17} className="flex-shrink-0 text-text-secondary" aria-hidden />
              <input
                key={row.folder.name}
                defaultValue={row.folder.name}
                aria-label={t('folderName')}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (!v) e.target.value = row.folder.name;
                  else if (v !== row.folder.name) renameFolder(row.folder, v);
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                className="h-11 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-base font-semibold hover:border-border focus:border-black focus:outline-none sm:text-sm"
              />
              <button
                type="button"
                onClick={() => removeFolder(row.folder)}
                aria-label={t('removeFolder')}
                title={t('removeFolderHint')}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
              >
                <Trash2 size={15} />
              </button>
            </li>
          );
        }
        const f = row.file;
        // A recording a voice uses is downloadable with its voice
        // (switched in the configuration).
        const voiceFile = voices.some((v) => TRACK_RECORDING_FIELDS.some((field) => v[field] === f.id));
        return (
          <li
            key={row.id}
            ref={(el) => dnd.setItemRef(row.id, el)}
            style={style}
            className={cn(
              'flex items-center border-b border-border bg-surface pr-1 last:border-b-0',
              f.folder_id && folders.some((d) => d.id === f.folder_id) && 'pl-4',
              dnd.isDragging(row.id) && 'shadow-lg ring-1 ring-border',
            )}
          >
            {grip(row, index)}
            <div className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5">
              <FileName
                file={f}
                onRename={(patch) => updateFile(f, patch)}
                beforeEnding={
                  voiceFile ? (
                    <span className="hidden flex-shrink-0 text-xs text-text-tertiary sm:inline" title={t('downloadFollowsVoiceHint')}>
                      {t('downloadFollowsVoice')}
                    </span>
                  ) : (
                    <Switch
                      checked={f.downloadable}
                      onChange={(downloadable) => updateFile(f, { downloadable })}
                      label={t('downloadSwitch')}
                      title={t('downloadSwitchHint')}
                      icon={Download}
                    />
                  )
                }
              />
              {f.file_path && (
                <a
                  href={downloadHref(piece, f)}
                  aria-label={t('downloadFile')}
                  title={t('downloadFile')}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
                >
                  <Download size={15} />
                </a>
              )}
              <button
                type="button"
                onClick={() => setToDelete(f)}
                aria-label={t('deleteFile')}
                title={t('deleteFile')}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-danger"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );

  // What members see once there are folders: the downloadable files in the
  // editors' order and folders (empty ones left out).
  const visible = sortFiles(uploaded.filter((f) => f.file_path && isFileDownloadable(f, voices)));
  const downloadRow = (f: PieceFile) => {
    const Icon = fileIcon(f);
    return (
      <li key={f.id}>
        <a
          href={downloadHref(piece, f)}
          onClick={() => track('file-download', { kind: f.kind })}
          className="flex min-h-[3rem] w-full items-center gap-3 px-3 py-2 text-sm transition-colors duration-150 hover:bg-surface-subtle"
        >
          <Icon size={16} className="flex-shrink-0 text-text-secondary" />
          <span className="min-w-0 flex-1 truncate font-medium">{f.title.trim() || f.file_name}</span>
          <Download size={15} className="flex-shrink-0 text-text-tertiary" />
        </a>
      </li>
    );
  };
  const groupList = (title: string | null, list: PieceFile[], key: string) =>
    list.length === 0 ? null : (
      <div key={key}>
        {title && (
          <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
            <Folder size={13} aria-hidden />
            {title}
          </h3>
        )}
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
          {list.map(downloadRow)}
        </ul>
      </div>
    );
  const known = new Set(folders.map((d) => d.id));
  const memberList =
    folders.length === 0 ? (
      <FileList piece={piece} files={files} voices={voices} />
    ) : visible.length === 0 && links.length === 0 ? (
      <p className="text-sm text-text-secondary">{t('noFiles')}</p>
    ) : (
      <div className="space-y-4">
        {groupList(null, visible.filter((f) => !f.folder_id || !known.has(f.folder_id)), 'none')}
        {folders.map((d) => groupList(d.name, visible.filter((f) => f.folder_id === d.id), d.id))}
        {links.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('fileKindLink')}</h3>
            <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
              {links.map((l) => (
                <li key={l.id}>
                  <a
                    href={/^https?:\/\//i.test(l.url ?? '') ? (l.url as string) : '#'}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex min-h-[3rem] w-full items-center gap-3 px-3 py-2 text-sm transition-colors duration-150 hover:bg-surface-subtle"
                  >
                    <LinkIcon size={16} className="flex-shrink-0 text-text-secondary" />
                    <span className="min-w-0 flex-1 truncate font-medium">{l.title.trim() || l.url}</span>
                    <ExternalLink size={15} className="flex-shrink-0 text-text-tertiary" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold sm:text-2xl">{t('files')}</h1>
        {canEdit && (
          <Button variant="secondary" onClick={() => void addFolder()}>
            <FolderPlus size={15} />
            {t('newFolder')}
          </Button>
        )}
      </div>

      {credits.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">{t('credits')}</h2>
          <Credits credits={credits} />
        </section>
      )}

      {canEdit ? (
        <section className="space-y-3">
          <MultiDropzone compact onFiles={(picked) => void addFiles(picked)} />
          {uploadList}
          {rows.length === 0 ? <p className="text-sm text-text-secondary">{t('noFiles')}</p> : editorList}
          <p className="text-xs text-text-secondary">{t('filesEditorHint')}</p>
        </section>
      ) : (
        memberList
      )}

      <ConfirmDialog
        open={toDelete != null}
        title={t('deleteFile')}
        message={t('confirmDeleteFile')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={async () => {
          const file = toDelete;
          setToDelete(null);
          if (!file) return;
          setFiles((list) => list.filter((f) => f.id !== file.id));
          await deletePieceFile(file);
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
};
