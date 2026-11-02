import { useState } from 'react';
import { ChevronRight, UserRound } from 'lucide-react';
import { Avatar } from './Avatar';
import { Modal } from './Modal';
import { ContactRow } from './AccountContacts';
import { useI18n } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import type { MyGroupResponsibles } from '@/lib/groupResponsibles';

type Person = MyGroupResponsibles['people'][number];

// "Meine Teilnahme", inside the "Meine Gruppe" card: who looks after the
// account's group. Each person opens their public contact details; the
// group's note for participants below.
export const GroupResponsiblesSection = ({ data }: { data: MyGroupResponsibles }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState<Person | null>(null);
  if (data.people.length === 0 && !data.note.trim()) return null;

  return (
    <div className="border-t border-border pt-3">
      {data.people.length > 0 && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('groupResponsibles')}</p>
          <ul className="-mx-2 mt-1 grid gap-1 sm:grid-cols-2">
            {data.people.map((p) => (
              <li key={p.user_id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(p);
                    track('responsible-open', { contacts: p.contacts.length > 0 ? 'yes' : 'no' });
                  }}
                  className="group flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-surface-subtle"
                >
                  <Avatar name={p.name} photoUrl={p.photo_url} size={36} />
                  <span className="min-w-0 flex-1 truncate font-medium" title={p.name}>
                    {p.name}
                  </span>
                  <ChevronRight
                    size={16}
                    className="flex-shrink-0 text-text-tertiary transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-text-secondary"
                  />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {data.note.trim() && (
        <p
          className={
            data.people.length > 0
              ? 'mt-2 whitespace-pre-line text-sm text-text-secondary break-words'
              : 'whitespace-pre-line text-sm text-text-secondary break-words'
          }
        >
          {data.note}
        </p>
      )}

      <Modal open={open != null} title={open?.name ?? ''} onClose={() => setOpen(null)}>
        {open && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={open.name} photoUrl={open.photo_url} size={48} />
              <div className="min-w-0">
                <p className="truncate font-medium">{open.name}</p>
                <p className="flex items-center gap-1 text-xs text-text-tertiary">
                  <UserRound size={12} aria-hidden />
                  {t('myResponsibles').replace('{group}', data.group_name)}
                </p>
              </div>
            </div>
            {open.contacts.length > 0 ? (
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                {open.contacts.map((c) => (
                  <li key={c.id}>
                    <ContactRow contact={c} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-tertiary">{t('responsibleNoContacts')}</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};
