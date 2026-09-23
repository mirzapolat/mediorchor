import { useCallback, useEffect, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { CheckSquare, Settings, ArrowLeft, CalendarDays, Clock, QrCode } from 'lucide-react';
import { SidebarNavItem } from '@/components/SidebarNav';
import { SidebarFooter } from '@/components/SidebarFooter';
import { Sidebar, useSidebar } from '@/components/Sidebar';
import { PageSpinner } from '@/components/Spinner';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { ProjectGroupsProvider } from '@/hooks/useProjectGroups';
import type { Event, Project } from '@/types';

const EventHeader = ({ event, onBack }: { event: Event; onBack: () => void }) => {
  const { t } = useI18n();
  const { collapsed } = useSidebar();
  return (
    <>
      <button
        onClick={onBack}
        title={collapsed ? t('events') : undefined}
        className={cn(
          'flex items-center h-14 border-b border-border text-sm font-medium text-text-secondary hover:text-text transition-colors duration-150',
          collapsed ? 'justify-center px-0' : 'gap-2 px-5',
        )}
      >
        <ArrowLeft size={16} />
        {!collapsed && <span>{t('events')}</span>}
      </button>

      {collapsed ? (
        <div className="flex items-center justify-center py-4 border-b border-border">
          <CheckSquare size={20} className="text-text-secondary" />
        </div>
      ) : (
        <div className="px-5 py-4 border-b border-border">
          <p className="font-semibold truncate">{event.name}</p>
          {(event.date || event.time) && (
            <div className="flex items-center gap-3 text-sm text-text-secondary mt-1">
              {event.date && (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays size={13} />
                  {event.date}
                </span>
              )}
              {event.time && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock size={13} />
                  {event.time}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
};

// A full sidebar layout for a single event, so opening an event feels like
// entering it (like opening a project). Sidebar pages: Attendance, Settings.
export const EventLayout = () => {
  const { t } = useI18n();
  const { projectId, eventId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [unrecognizedCount, setUnrecognizedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadEvent = useCallback(async () => {
    const { data } = await api.from('events').select('*').eq('id', eventId).maybeSingle();
    setEvent((data as Event) ?? null);
  }, [eventId]);

  const loadCheckinWarnings = useCallback(async () => {
    if (!eventId) return;
    const { count } = await api
      .from('checkin_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('recognized', false);
    setUnrecognizedCount(count ?? 0);
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.from('projects').select('*').eq('id', projectId).maybeSingle(),
      api.from('events').select('*').eq('id', eventId).maybeSingle(),
      // Event administration is management-only; participants see events on
      // their participation page instead.
      api.rpc('can_access_project', { pid: projectId }),
    ]).then(([proj, ev, manage]) => {
      if (cancelled) return;
      setProject(manage.data ? ((proj.data as Project) ?? null) : null);
      setEvent((ev.data as Event) ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, eventId]);

  useEffect(() => {
    void loadCheckinWarnings();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadCheckinWarnings();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [loadCheckinWarnings]);

  if (loading) return <PageSpinner />;
  if (!project || !event) {
    navigate(`/projects/${projectId}`);
    return null;
  }

  const base = `/projects/${project.id}/events/${event.id}`;

  return (
    <div className="flex h-full">
      <Sidebar>
        <EventHeader event={event} onBack={() => navigate(`/projects/${project.id}/events`)} />

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <SidebarNavItem to={base} end label={t('attendance')} icon={CheckSquare} />
          <SidebarNavItem
            to={`${base}/check-in`}
            label={t('checkIn')}
            icon={QrCode}
            warningCount={unrecognizedCount}
          />
          <SidebarNavItem to={`${base}/settings`} label={t('settings')} icon={Settings} />
        </div>

        <SidebarFooter />
      </Sidebar>

      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px]">
          <ProjectGroupsProvider projectId={project.id}>
            <Outlet
              context={{ project, event, reloadEvent: loadEvent, reloadCheckinWarnings: loadCheckinWarnings }}
            />
          </ProjectGroupsProvider>
        </div>
      </main>
    </div>
  );
};
