import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useParams } from 'react-router-dom';
import { ArrowLeft, BedDouble, CalendarDays, FileText, MapPin, Settings, Tent, UsersRound } from 'lucide-react';
import { useSidebar } from '@/components/Sidebar';
import { MobileContext, NavShell } from '@/components/NavShell';
import { FadingText } from '@/components/FadingText';
import { PageSpinner } from '@/components/Spinner';
import { NoAccess } from '@/components/NoAccess';
import { useProjectContext } from '@/layouts/projectContext';
import { ProjectGroupsProvider } from '@/hooks/useProjectGroups';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useWeekendContext, weekendDates, type Weekend } from '@/lib/weekends';

// One rehearsal weekend, laid out like a Probe or a piece: its own sidebar
// with the weekend's name, dates and place, and its pages — "Details" once
// released, "Teilnehmende" for managers, "Zimmer" for managers and (once
// released) the weekend's confirmed participants, "Einstellungen" for
// managers.
// Which pages a person has in a weekend.
const weekendPages = (weekend: Weekend, canManage: boolean) => ({
  details: canManage || weekend.details_published,
  participants: canManage,
  rooms: canManage || (weekend.me.confirmed && weekend.rooms_status !== 'hidden'),
  settings: canManage,
});

// The weekend's address alone opens its first page.
export const WeekendIndex = () => {
  const { weekend, canManage } = useWeekendContext();
  const pages = weekendPages(weekend, canManage);
  const first = (['details', 'rooms'] as const).find((p) => pages[p]);
  return first ? <Navigate to={first} replace /> : <NoAccess />;
};

export const WeekendLayout = () => {
  const { t, lang } = useI18n();
  const ctx = useProjectContext();
  const { project, canManage } = ctx;
  const { weekendId } = useParams();
  const [weekend, setWeekend] = useState<Weekend | null | undefined>(undefined);
  const [single, setSingle] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.rpc('weekend_list', { p_project_id: project.id });
    const list = (data as Weekend[] | null) ?? [];
    setWeekend(list.find((w) => w.id === weekendId) ?? null);
    setSingle(list.filter((w) => !w.archived).length === 1);
  }, [project.id, weekendId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (weekend === undefined) return <PageSpinner />;
  if (!weekend) return <NoAccess standalone />;

  const base = `/projects/${project.id}/weekend/${weekend.id}`;
  // A participant with just this weekend has no list to go back to.
  const back = !canManage && single ? { to: `/projects/${project.id}`, label: project.name } : { to: `/projects/${project.id}/weekend`, label: t('weekend') };
  const dates = weekendDates(weekend, lang);
  const pages = weekendPages(weekend, canManage);

  return (
    <NavShell
      header={<WeekendHeader weekend={weekend} dates={dates} back={back} />}
      items={[
        pages.details && { to: `${base}/details`, label: t('weekendDetails'), icon: FileText },
        pages.participants && { to: `${base}/participants`, label: t('weekendParticipants'), icon: UsersRound },
        pages.rooms && {
          to: `${base}/rooms`,
          label: t('weekendRooms'),
          icon: BedDouble,
          badge: !canManage && weekend.rooms_status === 'open' && weekend.me.confirmed && !weekend.me.room_id ? 1 : 0,
        },
        pages.settings && { to: `${base}/settings`, label: t('settings'), icon: Settings },
      ]}
      back={back}
      context={
        <MobileContext
          icon={Tent}
          title={weekend.title}
          meta={[dates, weekend.location].filter(Boolean).join(' · ') || undefined}
        />
      }
      contentClassName="max-w-[1100px] p-4 sm:p-6 lg:p-8"
    >
      <ProjectGroupsProvider projectId={project.id}>
        <Outlet context={{ ...ctx, weekend, reloadWeekend: load }} />
      </ProjectGroupsProvider>
    </NavShell>
  );
};

const WeekendHeader = ({
  weekend,
  dates,
  back,
}: {
  weekend: Weekend;
  dates: string | null;
  back: { to: string; label: string };
}) => {
  const { collapsed } = useSidebar();
  return (
    <>
      <Link
        to={back.to}
        title={collapsed ? back.label : undefined}
        className={cn(
          'flex h-14 items-center border-b border-border text-sm font-medium text-text-secondary transition-colors hover:text-text',
          collapsed ? 'justify-center px-0' : 'gap-2 px-5',
        )}
      >
        <ArrowLeft size={16} />
        {!collapsed && <FadingText>{back.label}</FadingText>}
      </Link>
      <div className={cn('border-b border-border', collapsed ? 'flex justify-center py-4' : 'px-5 py-4')}>
        {collapsed ? (
          <Tent size={20} className="text-text-secondary" />
        ) : (
          <>
            <FadingText className="block font-semibold">{weekend.title}</FadingText>
            {dates && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-text-secondary">
                <CalendarDays size={13} />
                {dates}
              </p>
            )}
            {weekend.location && (
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-text-secondary">
                <MapPin size={13} className="flex-shrink-0" />
                <span className="truncate">{weekend.location}</span>
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
};
