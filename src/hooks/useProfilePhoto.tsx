import { useState } from 'react';
import { PhotoCropper } from '@/components/PhotoCropper';
import { api } from '@/lib/api';
import { uploadImage } from '@/lib/uploadImage';
import { useAuth } from './useAuth';

// Changing the signed-in account's profile photo: a picked image is cropped
// first, then uploaded and saved right away (the server mirrors it onto every
// linked member row). Render `cropper` somewhere in the component.
export const useProfilePhoto = () => {
  const { user, refreshUser } = useAuth();
  const [picked, setPicked] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (url: string | null) => {
    if (!user) return;
    const { error: saveError } = await api.from('app_users').update({ photo_url: url }).eq('id', user.id);
    if (saveError) setError(saveError.message);
    await refreshUser();
  };

  const upload = async (file: File) => {
    if (!user) return;
    setPicked(null);
    setBusy(true);
    setError(null);
    const { url, error: uploadError } = await uploadImage(`users/${user.id}`, file);
    if (uploadError) setError(uploadError);
    else await save(url);
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    await save(null);
    setBusy(false);
  };

  // Opens the cropper for a picked file.
  const choose = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setError(null);
    setPicked(file);
  };

  const cropper = <PhotoCropper file={picked} onCancel={() => setPicked(null)} onConfirm={(f) => void upload(f)} />;

  return { busy, error, choose, remove, cropper };
};
