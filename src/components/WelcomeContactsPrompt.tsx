import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Contact, MoreHorizontal } from 'lucide-react';
import { Overlay } from './Overlay';
import { Button } from './Button';
import { ContactDialog, ContactRow, loadContacts } from './AccountContacts';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { useAuth } from '@/hooks/useAuth';
import { CONTACT_INFO, contactKindLabel } from '@/lib/contacts';
import type { ContactKind } from '@shared/contactKinds';
import type { AccountContact } from '@/types';

// The kinds offered first; "More …" opens the dialog with all of them.
const QUICK_KINDS: ContactKind[] = ['whatsapp', 'signal', 'phone', 'email', 'telegram', 'instagram'];

// Offers every account, once, to add contact details — right after the
// profile photo prompt (so new accounts see both in a row, and accounts made
// before contact details existed see this one on their next visit), and
// after a check-in with the account (`afterCheckIn`: without waiting for the
// photo prompt, which those who only check in may never see).
export const WelcomeContactsPrompt = ({ afterCheckIn = false }: { afterCheckIn?: boolean }) => {
  const { t } = useI18n();
  const { user, refreshUser } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [contacts, setContacts] = useState<AccountContact[]>([]);
  const [dialogKind, setDialogKind] = useState<ContactKind | null>(null);

  const waiting = Boolean(user && (afterCheckIn || user.photo_prompted_at) && !user.contacts_prompted_at && !dismissed);
  const userId = user?.id;
  useEffect(() => {
    if (waiting && userId) void loadContacts(userId).then(setContacts);
  }, [waiting, userId]);

  if (!waiting || !user) return null;

  const done = async (added: boolean) => {
    setDismissed(true);
    track('contacts-prompt', { added, from: afterCheckIn ? 'check-in' : 'app' });
    await api.from('app_users').update({ contacts_prompted_at: new Date().toISOString() }).eq('id', user.id);
    await refreshUser();
  };

  const add = async (fields: { kind: ContactKind; value: string; label: string }) => {
    const { data, error } = await api
      .from('account_contacts')
      .insert({ user_id: user.id, ...fields, position: contacts.length })
      .select('*')
      .single();
    if (error || !data) return error?.message ?? t('saveFailed');
    setContacts((list) => [...list, data as AccountContact]);
    track('contact-add', { kind: fields.kind, from: 'prompt' });
    return null;
  };

  return createPortal(
    <>
      <Overlay>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="contacts-prompt-title"
          className="mx-4 flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-border bg-surface animate-[fadein_200ms_ease-in-out]"
        >
          <div className="overflow-y-auto p-6 sm:p-8">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
              <Contact size={26} />
            </span>
            <h2 id="contacts-prompt-title" className="mt-4 text-center text-xl font-semibold">
              {t('welcomeContactsTitle')}
            </h2>
            <p className="mt-2 text-center text-sm text-text-secondary">{t('welcomeContactsHint')}</p>

            {/* What was added so far. */}
            {contacts.length > 0 && (
              <ul className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border">
                {contacts.map((c) => (
                  <li key={c.id}>
                    <ContactRow contact={c} />
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 grid grid-cols-2 gap-2">
              {QUICK_KINDS.map((kind) => {
                const { icon: Icon, tone } = CONTACT_INFO[kind];
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setDialogKind(kind)}
                    className="flex h-11 min-w-0 items-center gap-2.5 rounded-xl border border-border px-3 text-left text-sm font-medium transition-colors duration-150 hover:border-black hover:bg-surface-subtle"
                  >
                    <Icon size={17} className={cn('flex-shrink-0', tone)} aria-hidden />
                    <span className="truncate">{t(contactKindLabel(kind))}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setDialogKind('other')}
                className="col-span-2 flex h-10 items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong text-sm font-medium text-text-secondary transition-colors duration-150 hover:border-black hover:text-text"
              >
                <MoreHorizontal size={16} />
                {t('welcomeContactsMore')}
              </button>
            </div>

            <div className="mt-6 flex flex-col gap-2">
              {contacts.length > 0 ? (
                <Button onClick={() => void done(true)}>{t('onboardingContinue')}</Button>
              ) : (
                <Button variant="secondary" onClick={() => void done(false)}>
                  {t('welcomePhotoLater')}
                </Button>
              )}
            </div>
            <p className="mt-3 text-center text-xs text-text-tertiary">{t('welcomeContactsWhere')}</p>
          </div>
        </div>
      </Overlay>
      <ContactDialog
        open={dialogKind != null}
        contact={null}
        initialKind={dialogKind ?? 'phone'}
        onClose={() => setDialogKind(null)}
        onSave={add}
      />
    </>,
    document.body,
  );
};
