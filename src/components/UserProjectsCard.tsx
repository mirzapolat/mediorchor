import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card } from './Card';
import { Avatar } from './Avatar';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { permissionsFor } from '@/lib/roles';
import type { AppUser, Member, Project } from '@/types';

type Row = {
  project: Project;
  // Works with the project's content through its role (Stimmeltern and up).
  manage: boolean;
  member: Member | null;
};

// Admin view of an account's projects: where it takes part (and as what),
// split into active and archived projects. Roles from Stimmeltern up cover
// every project; the hint says so and each listed project shows it.
export const UserProjectsCard = ({ user, reloadKey }: { user: AppUser; reloadKey: number }) => {
  const { t } = useI18n();
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.from('projects').select('*').order('name'),
      api.from('members').select('*').eq('user_id', user.id),
    ]).then(([proj, mem]) => {
      if (cancelled) return;
      setProjects((proj.data as Project[]) ?? []);
      setMembers((mem.data as Member[]) ?? []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [user.id, reloadKey]);

  const allProjects = permissionsFor(user.role).canAccessAllProjects;

  const { active, archived } = useMemo(() => {
    const memberByProject = new Map(members.map((m) => [m.project_id, m]));
    const rows: Row[] = projects
      .map((project) => ({
        project,
        manage: allProjects,
        member: memberByProject.get(project.id) ?? null,
      }))
      .filter((r) => r.member);
    return {
      active: rows.filter((r) => r.project.status === 'active'),
      archived: rows.filter((r) => r.project.status === 'archived'),
    };
  }, [projects, members, allProjects]);

  return (
    <Card className="max-w-xl mt-6">
      <p className="font-medium">{t('projects')}</p>
      <p className="text-sm text-text-secondary mt-0.5">
        {allProjects ? t('userProjectsAllHint') : t('userProjectsHint')}
      </p>
      {loading ? null : active.length === 0 && archived.length === 0 ? (
        <p className="text-sm text-text-tertiary mt-3">{t('userProjectsNone')}</p>
      ) : (
        <>
          <ProjectList title={t('userProjectsActive')} rows={active} />
          <ProjectList title={t('archived')} rows={archived} muted />
        </>
      )}
    </Card>
  );
};

const ProjectList = ({ title, rows, muted }: { title: string; rows: Row[]; muted?: boolean }) => {
  if (rows.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
        {title} · {rows.length}
      </p>
      <ul className="mt-1 divide-y divide-border">
        {rows.map((row) => (
          <ProjectRow key={row.project.id} row={row} muted={muted} />
        ))}
      </ul>
    </div>
  );
};

const ProjectRow = ({ row, muted }: { row: Row; muted?: boolean }) => {
  const { t } = useI18n();
  const { project, manage, member } = row;
  const participation =
    member?.status === 'active'
      ? t('userProjectParticipant')
      : member?.status === 'archived'
        ? t('userProjectLeft')
        : member?.status === 'guest'
          ? t('guest')
          : null;

  return (
    <li className="flex items-start gap-3 py-3">
      <Avatar name={project.name} photoUrl={project.image_url} size={28} square />
      <div className="min-w-0 flex-1">
        <Link
          to={`/projects/${project.id}`}
          className={cn('font-medium leading-snug break-words hover:underline', muted && 'text-text-secondary')}
        >
          {project.name}
        </Link>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {manage && <Badge strong>{t('userProjectManageAll')}</Badge>}
          {participation && (
            <Badge>
              {participation}
              {member?.status === 'active' && member.group_name ? ` · ${member.group_name}` : ''}
            </Badge>
          )}
        </div>
        {/* Taking part without account access: the project stays hidden to them. */}
        {member?.status === 'active' && !manage && !project.allow_account_access && (
          <p className="mt-1 text-xs text-text-tertiary">{t('userProjectNoAccountAccess')}</p>
        )}
      </div>
    </li>
  );
};

const Badge = ({ children, strong }: { children: ReactNode; strong?: boolean }) => (
  <span
    className={cn(
      'inline-flex max-w-full items-center rounded-md px-2 py-0.5 text-xs font-medium',
      strong ? 'bg-black text-white' : 'border border-border text-text-secondary',
    )}
  >
    <span className="truncate">{children}</span>
  </span>
);
