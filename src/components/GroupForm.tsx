import { useEffect, useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { GroupPill } from './GroupPill';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { GROUP_PALETTE, isHexColor, paletteColor } from '@/lib/groupColors';
import type { ProjectGroup } from '@/types';

export const GroupForm = ({
  open,
  projectId,
  group,
  groups,
  onClose,
  onSaved,
  onSubmit,
}: {
  open: boolean;
  projectId: string;
  group: ProjectGroup | null;
  // All groups of the project (for the next position and duplicate checks).
  groups: ProjectGroup[];
  onClose: () => void;
  onSaved: () => void;
  // Replaces saving to the database (e.g. for groups of a project that
  // doesn't exist yet).
  onSubmit?: (values: { name: string; color: string }) => void;
}) => {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [color, setColor] = useState(GROUP_PALETTE[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setColor(group?.color ?? paletteColor(groups.length));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group]);

  const trimmed = name.trim();
  const duplicate = groups.some(
    (g) => g.id !== group?.id && g.name.toLowerCase() === trimmed.toLowerCase(),
  );
  const isCustom = !GROUP_PALETTE.includes(color.toLowerCase());

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed || duplicate) return;
    if (onSubmit) {
      onSubmit({ name: trimmed, color });
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    const { error: saveError } = group
      ? await api.from('project_groups').update({ name: trimmed, color }).eq('id', group.id)
      : await api.from('project_groups').insert({
          project_id: projectId,
          name: trimmed,
          color,
          position: groups.reduce((max, g) => Math.max(max, g.position + 1), 0),
        });
    setSaving(false);
    if (saveError) {
      setError(saveError.code === '23505' ? t('groupNameTaken') : saveError.message);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Modal
      open={open}
      title={group ? t('editGroup') : t('newGroup')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" form="group-form" disabled={saving || !trimmed || duplicate}>
            {saving ? t('loading') : group ? t('save') : t('create')}
          </Button>
        </>
      }
    >
      <form id="group-form" onSubmit={save} className="space-y-4">
        <div>
          <Input
            label={t('groupName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
          {duplicate && <p className="mt-1.5 text-sm text-accent">{t('groupNameTaken')}</p>}
          {group && !duplicate && trimmed !== group.name && (
            <p className="mt-1.5 text-sm text-text-tertiary">{t('groupRenameHint')}</p>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-text-secondary">{t('groupColor')}</p>
          <div className="flex flex-wrap items-center gap-2">
            {GROUP_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 transition-shadow',
                  color.toLowerCase() === c && 'ring-2 ring-black',
                )}
                style={{ backgroundColor: c }}
              >
                {color.toLowerCase() === c && <Check size={15} className="text-white" />}
              </button>
            ))}
            <label
              className={cn(
                'relative flex h-8 cursor-pointer items-center gap-2 rounded-full border border-border pl-1 pr-3 text-sm text-text-secondary hover:bg-[#f5f5f5]',
                isCustom && 'ring-2 ring-black ring-offset-2',
              )}
            >
              <span
                className="h-6 w-6 rounded-full border border-border"
                style={{
                  background: isCustom
                    ? color
                    : 'conic-gradient(#e11d48, #ca8a04, #16a34a, #0284c7, #9333ea, #e11d48)',
                }}
              />
              {t('customColor')}
              <input
                type="color"
                value={isHexColor(color) ? color : GROUP_PALETTE[0]}
                onChange={(e) => setColor(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
          </div>
        </div>

        <div className="rounded-md border border-border bg-[#fafafa] px-4 py-3">
          <GroupPill name={trimmed || t('groupName')} color={color} />
        </div>

        {error && <p className="text-sm text-accent">{error}</p>}
      </form>
    </Modal>
  );
};
