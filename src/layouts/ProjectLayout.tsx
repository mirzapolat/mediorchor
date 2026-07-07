import { useCallback, useEffect, useState } from 'react';
import { Navigate, Outlet, useNavigate, useParams } from 'react-router-dom';
import { BarChart3, CalendarDays, CalendarX2, ClipboardList, Music, UserRound, Users, Settings, ArrowLeft } from 'lucide-react';
import { SidebarNavItem } from '@/components/SidebarNav';
import { SidebarFooter } from '@/components/SidebarFooter';
import { Sidebar, useSidebar } from '@/components/Sidebar';
import { Avatar } from '@/components/Avatar';
import { PageSpinner } from '@/components/Spinner';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { useProjectContext } from '@/layouts/projectContext';
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
        {!collapsed && <span className="font-semibold truncate">{project.name}</span>}
      </div>
    </>
  );
};

// Index route: opening a project always starts on "Meine Teilnahme".
export const ProjectIndexRedirect = () => {
  return <Navigate to="participation" replace />;
};

// Wraps the Stücke pages: participants only get in while the project shows
// the pieces page to participants (managers always do).
export const RequirePiecesAccess = () => {
  const ctx = useProjectContext();
  if (!ctx.canManage && !ctx.project.allow_participant_pieces) {
    return <Navigate to={`/projects/${ctx.project.id}/participation`} replace />;
  }
  return <Outlet context={ctx} />;
};

// Wraps the management-only pages; participants are sent to "Meine Teilnahme".
export const RequireProjectManage = () => {
  const ctx = useProjectContext();
  if (!ctx.canManage) {
    return <Navigate to={`/projects/${ctx.project.id}/participation`} replace />;
  }
  return <Outlet context={ctx} />;
};

export const ProjectLayout = () => {
  const { t } = useI18n();
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [unrecognizedCount, setUnrecognizedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).maybeSingle(),
      // Management rights for this specific project (admin, or manager whose
      // scope includes it) — evaluated by the same function RLS uses.
      supabase.rpc('can_access_project', { pid: projectId }),
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
    const { count } = await supabase
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
  if (!project) {
    navigate('/');
    return null;
  }

  const base = `/projects/${project.id}`;

  return (
    <div className="flex h-full">
      <Sidebar>
        <ProjectHeader project={project} onBack={() => navigate('/')} />

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <SidebarNavItem
            to={`${base}/participation`}
            label={t('myParticipation')}
            icon={UserRound}
          />
          {canManage && (
            <>
              <SidebarNavItem
                to={`${base}/events`}
                label={t('events')}
                icon={CalendarDays}
                warningCount={unrecognizedCount}
              />
              <SidebarNavItem to={`${base}/members`} label={t('members')} icon={Users} />
            </>
          )}
          {(canManage || project.allow_participant_pieces) && (
            <SidebarNavItem to={`${base}/pieces`} label={t('pieces')} icon={Music} />
          )}
          {canManage && (
            <>
              <SidebarNavItem to={`${base}/registrations`} label={t('registration')} icon={ClipboardList} />
              <SidebarNavItem to={`${base}/absences`} label={t('absences')} icon={CalendarX2} />
              <SidebarNavItem to={`${base}/statistics`} label={t('statistics')} icon={BarChart3} />
              <SidebarNavItem to={`${base}/settings`} label={t('settings')} icon={Settings} />
            </>
          )}
        </div>

        <SidebarFooter />
      </Sidebar>

      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px]">
          <Outlet context={{ project, canManage, reloadProject: () => navigate(0) }} />
        </div>
      </main>
    </div>
  );
};
