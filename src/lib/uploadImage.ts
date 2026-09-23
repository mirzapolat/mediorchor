import { api } from './api';

// Uploads an image to the public "photos" bucket and returns its public URL.
//
// The storage object key is built from a fresh UUID + a sanitised file
// extension — never the raw file name, which often contains spaces, umlauts or
// other characters that make unsafe or ambiguous storage keys.
export const uploadImage = async (
  folder: string,
  file: File,
): Promise<{ url: string | null; error: string | null }> => {
  const rawExt = file.name.includes('.') ? file.name.split('.').pop() ?? '' : '';
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;

  const { error } = await api.storage.from('photos').upload(path, file, {
    upsert: true,
    cacheControl: '3600',
    contentType: file.type || undefined,
  });
  if (error) return { url: null, error: error.message };

  const { data } = api.storage.from('photos').getPublicUrl(path);
  return { url: data.publicUrl, error: null };
};
