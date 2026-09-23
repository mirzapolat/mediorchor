import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Upload, X } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Textarea } from '@/components/Input';
import { Avatar } from '@/components/Avatar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { uploadImage } from '@/lib/uploadImage';
import { useProjectContext } from '@/layouts/projectContext';
import { useAuth } from '@/hooks/useAuth';

export const ProjectSettingsPage = () => {
  const { t } = useI18n();
  const { project, reloadProject } = useProjectContext();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: project.name,
    description: project.description ?? '',
  });
  // Rows carry a stable id so drag & drop reordering works while editing.
  const [access, setAccess] = useState({
    allow_account_access: project.allow_account_access,
    allow_account_checkin: project.allow_account_checkin,
    allow_account_signup: project.allow_account_signup,
    allow_guest_checkin: project.allow_guest_checkin,
    allow_guest_signup: project.allow_guest_signup,
    allow_participant_pieces: project.allow_participant_pieces,
  });
  const [imageUrl, setImageUrl] = useState<string | null>(project.image_url);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const { canManageProjects } = useAuth();

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    setSaved(false);
    const { url, error } = await uploadImage(`projects/${project.id}`, file);
    if (error) setUploadError(error);
    else setImageUrl(url);
    setUploading(false);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    await api
      .from('projects')
      .update({
        name: form.name.trim(),
        description: form.description.trim() || null,
        image_url: imageUrl,
        ...access,
      })
      .eq('id', project.id);
    setSaving(false);
    setSaved(true);
    reloadProject();
  };

  const remove = async () => {
    await api.from('projects').delete().eq('id', project.id);
    navigate('/');
  };

  // Individually granted users manage the content, not the project itself.
  if (!canManageProjects) return <Navigate to={`/projects/${project.id}`} replace />;

  return (
    <>
      <PageHeader
        title={t('settings')}
        actions={
          <>
            {saved && <span className="text-sm text-text-secondary">✓</span>}
            <Button type="submit" form="project-settings" disabled={saving || !form.name.trim()}>
              {saving ? t('loading') : t('save')}
            </Button>
          </>
        }
      />

      <form
        id="project-settings"
        onSubmit={save}
        className="grid gap-6 max-w-5xl lg:grid-cols-2 lg:items-start"
      >
        <div className="space-y-6">
          <Card className="space-y-4">
            <div>
              <p className="text-sm font-medium text-text-secondary mb-2">{t('projectImage')}</p>
              <div className="flex items-center gap-4">
                <Avatar name={form.name || project.name} photoUrl={imageUrl} size={56} square />
                <label className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary border border-border rounded-md px-3 py-2 cursor-pointer hover:bg-[#f5f5f5] transition-colors duration-150">
                  <Upload size={15} />
                  {uploading ? t('loading') : `${t('projectImage')} (${t('optional')})`}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
                  />
                </label>
                {imageUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setImageUrl(null);
                      setSaved(false);
                    }}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text transition-colors duration-150"
                  >
                    <X size={15} />
                    {t('remove')}
                  </button>
                )}
              </div>
              {uploadError && <p className="text-sm text-accent mt-2">{uploadError}</p>}
            </div>
            <Input
              label={t('projectName')}
              value={form.name}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value });
                setSaved(false);
              }}
              required
            />
            <Textarea
              label={`${t('description')} (${t('optional')})`}
              value={form.description}
              onChange={(e) => {
                setForm({ ...form, description: e.target.value });
                setSaved(false);
              }}
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="space-y-4">
            <div>
              <h2 className="text-base font-medium">{t('accessSettings')}</h2>
              <p className="text-sm text-text-secondary mt-1">{t('accessSettingsHint')}</p>
            </div>
            {(
              [
                ['allow_account_access', 'allowAccountAccess', 'allowAccountAccessHint'],
                ['allow_account_checkin', 'allowAccountCheckin', 'allowAccountCheckinHint'],
                ['allow_account_signup', 'allowAccountSignup', 'allowAccountSignupHint'],
                ['allow_guest_checkin', 'allowGuestCheckin', 'allowGuestCheckinHint'],
                ['allow_guest_signup', 'allowGuestSignup', 'allowGuestSignupHint'],
                ['allow_participant_pieces', 'allowParticipantPieces', 'allowParticipantPiecesHint'],
              ] as const
            ).map(([key, label, hint]) => (
              <label
                key={key}
                className="flex items-center justify-between gap-4 border-t border-border pt-4 first:border-t-0 first:pt-0 cursor-pointer"
              >
                <span>
                  <span className="block font-medium">{t(label)}</span>
                  <span className="block text-sm text-text-secondary mt-0.5">{t(hint)}</span>
                </span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-black"
                  checked={access[key]}
                  onChange={(e) => {
                    setAccess({ ...access, [key]: e.target.checked });
                    setSaved(false);
                  }}
                />
              </label>
            ))}
          </Card>

          <Card className="space-y-3">
            <h2 className="text-base font-medium">{t('delete')}</h2>
            <p className="text-sm text-text-secondary">{t('confirmDelete')}</p>
            <Button type="button" variant="accent" onClick={() => setConfirmDel(true)}>
              {t('delete')}
            </Button>
          </Card>
        </div>
      </form>

      <ConfirmDialog
        open={confirmDel}
        title={t('delete')}
        message={t('confirmDelete')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDel(false)}
      />
    </>
  );
};
