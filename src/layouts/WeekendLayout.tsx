import { useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useParams } from 'react-router-dom';
import { ArrowLeft, BedDouble, CalendarDays, MapPin, Tent, UsersRound } from 'lucide-react';
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
import { weekendDates, type Weekend } from '@/lib/weekends';

// One rehearsal weekend, laid out like a Probe or a piece: its own sidebar
// with the weekend's name, dates and place (a click on it opens the
// overview) and exactly two pages — "Teilnehmende" for managers, "Zimmer"
// for managers and the weekend's confirmed participants.
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

  return (
    <NavShell
      header={<WeekendHeader weekend={weekend} dates={dates} base={base} back={back} />}
      items={[
        canManage && { to: `${base}/participants`, label: t('weekendParticipants'), icon: UsersRound },
        (canManage || weekend.me.confirmed) && {
          to: `${base}/rooms`,
          label: t('weekendRooms'),
          icon: BedDouble,
          badge: !canManage && weekend.status === 'published' && weekend.me.confirmed && !weekend.me.room_id ? 1 : 0,
        },
      ]}
      back={back}
      context={
        <Link to={base} className="block">
          <MobileContext
            icon={Tent}
            title={weekend.title}
            meta={[dates, weekend.location].filter(Boolean).join(' · ') || undefined}
          />
        </Link>
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
  base,
  back,
}: {
  weekend: Weekend;
  dates: string | null;
  base: string;
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
      <Link to={base} className={cn('block border-b border-border hover:bg-surface-subtle', collapsed ? 'flex justify-center py-4' : 'px-5 py-4')}>
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
      </Link>
    </>
  );
};
