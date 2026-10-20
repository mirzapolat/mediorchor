import { useEffect, useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input, Textarea } from './Input';
import { GroupPill } from './GroupPill';
import { PersonPicker } from './PersonPicker';
import { asPersonOption, saveGroupResponsibilities } from '@/lib/groupResponsibles';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { GROUP_PALETTE, isHexColor, paletteColor } from '@/lib/groupColors';
import type { GroupResponsible, PersonOption, ProjectGroup } from '@/types';

export interface GroupFormValues {
  name: string;
  color: string;
  // Who looks after the group and its internal note (organisational only).
  responsibles: PersonOption[];
  note: string;
}

export const GroupForm = ({
  open,
  projectId,
  group,
  groups,
  onClose,
  onSaved,
  onSubmit,
  responsibility,
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
  onSubmit?: (values: GroupFormValues) => void;
  // The group's responsible people and note as stored (database mode), or
  // as prepared so far (onSubmit mode).
  responsibility?: { people: GroupResponsible[] | PersonOption[]; note: string; publicNote?: string };
}) => {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [color, setColor] = useState(GROUP_PALETTE[0]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [note, setNote] = useState('');
  const [publicNote, setPublicNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setColor(group?.color ?? paletteColor(groups.length));
    setPeople((responsibility?.people ?? []).map((p) => ('user_id' in p ? asPersonOption(p as GroupResponsible) : p)));
    setNote(responsibility?.note ?? '');
    setPublicNote(responsibility?.publicNote ?? '');
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
      onSubmit({ name: trimmed, color, responsibles: people, note: note.trim() });
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    const { data: saved, error: saveError } = group
      ? await api.from('project_groups').update({ name: trimmed, color }).eq('id', group.id).select('id').maybeSingle()
      : await api
          .from('project_groups')
          .insert({
            project_id: projectId,
            name: trimmed,
            color,
            position: groups.reduce((max, g) => Math.max(max, g.position + 1), 0),
          })
          .select('id')
          .maybeSingle();
    if (saveError) {
      setSaving(false);
      setError(saveError.code === '23505' ? t('groupNameTaken') : saveError.message);
      return;
    }
    const groupId = (saved as { id: string } | null)?.id ?? group?.id;
    const stored = (responsibility?.people ?? []).filter((p): p is GroupResponsible => 'user_id' in p);
    const responsibilityError = groupId
      ? await saveGroupResponsibilities(groupId, people, note, publicNote, {
          people: stored,
          note: responsibility?.note ?? '',
          publicNote: responsibility?.publicNote ?? '',
        })
      : null;
    setSaving(false);
    if (responsibilityError) {
      // The group itself is saved; say what's missing.
      onSaved();
      setError(t('groupResponsiblesLoadError'));
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
      size="lg"
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
                'relative flex h-8 cursor-pointer items-center gap-2 rounded-full border border-border pl-1 pr-3 text-sm text-text-secondary hover:bg-surface-muted',
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

        <div className="rounded-md border border-border bg-surface-subtle px-4 py-3">
          <GroupPill name={trimmed || t('groupName')} color={color} />
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <div>
            <p className="text-sm font-medium text-text">{t('groupResponsibles')}</p>
            <p className="mt-0.5 text-xs text-text-tertiary">{t('groupResponsiblesHint')}</p>
          </div>
          <PersonPicker
            projectId={onSubmit ? null : projectId}
            value={people}
            onChange={setPeople}
            label={t('groupResponsibles')}
          />
          {!onSubmit && (
            <Textarea
              label={t('groupPublicNote')}
              value={publicNote}
              maxLength={4000}
              onChange={(e) => setPublicNote(e.target.value)}
              placeholder={t('groupPublicNotePlaceholder')}
              className="min-h-[64px]"
            />
          )}
          <Textarea
            label={t('groupNote')}
            value={note}
            maxLength={4000}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('groupNotePlaceholder')}
            className="min-h-[64px]"
          />
        </div>

        {error && <p className="text-sm text-accent">{error}</p>}
      </form>
    </Modal>
  );
};
