import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Copy, ExternalLink, Loader2, Pencil, Plus, X } from 'lucide-react';
import { Button } from './Button';
import { Card } from './Card';
import { Input } from './Input';
import { Modal } from './Modal';
import { SortableList } from './SortableList';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { CONTACT_INFO, contactActionLabel, contactKindLabel, opensNewTab } from '@/lib/contacts';
import { CONTACT_KINDS, CONTACT_LABEL_MAX, CONTACT_VALUE_MAX, isContactKind, type ContactKind } from '@shared/contactKinds';
import type { AccountContact } from '@/types';

// An account's contact details: edited in its profile settings, shown to
// those who manage projects on the member and account pages. Each becomes
// a one-click link where it can (call, write, open the chat or profile).

export const loadContacts = async (userId: string): Promise<AccountContact[]> => {
  const { data } = await api
    .from('account_contacts')
    .select('*')
    .eq('user_id', userId)
    .order('position')
    .order('created_at');
  // A kind the app no longer offers is shown as "other" (never a crash).
  return ((data as AccountContact[] | null) ?? []).map((c) => (isContactKind(c.kind) ? c : { ...c, kind: 'other' }));
};

// The kind's tinted icon tile.
const KindTile = ({ kind }: { kind: ContactKind }) => {
  const { icon: Icon, tone } = CONTACT_INFO[kind];
  return (
    <span className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-surface-muted', tone)}>
      <Icon size={17} aria-hidden />
    </span>
  );
};

const CopyButton = ({ value }: { value: string }) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      aria-label={t('copy')}
      title={copied ? t('copied') : t('copy')}
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
    >
      {copied ? <Check size={15} className="text-success" /> : <Copy size={15} />}
    </button>
  );
};

