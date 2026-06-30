import { useEffect, useState, type FormEvent } from 'react';
import { Upload } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { Avatar } from './Avatar';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/lib/uploadImage';
import type { Member } from '@/types';

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

  // The dialog stays mounted between openings, so reset the fields each time it
  // opens (or the edited member changes) instead of keeping stale values.
  useEffect(() => {
    if (open) {
      setForm(formFromMember(member));
      setPhotoUrl(member?.photo_url ?? null);
      setSaving(false);
      setUploadError(null);
    }
  }, [open, member]);

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
