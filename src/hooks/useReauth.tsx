import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { SecondFactorForm } from '@/components/SecondFactorForm';
import { useI18n } from '@/lib/i18n';
import { api, type ApiError, type MfaChallenge } from '@/lib/api';

// Sensitive changes (sign-in methods, password, email, deleting the account)
// fail with reauth_required unless the session proved its user recently.
// run() then asks for a second factor (or the password) and retries once.
// Render `modal` somewhere in the component. A cancelled confirmation ends
// with the error code reauth_cancelled, which callers need not show.
export const useReauth = () => {
  const { t } = useI18n();
  const [pending, setPending] = useState<{ challenge: MfaChallenge; resolve: (ok: boolean) => void } | null>(null);

  const run = async <T extends { error: ApiError | null }>(action: () => Promise<T>): Promise<T> => {
    const first = await action();
    if (first.error?.code !== 'reauth_required') return first;
    const { data, error } = await api.auth.startReauth();
    if (error || !data) return { ...first, error: error ?? first.error };
    const confirmed = await new Promise<boolean>((resolve) => setPending({ challenge: data, resolve }));
    setPending(null);
    if (!confirmed) return { ...first, error: { message: '', code: 'reauth_cancelled' } };
    return action();
  };

  const modal = pending ? (
    <Modal open title={t('reauthTitle')} onClose={() => pending.resolve(false)}>
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">{t('reauthHint')}</p>
        <SecondFactorForm
          challenge={pending.challenge}
          submitLabel={t('confirm')}
          onSubmit={async (proof) => {
            const { error } = await api.auth.reauth(pending.challenge.challenge_id, proof);
            if (!error) pending.resolve(true);
            return error;
          }}
        />
      </div>
    </Modal>
  ) : null;

  return { run, modal };
};
