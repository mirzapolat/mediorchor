import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { EventWhen } from '@/components/EventWhen';
import { StatusBadge } from '@/components/StatusBadge';
import { useI18n } from '@/lib/i18n';
import { localToday } from '@/lib/eventTiming';
import type { UpcomingRehearsal } from '@/lib/dashboard';
import type { AttendanceDisplayStatus, Event, Project } from '@/types';

// Entries per widget; the rest is on the projects page.
const PREVIEW = 4;

// "Teilnahme": the active projects the account takes part in.
export const ParticipationWidget = ({
  projects,
  nextByProject,
}: {
  projects: Project[];
  nextByProject: Map<string, Event>;
}) => {
  const { t, lang } = useI18n();
  if (projects.length === 0) return <p className="py-2 text-sm text-text-tertiary">{t('noActiveParticipation')}</p>;

  const day = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    });

  return (
    <>
      <ul className="-mx-2">
        {projects.slice(0, PREVIEW).map((p) => {
          const next = nextByProject.get(p.id);
          return (
            <li key={p.id}>
              <Link
                to={`/projects/${p.id}`}
                className="group flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-surface-subtle"
              >
                <Avatar name={p.name} photoUrl={p.image_url} size={36} square />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-sm text-text-secondary">
                    {next?.date ? `${t('nextRehearsal')}: ${day(next.date)}` : t('noUpcomingEvents')}
                  </span>
                </span>
                <ChevronRight
                  size={16}
                  className="flex-shrink-0 text-text-tertiary transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-text-secondary"
                />
              </Link>
            </li>
          );
        })}
      </ul>
      <MoreLink hidden={projects.length - PREVIEW} />
    </>
  );
};

// "Nächste Proben": the next Proben across all of the account's projects; each
// opens "Meine Teilnahme" of its project.
export const UpcomingRehearsalsWidget = ({ rehearsals }: { rehearsals: UpcomingRehearsal[] }) => {
  const { t, lang } = useI18n();
  const today = localToday();
  if (rehearsals.length === 0) return <p className="py-2 text-sm text-text-tertiary">{t('noUpcomingEvents')}</p>;

  return (
    <>
      <ul className="-mx-2">
        {rehearsals.slice(0, PREVIEW).map(({ event: e, project, status }, i) => {
          // As on "Meine Teilnahme": excused, or marked present ("expected";
          // today: checked in). "Absent" isn't shown, nothing has happened yet.
          const recorded: AttendanceDisplayStatus | null =
            status === 'excused'
              ? 'excused'
              : status === 'attended'
                ? e.date === today
                  ? 'attended'
                  : 'expected'
                : null;
          return (
            <li key={e.id}>
              <Link
                to={`/projects/${project.id}/participation`}
                className="flex items-start gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-surface-subtle"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium leading-snug break-words">{e.name}</span>
                    {i === 0 && (
                      <span className="rounded-md bg-success-soft-strong px-2 py-0.5 text-xs font-semibold text-success-strong">
                        {e.date === today ? t('todayRehearsal') : t('nextRehearsal')}
                      </span>
                    )}
                  </span>
                  <EventWhen
                    date={e.date}
                    time={e.end_time && e.time ? `${e.time}–${e.end_time}` : e.time}
                    location={e.location}
                    lang={lang}
                  />
                  <span className="mt-1.5 flex items-center gap-1.5 text-xs text-text-tertiary">
                    <Avatar name={project.name} photoUrl={project.image_url} size={16} square />
                    <span className="truncate">{project.name}</span>
                  </span>
                </span>
                {recorded && (
                  <span className="shrink-0">
                    <StatusBadge status={recorded} />
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <MoreLink hidden={rehearsals.length - PREVIEW} />
    </>
  );
};

// "Show more (n)" to the projects page; nothing when the widget shows it all.
const MoreLink = ({ hidden }: { hidden: number }) => {
  const { t } = useI18n();
  if (hidden <= 0) return null;
  return (
    <Link
      to="/projects"
      className="mt-1 flex w-full items-center justify-center gap-1.5 border-t border-border pt-3 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
    >
      {t('showMore')} ({hidden})
      <ChevronRight size={16} />
    </Link>
  );
};