// One contact: its icon, the value (a link where it can be one), its label
// and kind; `actions` on the right.
export const ContactRow = ({ contact, actions }: { contact: AccountContact; actions?: ReactNode }) => {
  const { t } = useI18n();
  const info = CONTACT_INFO[contact.kind];
  const href = info.href(contact.value);
  const meta = [contact.label.trim(), t(contactKindLabel(contact.kind))].filter(Boolean).join(' · ');
  const linkProps = href && opensNewTab(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {};
  return (
    <div className="flex min-h-[3.5rem] items-center gap-3 px-3 py-2">
      <KindTile kind={contact.kind} />
      <div className="min-w-0 flex-1">
        {href ? (
          <a
            href={href}
            {...linkProps}
            onClick={() => track('contact-open', { kind: contact.kind })}
            title={t(contactActionLabel[info.action])}
            className="block truncate text-sm font-medium hover:underline"
          >
            {contact.value}
          </a>
        ) : (
          <p className="truncate text-sm font-medium">{contact.value}</p>
        )}
        <p className="truncate text-xs text-text-tertiary">{meta}</p>
      </div>
      {href && (
        <a
          href={href}
          {...linkProps}
          onClick={() => track('contact-open', { kind: contact.kind })}
          aria-label={`${t(contactActionLabel[info.action])}: ${contact.value}`}
          title={t(contactActionLabel[info.action])}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
        >
          {opensNewTab(href) ? <ExternalLink size={15} /> : <info.icon size={15} />}
        </a>
      )}
      <CopyButton value={contact.value} />
      {actions}
    </div>
  );
};

// Adding or changing one contact: its kind (tiles), the value with an
// example for the kind, an optional label, and what link it becomes.
export const ContactDialog = ({
  open,
  contact,
  initialKind = 'phone',
  onClose,
  onSave,
}: {
  open: boolean;
  contact: AccountContact | null;
  // A new contact's kind to start with.
  initialKind?: ContactKind;
  onClose: () => void;
  onSave: (fields: { kind: ContactKind; value: string; label: string }) => Promise<string | null>;
}) => {
  const { t } = useI18n();
  const [kind, setKind] = useState<ContactKind>('phone');
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind(contact?.kind ?? initialKind);
    setValue(contact?.value ?? '');
    setLabel(contact?.label ?? '');
    setError(null);
  }, [open, contact, initialKind]);

  const info = CONTACT_INFO[kind];
  const href = value.trim() ? info.href(value) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    const saveError = await onSave({ kind, value: value.trim(), label: label.trim() });
    setBusy(false);
    if (saveError) setError(saveError);
    else onClose();
  };

  return (
    <Modal
      open={open}
      title={contact ? t('editContact') : t('addContact')}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" form="contact-form" disabled={busy || !value.trim()}>
            {busy && <Loader2 size={15} className="animate-spin" />}
            {t('save')}
          </Button>
        </>
      }
    >
      <form id="contact-form" onSubmit={submit} className="space-y-4">
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{t('contactKind')}</legend>
          <div role="radiogroup" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {CONTACT_KINDS.map((k) => {
              const on = k === kind;
              const { icon: Icon, tone } = CONTACT_INFO[k];
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setKind(k)}
                  className={cn(
                    'flex h-10 min-w-0 items-center gap-2 rounded-lg border px-2.5 text-left text-sm transition-colors duration-150',
                    on ? 'border-accent bg-accent/10 font-medium' : 'border-border hover:bg-surface-subtle',
                  )}
                >
                  <Icon size={15} className={cn('flex-shrink-0', tone)} aria-hidden />
                  <span className="truncate">{t(contactKindLabel(k))}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Input
            id="contact-value"
            label={t('contactValue')}
            autoFocus
            value={value}
            maxLength={CONTACT_VALUE_MAX}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder={info.placeholder ?? t('contactHandlePlaceholder')}
            inputMode={kind === 'phone' || kind === 'whatsapp' || kind === 'signal' ? 'tel' : kind === 'email' ? 'email' : undefined}
            required
          />
          <Input
            id="contact-label"
            label={
              <>
                {t('contactLabel')} <span className="font-normal text-text-tertiary">({t('optional')})</span>
              </>
            }
            value={label}
            maxLength={CONTACT_LABEL_MAX}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('contactLabelPlaceholder')}
          />
        </div>
        {/* What the contact becomes for those who open it. */}
        {value.trim() && (
          <p className="flex min-w-0 items-center gap-2 rounded-lg bg-surface-subtle px-3 py-2 text-xs text-text-secondary">
            <info.icon size={14} className={cn('flex-shrink-0', info.tone)} aria-hidden />
            {href ? (
              <>
                <span className="flex-shrink-0">{t('contactLinkPreview')}</span>
                <span className="truncate font-mono text-text">{href}</span>
              </>
            ) : (
              <span>{t('contactNoLink')}</span>
            )}
          </p>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </form>
    </Modal>
  );
};

// The profile settings' card: the account's own contacts, added, changed,
// removed and ordered by dragging.
export const ContactsEditor = ({ userId }: { userId: string }) => {
  const { t } = useI18n();
  const [contacts, setContacts] = useState<AccountContact[] | null>(null);
  const [editing, setEditing] = useState<AccountContact | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setContacts(await loadContacts(userId)), [userId]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (fields: { kind: ContactKind; value: string; label: string }) => {
    if (editing) {
      const { error: saveError } = await api.from('account_contacts').update(fields).eq('id', editing.id);
      if (saveError) return saveError.message;
      setContacts((list) => list?.map((c) => (c.id === editing.id ? { ...c, ...fields } : c)) ?? list);
      track('contact-edit', { kind: fields.kind });
      return null;
    }
    const { data, error: saveError } = await api
      .from('account_contacts')
      .insert({ user_id: userId, ...fields, position: contacts?.length ?? 0 })
      .select('*')
      .single();
    if (saveError || !data) return saveError?.message ?? t('saveFailed');
    setContacts((list) => [...(list ?? []), data as AccountContact]);
    track('contact-add', { kind: fields.kind });
    return null;
  };

  const remove = async (contact: AccountContact) => {
    setContacts((list) => list?.filter((c) => c.id !== contact.id) ?? list);
    const { error: removeError } = await api.from('account_contacts').delete().eq('id', contact.id);
    if (removeError) {
      setError(`${t('saveFailed')} (${removeError.message})`);
      void load();
    }
  };

  const reorder = async (next: AccountContact[]) => {
    setContacts(next.map((c, position) => ({ ...c, position })));
    const results = await Promise.all(
      next.map((c, position) =>
        c.position === position ? null : api.from('account_contacts').update({ position }).eq('id', c.id),
      ),
    );
    if (results.some((r) => r?.error)) {
      setError(t('saveFailed'));
      void load();
    }
  };

  const openDialog = (contact: AccountContact | null) => {
    setEditing(contact);
    setDialogOpen(true);
  };

  return (
    <Card className="space-y-4">
      <div className="min-w-0">
        <p className="font-medium">{t('contactDetails')}</p>
        <p className="mt-0.5 text-sm text-text-secondary">{t('contactDetailsHint')}</p>
      </div>

      {contacts == null ? (
        <div className="flex justify-center py-4">
          <Loader2 size={18} className="animate-spin text-text-tertiary" />
        </div>
      ) : (
        contacts.length > 0 && (
          <SortableList
            variant="joined"
            items={contacts}
            getId={(c) => c.id}
            onReorder={(next) => void reorder(next)}
            renderItem={(c) => (
              <div>
                <ContactRow
                  contact={c}
                  actions={
                    <span className="flex items-center">
                      <button
                        type="button"
                        onClick={() => openDialog(c)}
                        aria-label={`${t('editContact')}: ${c.value}`}
                        title={t('editContact')}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(c)}
                        aria-label={`${t('deleteContact')}: ${c.value}`}
                        title={t('deleteContact')}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary hover:bg-danger-soft hover:text-danger"
                      >
                        <X size={15} />
                      </button>
                    </span>
                  }
                />
              </div>
            )}
          />
        )
      )}

      <button
        type="button"
        onClick={() => openDialog(null)}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border-strong text-sm font-medium text-text-secondary transition-colors duration-150 hover:border-black hover:bg-surface-subtle hover:text-text"
      >
        <Plus size={16} />
        {t('addContact')}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}

      <ContactDialog open={dialogOpen} contact={editing} onClose={() => setDialogOpen(false)} onSave={save} />
    </Card>
  );
};

// Someone's contact details to read (and use): nothing while there are none
// or they can't be seen.
export const ContactList = ({ userId, className }: { userId: string; className?: string }) => {
  const { t } = useI18n();
  const [contacts, setContacts] = useState<AccountContact[]>([]);
  useEffect(() => {
    let live = true;
    void loadContacts(userId).then((list) => live && setContacts(list));
    return () => {
      live = false;
    };
  }, [userId]);
  if (contacts.length === 0) return null;
  return (
    <section className={cn('space-y-2', className)}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('contactDetails')}</h2>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {contacts.map((c) => (
          <li key={c.id}>
            <ContactRow contact={c} />
          </li>
        ))}
      </ul>
    </section>
  );
};
