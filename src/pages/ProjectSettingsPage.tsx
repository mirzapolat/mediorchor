import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { GripVertical, Plus, Trash2, Upload, X } from 'lucide-react';
import { RowActionButton } from '@/components/RowActionButton';
import { useDragReorder } from '@/hooks/useDragReorder';
import { cn } from '@/lib/cn';
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

interface GroupRow {
  id: string;
  value: string;
}

// Editable, drag-sortable list of the project's groups. The order set here is
// the order shown everywhere (check-in, sign-up, participation).
const GroupsCard = ({
  groups,
  onChange,
}: {
  groups: GroupRow[];
  onChange: (groups: GroupRow[]) => void;
}) => {
  const { t } = useI18n();
  const dnd = useDragReorder(groups, (g) => g.id, onChange, 8);

  return (
    <Card className="mt-6 space-y-3">
      <div>
        <h2 className="text-base font-medium">{t('groupsList')}</h2>
        <p className="text-sm text-text-secondary mt-1">{t('projectGroupsHint')}</p>
      </div>
      <div className="space-y-2">
        {groups.map((group, index) => {
          const dragging = dnd.isDragging(group.id);
          return (
            <div
              key={group.id}
              ref={(el) => dnd.setItemRef(group.id, el)}
              style={
                dnd.dragActive
                  ? {
                      transform: `translateY(${dnd.shiftFor(index)}px)`,
                      transition: dragging ? 'none' : 'transform 150ms ease',
                      position: dragging ? 'relative' : undefined,
                      zIndex: dragging ? 10 : undefined,
                    }
                  : undefined
              }
              className={cn('flex items-center gap-2', dragging && 'bg-surface shadow-lg rounded-md')}
            >
              <button
                type="button"
                aria-label={t('reorder')}
                onPointerDown={(e) => dnd.startDrag(e, group.id, index)}
                onPointerMove={dnd.moveDrag}
                onPointerUp={dnd.endDrag}
                onPointerCancel={dnd.endDrag}
                style={{ touchAction: 'none' }}
                className={cn(
                  'flex h-9 w-6 flex-shrink-0 items-center justify-center rounded text-text-tertiary hover:text-text-secondary',
                  groups.length < 2 ? 'invisible' : 'cursor-grab active:cursor-grabbing',
                )}
              >
                <GripVertical size={16} />
              </button>
              <Input
                value={group.value}
                placeholder={t('groupPlaceholder')}
                onChange={(e) =>
                  onChange(
                    groups.map((g) => (g.id === group.id ? { ...g, value: e.target.value } : g)),
                  )
                }
                className="flex-1"
              />
              <RowActionButton
                label={t('remove')}
                onClick={() => {
                  const next = groups.filter((g) => g.id !== group.id);
                  onChange(next.length > 0 ? next : [{ id: crypto.randomUUID(), value: '' }]);
                }}
              >
                <Trash2 size={15} />
              </RowActionButton>
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        variant="secondary"
        onClick={() => onChange([...groups, { id: crypto.randomUUID(), value: '' }])}
      >
        <Plus size={15} />
        {t('addGroup')}
      </Button>
    </Card>
  );
};

export const ProjectSettingsPage = () => {
  const { t } = useI18n();
  const { project, reloadProject } = useProjectContext();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: project.name,
    description: project.description ?? '',
  });
  // Rows carry a stable id so drag & drop reordering works while editing.
  const [groups, setGroups] = useState<{ id: string; value: string }[]>(() =>
    (project.groups.length > 0 ? project.groups : ['']).map((value) => ({
      id: crypto.randomUUID(),
      value,
    })),
  );
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
        groups: groups.map((g) => g.value.trim()).filter((g) => g !== ''),
        ...access,
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
        </Card>

        <GroupsCard
          groups={groups}
          onChange={(next) => {
            setGroups(next);
            setSaved(false);
          }}
        />

        <Card className="mt-6 space-y-4">
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

        <div className="flex items-center gap-3 mt-6">
          <Button type="submit" disabled={saving || !form.name.trim()}>
            {saving ? t('loading') : t('save')}
          </Button>
          {saved && <span className="text-sm text-text-secondary">✓</span>}
        </div>
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
