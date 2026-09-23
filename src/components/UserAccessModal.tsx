import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Avatar } from './Avatar';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import type { AppUser, Project } from '@/types';

// Picks the projects a user is explicitly granted (user_projects rows). The
// same rows are edited per project from the projects page (ProjectAccessModal).
export const UserAccessModal = ({
  user,
  onClose,
  onSaved,
}: {
  user: AppUser | null;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const { t } = useI18n();
  const [projects, setProjects] = useState<Project[]>([]);
  const [initial, setInitial] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([
      api.from('projects').select('*').order('name'),
      api.from('user_projects').select('project_id').eq('user_id', user.id),
    ]).then(([proj, access]) => {
      const granted = new Set(((access.data as { project_id: string }[]) ?? []).map((r) => r.project_id));
      setProjects((proj.data as Project[]) ?? []);
      setInitial(granted);
      setSelected(new Set(granted));
      setLoading(false);
    });
  }, [user]);

  if (!user) return null;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setSaving(true);
    const added = [...selected].filter((id) => !initial.has(id));
    const removed = [...initial].filter((id) => !selected.has(id));
    if (removed.length > 0) {
      await api.from('user_projects').delete().eq('user_id', user.id).in('project_id', removed);
    }
    if (added.length > 0) {
      await api
        .from('user_projects')
        .insert(added.map((project_id) => ({ user_id: user.id, project_id })));
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal
      open={!!user}
      title={`${t('accessFor')} ${user.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? t('loading') : t('save')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-secondary mb-3">{t('selectedProjectsHint')}</p>
      {loading ? (
        <p className="text-sm text-text-secondary">{t('loading')}</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-text-secondary">{t('noProjects')}</p>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {projects.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-3 px-2 py-1.5 rounded-md cursor-pointer hover:bg-[#f5f5f5]"
            >
              <input
                type="checkbox"
                checked={selected.has(p.id)}
                onChange={() => toggle(p.id)}
                className="h-4 w-4 accent-accent"
              />
              <Avatar name={p.name} photoUrl={p.image_url} size={24} square />
              <span className="truncate">{p.name}</span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
};
