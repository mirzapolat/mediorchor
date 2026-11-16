import { useCallback, useEffect, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { NoAccess } from '@/components/NoAccess';
import { CheckSquare, Settings, CalendarDays, Clock, ListMusic, QrCode } from 'lucide-react';
import { RAIL, SidebarFold, sidebarLabel, useSidebar } from '@/components/Sidebar';
import { MobileContext, NavShell } from '@/components/NavShell';
import { PageSpinner } from '@/components/Spinner';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { ProjectGroupsProvider } from '@/hooks/useProjectGroups';
import { FadingText } from '@/components/FadingText';
import { SidebarBackLink } from '@/components/SidebarBackLink';
import type { Event, Project } from '@/types';

// Date and time of the Probe (sidebar header and mobile context).
const EventMeta = ({ event }: { event: Event }) =>
  event.date || event.time ? (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
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
    </span>
  ) : null;

const EventHeader = ({ event, back, scope }: { event: Event; back: { to: string; label: string }; scope: string }) => {
  const { collapsed } = useSidebar();
  return (
    <>
      <SidebarBackLink fallback={back} scope={scope} />

      <div className={cn('flex flex-shrink-0 items-start gap-2.5 border-b border-border py-3', RAIL.tile)}>
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-muted text-text-secondary">
          <CheckSquare size={16} />
        </span>
        <div className={cn('min-w-0 flex-1 pt-1', sidebarLabel(collapsed))}>
          <FadingText className="block font-semibold">{event.name}</FadingText>
          {(event.date || event.time) && (
            <SidebarFold>
              <div className="mt-1 text-sm text-text-secondary">
                <EventMeta event={event} />
              </div>
            </SidebarFold>
          )}
        </div>
      </div>
    </>
  );
};

// A full sidebar layout for a single event, so opening an event feels like
// entering it (like opening a project). Sidebar pages: Attendance, Programme,
// Check-in, Settings.
export const EventLayout = () => {
  const { t } = useI18n();
  const { projectId, eventId } = useParams();
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
  if (!project || !event) return <NoAccess standalone />;

  const base = `/projects/${project.id}/events/${event.id}`;

  return (
    <NavShell
      header={<EventHeader event={event} back={{ to: `/projects/${project.id}/events`, label: t('events') }} scope={base} />}
      items={[
        { to: base, end: true, label: t('attendance'), icon: CheckSquare },
        { to: `${base}/program`, label: t('program'), icon: ListMusic },
        { to: `${base}/check-in`, label: t('checkIn'), icon: QrCode, warningCount: unrecognizedCount },
        { to: `${base}/settings`, label: t('settings'), icon: Settings },
      ]}
      back={{ to: `/projects/${project.id}/events`, label: t('events') }}
      scope={base}
      context={<MobileContext icon={CheckSquare} title={event.name} meta={<EventMeta event={event} />} />}
    >
      <ProjectGroupsProvider projectId={project.id}>
        <Outlet context={{ project, event, reloadEvent: loadEvent, reloadCheckinWarnings: loadCheckinWarnings }} />
      </ProjectGroupsProvider>
    </NavShell>
  );
};
