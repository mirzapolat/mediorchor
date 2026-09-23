import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Avatar } from './Avatar';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import type { AppUser, Project } from '@/types';

// Lets the owner choose whether a user can access all projects or only a
// selected subset (persisted to app_users.all_projects + user_projects).
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
  const [allProjects, setAllProjects] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setAllProjects(user.all_projects);
    Promise.all([
      api.from('projects').select('*').order('name'),
      api.from('user_projects').select('project_id').eq('user_id', user.id),
    ]).then(([proj, access]) => {
      setProjects((proj.data as Project[]) ?? []);
      setSelected(
        new Set(((access.data as { project_id: string }[]) ?? []).map((r) => r.project_id)),
      );
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
    await api.from('app_users').update({ all_projects: allProjects }).eq('id', user.id);
    // Replace the explicit project list with the current selection.
    await api.from('user_projects').delete().eq('user_id', user.id);
    if (!allProjects && selected.size > 0) {
      await api
        .from('user_projects')
        .insert([...selected].map((project_id) => ({ user_id: user.id, project_id })));
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
      <div className="space-y-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={allProjects}
            onChange={(e) => setAllProjects(e.target.checked)}
            className="mt-1 h-4 w-4 accent-accent"
          />
          <span>
            <span className="font-medium">{t('allProjectsAccess')}</span>
            <span className="block text-sm text-text-secondary">{t('allProjectsHint')}</span>
          </span>
        </label>

        {!allProjects && (
          <div className="border-t border-border pt-4">
            <p className="text-sm font-medium text-text-secondary mb-2">{t('selectedProjects')}</p>
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
          </div>
        )}
      </div>
    </Modal>
  );
};
