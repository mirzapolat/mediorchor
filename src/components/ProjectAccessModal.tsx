import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Avatar } from './Avatar';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import type { AppUser, Project } from '@/types';

// Picks the users explicitly granted access to one project (user_projects
// rows). Admins and users with access to all projects are shown locked; that
// flag and the per-user view of the same rows live on the user detail page.
export const ProjectAccessModal = ({
  project,
  onClose,
}: {
  project: Project | null;
  onClose: () => void;
}) => {
  const { t } = useI18n();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [initial, setInitial] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!project) return;
    setLoading(true);
    setQuery('');
    Promise.all([
      api.from('app_users').select('*').order('name'),
      api.from('user_projects').select('user_id').eq('project_id', project.id),
    ]).then(([usr, access]) => {
      const granted = new Set(((access.data as { user_id: string }[]) ?? []).map((r) => r.user_id));
      setUsers((usr.data as AppUser[]) ?? []);
      setInitial(granted);
      setSelected(new Set(granted));
      setLoading(false);
    });
  }, [project]);

  if (!project) return null;

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
      await api.from('user_projects').delete().eq('project_id', project.id).in('user_id', removed);
    }
    if (added.length > 0) {
      await api
        .from('user_projects')
        .insert(added.map((user_id) => ({ user_id, project_id: project.id })));
    }
    setSaving(false);
    onClose();
  };

  const q = query.trim().toLowerCase();
  const visible = users.filter(
    (u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
  );
  // Access that comes from an account-wide flag rather than this project.
  const inherited = (u: AppUser) =>
    u.is_admin ? t('adminRights') : u.can_manage_projects ? t('allProjectsAccess') : null;

  return (
    <Modal
      open={!!project}
      title={`${t('accessFor')} ${project.name}`}
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
      <p className="text-sm text-text-secondary mb-3">{t('projectAccessHint')}</p>
      <div className="relative mb-3">
        <Search
          size={15}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search')}
          className="w-full rounded-md border border-border bg-transparent pl-8 pr-3 py-1.5 text-sm outline-none focus:border-text-secondary"
        />
      </div>
      {loading ? (
        <p className="text-sm text-text-secondary">{t('loading')}</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-text-secondary">{t('noResults')}</p>
      ) : (
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {visible.map((u) => {
            const via = inherited(u);
            return (
              <label
                key={u.id}
                className={`flex items-center gap-3 px-2 py-1.5 rounded-md ${
                  via ? 'cursor-default' : 'cursor-pointer hover:bg-[#f5f5f5]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={Boolean(via) || selected.has(u.id)}
                  disabled={Boolean(via)}
                  onChange={() => toggle(u.id)}
                  className="h-4 w-4 accent-accent disabled:opacity-50"
                />
                <Avatar name={u.name} photoUrl={u.photo_url} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{u.name}</span>
                  <span className="block truncate text-xs text-text-secondary">{u.email}</span>
                </span>
                {via && <span className="shrink-0 text-xs text-text-tertiary">{via}</span>}
              </label>
            );
          })}
        </div>
      )}
    </Modal>
  );
};
