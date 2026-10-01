import { api } from './api';
import type { Piece, PieceFile, PieceFileKind } from '@/types';

const BUCKET = 'piece-files';

// Uploads an attachment to the public "piece-files" bucket. Like uploadImage,
// the object key is a fresh UUID + sanitised extension; raw file names (spaces,
// umlauts, …) are never used as storage keys.
export const uploadPieceFile = async (
  pieceId: string,
  file: File,
): Promise<{ path: string | null; error: string | null }> => {
  const rawExt = file.name.includes('.') ? file.name.split('.').pop() ?? '' : '';
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const path = `${pieceId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await api.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type || undefined,
  });
  if (error) return { path: null, error: error.message };
  return { path, error: null };
};

export const pieceFileUrl = (path: string): string =>
  api.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

// Public URL that forces a download under the original file name.
export const pieceFileDownloadUrl = (path: string, fileName: string): string =>
  api.storage.from(BUCKET).getPublicUrl(path, { download: fileName }).data.publicUrl;

// Download name of a piece file, independent of what the uploader called it:
// "Piece – Composer – Title.ext" (empty parts left out), keeping the stored
// file's extension. Characters file systems reject are replaced.
export const pieceDownloadName = (
  piece: Pick<Piece, 'name' | 'composer'>,
  title: string,
  storedName: string,
): string => {
  const ext = /\.[a-z0-9]{1,8}$/i.exec(storedName)?.[0].toLowerCase() ?? '';
  const base = [piece.name, piece.composer, title]
    .map((part) => part.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' – ');
  return (base || 'Download') + ext;
};

export const removePieceFiles = async (paths: string[]): Promise<void> => {
  if (paths.length === 0) return;
  await api.storage.from(BUCKET).remove(paths);
};

export const loadPieceFiles = async (pieceId: string): Promise<PieceFile[]> => {
  const { data } = await api
    .from('piece_files')
    .select('*')
    .eq('piece_id', pieceId)
    .order('position')
    .order('created_at');
  return (data as PieceFile[] | null) ?? [];
};

// Stored objects of a file row: the file and a track's recording with click.
const storedPaths = (file: Pick<PieceFile, 'file_path' | 'click_file_path'>): string[] =>
  [file.file_path, file.click_file_path].filter((p): p is string => !!p);

// Deletes a file row together with its stored objects.
export const deletePieceFile = async (file: PieceFile): Promise<void> => {
  await api.from('piece_files').delete().eq('id', file.id);
  void removePieceFiles(storedPaths(file));
};

// Writes the list order into `position` for rows whose position changed.
export const persistOrder = async (
  table: 'pieces' | 'piece_files',
  rows: Array<{ id: string; position: number }>,
): Promise<void> => {
  await Promise.all(
    rows.map((row, index) =>
      row.position === index ? null : api.from(table).update({ position: index }).eq('id', row.id),
    ),
  );
};

// Deletes a piece; its file rows cascade, the stored objects are removed here.
export const deletePiece = async (pieceId: string): Promise<void> => {
  const files = await loadPieceFiles(pieceId);
  await api.from('pieces').delete().eq('id', pieceId);
  void removePieceFiles(files.flatMap(storedPaths));
};

// The loaders below are shared by the pages and the offline download, so the
// download asks exactly the same questions the pages ask later (offline
// answers are looked up by the exact request).

export const loadPiece = async (pieceId: string): Promise<Piece | null> => {
  const { data } = await api.from('pieces').select('*').eq('id', pieceId).maybeSingle();
  return (data as Piece | null) ?? null;
};

export interface PieceOverviewFile {
  piece_id: string;
  kind: PieceFileKind;
  title: string;
  file_name: string | null;
  file_path: string | null;
}

// A project's pieces in order, plus the file rows the list summarises.
export const loadPiecesOverview = async (
  projectId: string,
): Promise<{ pieces: Piece[]; files: PieceOverviewFile[] }> => {
  const [pieceResult, fileResult] = await Promise.all([
    api.from('pieces').select('*').eq('project_id', projectId).order('position').order('created_at'),
    api
      .from('piece_files')
      .select('piece_id, kind, title, file_name, file_path, position, pieces!inner(project_id)')
      .eq('pieces.project_id', projectId)
      .order('position'),
  ]);
  return {
    pieces: (pieceResult.data as Piece[] | null) ?? [],
    files: (fileResult.data as PieceOverviewFile[] | null) ?? [],
  };
};
