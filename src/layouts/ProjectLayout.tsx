import { useCallback, useEffect, useState } from 'react';
import { Navigate, Outlet, useMatch, useNavigate, useParams } from 'react-router-dom';
import { BarChart3, CalendarDays, CalendarX2, ClipboardList, Music, Tags, UserRound, Users, Settings, ArrowLeft } from 'lucide-react';
import { SidebarNavItem } from '@/components/SidebarNav';
import { SidebarFooter } from '@/components/SidebarFooter';
import { Sidebar, useSidebar } from '@/components/Sidebar';
import { Avatar } from '@/components/Avatar';
import { PageSpinner } from '@/components/Spinner';
import { NoAccess } from '@/components/NoAccess';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useProjectContext } from '@/layouts/projectContext';
import type { PieceScope } from '@/layouts/pieceScope';
import { ProjectGroupsProvider } from '@/hooks/useProjectGroups';
import { useAuth } from '@/hooks/useAuth';
import { FadingText } from '@/components/FadingText';
import type { Project } from '@/types';

const ProjectHeader = ({ project, onBack }: { project: Project; onBack: () => void }) => {
  const { t } = useI18n();
  const { collapsed } = useSidebar();
  return (
    <>
      <button
        onClick={onBack}
        title={collapsed ? t('projects') : undefined}
        className={cn(
          'flex items-center h-14 border-b border-border text-sm font-medium text-text-secondary hover:text-text transition-colors duration-150',
          collapsed ? 'justify-center px-0' : 'gap-2 px-5',
        )}
      >
        <ArrowLeft size={16} />
        {!collapsed && <span>{t('projects')}</span>}
      </button>

      <div
        className={cn(
          'flex items-center border-b border-border',
          collapsed ? 'justify-center px-0 py-4' : 'gap-2.5 px-5 py-4',
        )}
      >
        <Avatar name={project.name} photoUrl={project.image_url} size={collapsed ? 32 : 28} square />
        {!collapsed && <FadingText className="font-semibold">{project.name}</FadingText>}
      </div>
    </>
  );
};

// Index route: opening a project always starts on "Meine Teilnahme".
export const ProjectIndexRedirect = () => {
  return <Navigate to="participation" replace />;
};

// Wraps the Stücke pages: participants only get in while the project shows
// the pieces page to participants (managers always do). Gives the pages
// their scope: this project's pieces, edited with the pieces permission.
export const RequirePiecesAccess = () => {
  const ctx = useProjectContext();
  const { hasFullPieceAccess, canEditProjectPieces } = useAuth();
  if (!ctx.canManage && !ctx.project.allow_participant_pieces) return <NoAccess />;
  const pieceScope: PieceScope = {
    base: `/projects/${ctx.project.id}/pieces`,
    projectId: ctx.project.id,
    canEdit: hasFullPieceAccess || (ctx.canManage && canEditProjectPieces),
    canManageProject: ctx.canManage,
    canDelete: hasFullPieceAccess,
  };
  return <Outlet context={{ ...ctx, pieceScope }} />;
};

// Wraps the management-only pages; participants get the no-access notice.
export const RequireProjectManage = () => {
  const ctx = useProjectContext();
  if (!ctx.canManage) return <NoAccess />;
  return <Outlet context={ctx} />;
};

export const ProjectLayout = () => {
  const { t } = useI18n();
  const { projectId } = useParams();
  const pieceOpen = useMatch('/projects/:projectId/pieces/:pieceId') != null;
  const navigate = useNavigate();
  // Project settings need access to all projects, not just this one.
  const { canManageProjects } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [unrecognizedCount, setUnrecognizedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.from('projects').select('*').eq('id', projectId).maybeSingle(),
      // Management rights for this specific project (admin, or manager whose
      // scope includes it) — evaluated by the same function RLS uses.
      api.rpc('can_access_project', { pid: projectId }),
    ]).then(([proj, manage]) => {
      if (cancelled) return;
      setProject((proj.data as Project) ?? null);
      setCanManage(Boolean(manage.data));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const loadCheckinWarnings = useCallback(async () => {
    if (!projectId) return;
    const { count } = await api
      .from('checkin_submissions')
      .select('id, events!inner(project_id)', { count: 'exact', head: true })
      .eq('events.project_id', projectId)
      .eq('recognized', false);
    setUnrecognizedCount(count ?? 0);
  }, [projectId]);

  useEffect(() => {
    if (!canManage) return;
    void loadCheckinWarnings();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadCheckinWarnings();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [loadCheckinWarnings, canManage]);

  if (loading) return <PageSpinner />;
  if (!project) return <NoAccess standalone />;

  const base = `/projects/${project.id}`;
  // For those with write access: marks the pages participants can open as well.
  const visibleTo = (participants: boolean) =>
    canManage && participants
      ? { access: 'participants' as const, accessLabel: t('pageVisibleToParticipants') }
      : {};

  return (
    <div className="flex h-full">
      <Sidebar>
        <ProjectHeader project={project} onBack={() => navigate('/projects')} />

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <SidebarNavItem
            to={`${base}/participation`}
            label={t('myParticipation')}
            icon={UserRound}
            {...visibleTo(true)}
          />
          {canManage && (
            <SidebarNavItem
              to={`${base}/events`}
              label={t('events')}
              icon={CalendarDays}
              warningCount={unrecognizedCount}
              {...visibleTo(false)}
            />
          )}
          {(canManage || project.allow_participant_pieces) && (
            <SidebarNavItem
              to={`${base}/pieces`}
              label={t('pieces')}
              icon={Music}
              {...visibleTo(project.allow_participant_pieces)}
            />
          )}
          {canManage && (
            <>
              <SidebarNavItem to={`${base}/members`} label={t('members')} icon={Users} {...visibleTo(false)} />
              <SidebarNavItem to={`${base}/groups`} label={t('groupsList')} icon={Tags} {...visibleTo(false)} />
              <SidebarNavItem to={`${base}/registrations`} label={t('registration')} icon={ClipboardList} {...visibleTo(false)} />
              <SidebarNavItem to={`${base}/absences`} label={t('absences')} icon={CalendarX2} {...visibleTo(false)} />
              <SidebarNavItem to={`${base}/statistics`} label={t('statistics')} icon={BarChart3} {...visibleTo(false)} />
              {canManageProjects && (
                <SidebarNavItem to={`${base}/settings`} label={t('settings')} icon={Settings} {...visibleTo(false)} />
              )}
            </>
          )}
        </div>

        <SidebarFooter />
      </Sidebar>

      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        {/* A piece's practice page uses the full width: the score grows with the screen. */}
        <div className={cn('p-4 sm:p-6 lg:p-8', !pieceOpen && 'max-w-[1400px]')}>
          <ProjectGroupsProvider projectId={project.id}>
            <Outlet context={{ project, canManage, reloadProject: () => navigate(0) }} />
          </ProjectGroupsProvider>
        </div>
      </main>
    </div>
  );
};
