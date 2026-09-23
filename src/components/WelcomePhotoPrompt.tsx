import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera } from 'lucide-react';
import { Overlay } from './Overlay';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useProfilePhoto } from '@/hooks/useProfilePhoto';

// Offers a new account to add a profile photo, once, on its first sign-in.
export const WelcomePhotoPrompt = () => {
  const { t } = useI18n();
  const { user, refreshUser } = useAuth();
  const photo = useProfilePhoto();
  const [dismissed, setDismissed] = useState(false);

  if (!user || user.photo_prompted_at || dismissed) return null;

  const done = async () => {
    setDismissed(true);
    await api.from('app_users').update({ photo_prompted_at: new Date().toISOString() }).eq('id', user.id);
    await refreshUser();
  };

  const name = user.name || user.email;
  const picker = (
    <input
      type="file"
      accept="image/*"
      className="hidden"
      disabled={photo.busy}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) photo.choose(file);
      }}
    />
  );

  return createPortal(
    <>
      <Overlay>
        <div
          role="dialog"
          aria-modal="true"
          className="mx-4 w-full max-w-sm rounded-md border border-border bg-white p-8 text-center animate-[fadein_200ms_ease-in-out]"
        >
          <label className="group relative mx-auto block h-28 w-28 cursor-pointer">
            <Avatar name={name} photoUrl={user.photo_url} size={112} />
            <span className="absolute bottom-0.5 right-0.5 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-black text-white transition-transform duration-150 group-hover:scale-105">
              <Camera size={16} />
            </span>
            {picker}
          </label>
          <h2 className="mt-5 text-xl font-semibold">
            {t('welcomePhotoTitle').replace('{name}', user.name.split(' ')[0] || name)}
          </h2>
          <p className="mt-2 text-sm text-text-secondary">
            {user.photo_url ? t('welcomePhotoDone') : t('welcomePhotoHint')}
          </p>
          {photo.error && <p className="mt-2 text-sm text-accent">{photo.error}</p>}
          <div className="mt-6 flex flex-col gap-2">
            {user.photo_url ? (
              <Button onClick={() => void done()}>{t('onboardingContinue')}</Button>
            ) : (
              <>
                <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-black-hover">
                  <Camera size={16} />
                  {photo.busy ? t('loading') : t('welcomePhotoChoose')}
                  {picker}
                </label>
                <Button variant="secondary" onClick={() => void done()} disabled={photo.busy}>
                  {t('welcomePhotoLater')}
                </Button>
              </>
            )}
          </div>
        </div>
      </Overlay>
      {photo.cropper}
    </>,
    document.body,
  );
};
