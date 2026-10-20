import { useCallback, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useMatch, useNavigate, useParams } from 'react-router-dom';
import { CreatedSummary } from '@/pages/ProjectOnboardingPage';
import { BarChart3, CalendarDays, CalendarX2, ClipboardList, ListChecks, Music, Music2, Tags, Tent, UserRound, Users, Settings, ArrowLeft } from 'lucide-react';
import { useSidebar } from '@/components/Sidebar';
import { MobileContext, NavShell } from '@/components/NavShell';
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

// What project_nav (server/projectNav.ts) says about the newer areas.
interface ProjectNav {
  concerts: boolean;
  surveys: boolean;
  // One's own listed surveys still to answer (a quiet badge).
  open_surveys: number;
  weekend: boolean;
  // Confirmed for a published weekend but no room chosen yet.
  room_missing: number;
}
const EMPTY_NAV: ProjectNav = { concerts: false, surveys: false, open_surveys: 0, weekend: false, room_missing: 0 };

// Without `onBack` (a participant of a single project) there is no project
// list to go back to.
const ProjectHeader = ({ project, onBack }: { project: Project; onBack?: () => void }) => {
  const { t } = useI18n();
  const { collapsed } = useSidebar();
  return (
    <>
      {onBack && (
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
      )}

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

// Index route: opening a project starts on "Meine Teilnahme" — or, for the
// music director who takes part in no project, on its Proben.
export const ProjectIndexRedirect = () => {
  const { canParticipate } = useAuth();
  return <Navigate to={canParticipate ? 'participation' : 'events'} replace />;
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

// Wraps Umfragen, Probenwochenende and Konzerte: participants only get in
// while the project shows that area (managers always do).
export const RequireProjectArea = ({ area }: { area: 'show_surveys' | 'show_weekend' | 'show_concerts' }) => {
  const ctx = useProjectContext();
  if (!ctx.canManage && !ctx.project[area]) return <NoAccess />;
  return <Outlet context={ctx} />;
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
  // An open piece brings its own sidebar (PieceLayout), or none in the
  // full-screen trainer: the project's is left out.
  const pieceOpen = useMatch('/projects/:projectId/pieces/:pieceId/*') != null;
  // An open rehearsal weekend brings its own sidebar too (WeekendLayout).
  const weekendOpen = useMatch('/projects/:projectId/weekend/:weekendId/*') != null;
  const navigate = useNavigate();
  // Project settings need access to all projects, not just this one.
  const { canManageProjects, canParticipate, soleProjectId } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [unrecognizedCount, setUnrecognizedCount] = useState(0);
  const [nav, setNav] = useState<ProjectNav>(EMPTY_NAV);
  // What the project set-up created (once, right after it).
  const location = useLocation();
  const [created, setCreated] = useState<Record<string, number> | null>(
    () => (location.state as { created?: Record<string, number> } | null)?.created ?? null,
  );
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

  // Which of the newer areas the caller sees, and their quiet counts.
  const loadNav = useCallback(async () => {
    if (!projectId) return;
    const { data } = await api.rpc('project_nav', { p_project_id: projectId });
    setNav({ ...EMPTY_NAV, ...((data as Partial<ProjectNav> | null) ?? {}) });
  }, [projectId]);

  useEffect(() => {
    void loadNav();
  }, [loadNav]);

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

  if (pieceOpen || weekendOpen) {
    return (
      <div className="h-full overflow-y-auto">
        <ProjectGroupsProvider projectId={project.id}>
          <Outlet context={{ project, canManage, reloadProject: () => navigate(0), reloadNav: loadNav }} />
        </ProjectGroupsProvider>
      </div>
    );
  }

  return (
    <NavShell
      header={<ProjectHeader project={project} onBack={soleProjectId ? undefined : () => navigate('/projects')} />}
      items={[
        canParticipate && {
          to: `${base}/participation`,
          label: t('myParticipation'),
          icon: UserRound,
          ...visibleTo(true),
        },
        canManage && {
          to: `${base}/events`,
          label: t('events'),
          icon: CalendarDays,
          warningCount: unrecognizedCount,
          ...visibleTo(false),
        },
        (canManage || project.allow_participant_pieces) && {
          to: `${base}/pieces`,
          label: t('pieces'),
          icon: Music,
          ...visibleTo(project.allow_participant_pieces),
        },
        (canManage || nav.weekend) && {
          to: `${base}/weekend`,
          label: t('weekend'),
          icon: Tent,
          badge: nav.room_missing,
          ...visibleTo(project.show_weekend),
        },
        (canManage || nav.concerts) && {
          to: `${base}/concerts`,
          label: t('concerts'),
          icon: Music2,
          ...visibleTo(project.show_concerts),
        },
        (canManage || nav.surveys) && {
          to: `${base}/surveys`,
          label: t('surveys'),
          icon: ListChecks,
          badge: nav.open_surveys,
          ...visibleTo(project.show_surveys),
        },
        canManage && { to: `${base}/members`, label: t('members'), icon: Users, ...visibleTo(false) },
        canManage && { to: `${base}/groups`, label: t('groupsList'), icon: Tags, ...visibleTo(false) },
        canManage && { to: `${base}/registrations`, label: t('registration'), icon: ClipboardList, ...visibleTo(false) },
        canManage && { to: `${base}/absences`, label: t('absences'), icon: CalendarX2, ...visibleTo(false) },
        canManage && { to: `${base}/statistics`, label: t('statistics'), icon: BarChart3, ...visibleTo(false) },
        canManage &&
          canManageProjects && { to: `${base}/settings`, label: t('settings'), icon: Settings, ...visibleTo(false) },
      ]}
      // A participant of a single project has no project list to go back to.
      back={soleProjectId ? null : { to: '/projects', label: t('projects') }}
      context={
        <MobileContext
          image={<Avatar name={project.name} photoUrl={project.image_url} size={40} square />}
          title={project.name}
        />
      }
    >
      {created && <CreatedSummary summary={created} onClose={() => setCreated(null)} />}
      <ProjectGroupsProvider projectId={project.id}>
        <Outlet context={{ project, canManage, reloadProject: () => navigate(0), reloadNav: loadNav }} />
      </ProjectGroupsProvider>
    </NavShell>
  );
};
