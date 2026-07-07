import { useEffect, useState, type FormEvent } from 'react';
import { Search, Upload, UserRound, X } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { Avatar } from './Avatar';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/lib/uploadImage';
import type { Member } from '@/types';

interface AccountResult {
  id: string;
  name: string;
  email: string;
}

interface MemberFormProps {
  open: boolean;
  projectId: string;
  member: Member | null;
  groups: string[];
  onClose: () => void;
  onSaved: () => void;
}

const blank = { first_name: '', last_name: '', group_name: '', email: '' };

const formFromMember = (member: Member | null) =>
  member
    ? {
        first_name: member.first_name,
        last_name: member.last_name,
        group_name: member.group_name ?? '',
        email: member.email ?? '',
      }
    : blank;

export const MemberForm = ({
  open,
  projectId,
  member,
  groups,
  onClose,
  onSaved,
}: MemberFormProps) => {
  const { t } = useI18n();
  const [form, setForm] = useState(() => formFromMember(member));
  const [photoUrl, setPhotoUrl] = useState<string | null>(member?.photo_url ?? null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Optional link to an existing account (only when creating a new member).
  const [accountQuery, setAccountQuery] = useState('');
  const [accountResults, setAccountResults] = useState<AccountResult[]>([]);
  const [linkedAccount, setLinkedAccount] = useState<AccountResult | null>(null);

  // The dialog stays mounted between openings, so reset the fields each time it
  // opens (or the edited member changes) instead of keeping stale values.
  useEffect(() => {
    if (open) {
      setForm(formFromMember(member));
      setPhotoUrl(member?.photo_url ?? null);
      setSaving(false);
      setUploadError(null);
      setAccountQuery('');
      setAccountResults([]);
      setLinkedAccount(null);
    }
  }, [open, member]);

  // Debounced account search while creating a new member.
  useEffect(() => {
    if (!open || member || linkedAccount) return;
    const query = accountQuery.trim();
    if (!query) {
      setAccountResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      const { data } = await supabase.rpc('search_accounts', { p_query: query });
      setAccountResults((data as AccountResult[]) ?? []);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [accountQuery, open, member, linkedAccount]);

  const selectAccount = (account: AccountResult) => {
    setLinkedAccount(account);
    setAccountResults([]);
    setAccountQuery('');
    // Prefill from the account; the group stays a per-project choice.
    const name = account.name.trim();
    const lastSpace = name.lastIndexOf(' ');
    setForm((f) => ({
      ...f,
      first_name: lastSpace > 0 ? name.slice(0, lastSpace) : name,
      last_name: lastSpace > 0 ? name.slice(lastSpace + 1) : f.last_name,
      email: account.email,
    }));
  };

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    const { url, error } = await uploadImage(projectId, file);
    if (error) setUploadError(error);
    else setPhotoUrl(url);
    setUploading(false);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      project_id: projectId,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      group_name: form.group_name.trim() || null,
      email: form.email.trim() || null,
      photo_url: photoUrl,
    };
    if (member) {
      await supabase.from('members').update(payload).eq('id', member.id);
    } else if (linkedAccount) {
      // The account may already have a (possibly archived) member row in this
      // project — one link per project, so re-activate it instead.
      const { data: existing } = await supabase
        .from('members')
        .select('id')
        .eq('project_id', projectId)
        .eq('user_id', linkedAccount.id)
        .maybeSingle();
      if (existing) {
        await supabase
          .from('members')
          .update({ ...payload, status: 'active' })
          .eq('id', (existing as { id: string }).id);
      } else {
        await supabase.from('members').insert({ ...payload, user_id: linkedAccount.id });
      }
    } else {
      await supabase.from('members').insert(payload);
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  const fullName = `${form.first_name} ${form.last_name}`.trim();

  return (
    <Modal
      open={open}
      title={member ? t('editMember') : t('newMember')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            form="member-form"
            disabled={saving || !form.first_name.trim() || !form.last_name.trim()}
          >
            {saving ? t('loading') : member ? t('save') : t('create')}
          </Button>
        </>
      }
    >
      <form id="member-form" onSubmit={save} className="space-y-4">
        {!member && (
          <div className="rounded-md border border-border p-3 space-y-2">
            {linkedAccount ? (
              <div className="flex items-center gap-3">
                <UserRound size={18} className="text-text-secondary flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{linkedAccount.name || linkedAccount.email}</p>
                  <p className="text-sm text-text-secondary truncate">{linkedAccount.email}</p>
                </div>
                <button
                  type="button"
                  aria-label={t('remove')}
                  onClick={() => setLinkedAccount(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-[#f0f0f0] hover:text-text"
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <>
                <Input
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <Search size={13} />
                      {`${t('searchAccount')} (${t('optional')})`}
                    </span>
                  }
                  value={accountQuery}
                  onChange={(e) => setAccountQuery(e.target.value)}
                  placeholder={t('searchAccountPlaceholder')}
                />
                {accountResults.length > 0 ? (
                  <div className="max-h-44 space-y-0.5 overflow-y-auto">
                    {accountResults.map((account) => (
                      <button
                        key={account.id}
                        type="button"
                        onClick={() => selectAccount(account)}
                        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-[#f5f5f5] transition-colors duration-150"
                      >
                        <Avatar name={account.name || account.email} size={24} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {account.name || account.email}
                          </span>
                          <span className="block truncate text-sm text-text-secondary">
                            {account.email}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : accountQuery.trim() ? (
                  <p className="text-sm text-text-secondary">{t('noAccountsFound')}</p>
                ) : (
                  <p className="text-sm text-text-secondary">{t('searchAccountHint')}</p>
                )}
              </>
            )}
          </div>
        )}
        <div className="flex items-center gap-4">
          <Avatar name={fullName || '?'} photoUrl={photoUrl} size={56} />
          <label className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary border border-border rounded-md px-3 py-2 cursor-pointer hover:bg-[#f5f5f5] transition-colors duration-150">
            <Upload size={15} />
            {uploading ? t('loading') : `${t('photo')} (${t('optional')})`}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])}
            />
          </label>
        </div>
        {uploadError && <p className="text-sm text-accent">{uploadError}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t('firstName')}
            value={form.first_name}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
            required
            autoFocus
          />
          <Input
            label={t('lastName')}
            value={form.last_name}
            onChange={(e) => setForm({ ...form, last_name: e.target.value })}
            required
          />
        </div>
        <Input
          label={`${t('group')} (${t('optional')})`}
          list="member-group-options"
          value={form.group_name}
          onChange={(e) => setForm({ ...form, group_name: e.target.value })}
          placeholder={t('selectOrCreateGroup')}
        />
        <datalist id="member-group-options">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <Input
          type="email"
          label={`${t('email')} (${t('optional')})`}
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </form>
    </Modal>
  );
};
