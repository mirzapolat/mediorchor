import { supabase } from './supabase';

const BUCKET = 'piece-files';

// Uploads an attachment to the public "piece-files" bucket. Like uploadImage,
// the object key is a fresh UUID + sanitised extension because raw file names
// (spaces, umlauts, …) make Supabase storage uploads fail silently.
export const uploadPieceFile = async (
  pieceId: string,
  file: File,
): Promise<{ path: string | null; error: string | null }> => {
  const rawExt = file.name.includes('.') ? file.name.split('.').pop() ?? '' : '';
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const path = `${pieceId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type || undefined,
  });
  if (error) return { path: null, error: error.message };
  return { path, error: null };
};

export const pieceFileUrl = (path: string): string =>
  supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

// Public URL that forces a download under the original file name.
export const pieceFileDownloadUrl = (path: string, fileName: string): string =>
  supabase.storage.from(BUCKET).getPublicUrl(path, { download: fileName }).data.publicUrl;

export const removePieceFiles = async (paths: string[]): Promise<void> => {
  if (paths.length === 0) return;
  await supabase.storage.from(BUCKET).remove(paths);
};
