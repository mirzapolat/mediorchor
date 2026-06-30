import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, X } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Textarea } from '@/components/Input';
import { Avatar } from '@/components/Avatar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/lib/uploadImage';
import { useProjectContext } from '@/layouts/projectContext';

export const ProjectSettingsPage = () => {
  const { t } = useI18n();
  const { project, reloadProject } = useProjectContext();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: project.name,
    description: project.description ?? '',
  });
  const [imageUrl, setImageUrl] = useState<string | null>(project.image_url);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

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
    await supabase
      .from('projects')
      .update({
        name: form.name.trim(),
        description: form.description.trim() || null,
        image_url: imageUrl,
      })
      .eq('id', project.id);
    setSaving(false);
    setSaved(true);
    reloadProject();
  };

  const remove = async () => {
    await supabase.from('projects').delete().eq('id', project.id);
    navigate('/');
  };

  return (
    <>
      <PageHeader title={t('settings')} />

      <form onSubmit={save} className="max-w-xl">
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
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving || !form.name.trim()}>
              {saving ? t('loading') : t('save')}
            </Button>
            {saved && <span className="text-sm text-text-secondary">✓</span>}
          </div>
        </Card>
      </form>

      <Card className="max-w-xl mt-6 space-y-3">
        <h2 className="text-base font-medium">{t('delete')}</h2>
        <p className="text-sm text-text-secondary">{t('confirmDelete')}</p>
        <Button variant="accent" onClick={() => setConfirmDel(true)}>
          {t('delete')}
        </Button>
      </Card>

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
