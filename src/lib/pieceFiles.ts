import { api } from './api';
import type { PieceFile } from '@/types';

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

// Deletes a file row together with its stored object.
export const deletePieceFile = async (file: PieceFile): Promise<void> => {
  await api.from('piece_files').delete().eq('id', file.id);
  if (file.file_path) void removePieceFiles([file.file_path]);
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
  void removePieceFiles(files.map((f) => f.file_path).filter((p): p is string => !!p));
};
