import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BedDouble, CheckCircle2, ChevronRight, CircleDashed, MapPin, PencilLine } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { EventWhen } from '@/components/EventWhen';
import { StatusBadge } from '@/components/StatusBadge';
import { useI18n } from '@/lib/i18n';
import { localeOf } from '@shared/languages';
import { localToday } from '@/lib/eventTiming';
import { EventProgram } from '@/components/EventProgram';
import { weekendDates } from '@/lib/weekends';
import {
  CONCERTS_PREVIEW,
  PROJECTS_PREVIEW,
  REHEARSALS_PREVIEW,
  SURVEYS_PREVIEW,
  WEEKENDS_PREVIEW,
  type RoomTask,
  type SurveyTask,
  type UpcomingConcert,
  type UpcomingRehearsal,
  type UpcomingWeekend,
} from '@/lib/dashboard';
import { cn } from '@/lib/cn';
import type { AttendanceDisplayStatus, Event, Project } from '@/types';

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
    new Date(`${date}T00:00:00`).toLocaleDateString(localeOf(lang), {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    });

  return (
    <>
      <ul className="-mx-2">
        {projects.slice(0, PROJECTS_PREVIEW).map((p) => {
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
      <MoreLink hidden={projects.length - PROJECTS_PREVIEW} />
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
        {rehearsals.slice(0, REHEARSALS_PREVIEW).map(({ event: e, project, status, program }, i) => {
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
          // The programme's pieces are links of their own, so they sit below
          // the Probe's link rather than inside it.
          return (
            <li key={e.id} className="pb-1">
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
              <div className="px-2">
                <EventProgram projectId={project.id} note={e.program_note} items={program} />
              </div>
            </li>
          );
        })}
      </ul>
      <MoreLink hidden={rehearsals.length - REHEARSALS_PREVIEW} />
    </>
  );
};

// Whole days from today to an ISO date (negative once it has passed).
const daysUntil = (iso: string, today: string) =>
  Math.round((Date.parse(`${iso}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86_400_000);

// "Heute", "Morgen", "in 5 Tagen" — only for the next few weeks.
const useSoon = () => {
  const { t } = useI18n();
  const today = localToday();
  return (date: string) => {
    const days = daysUntil(date, today);
    if (days <= 0) return t('today');
    if (days === 1) return t('tomorrow');
    if (days <= 30) return t('inDays').replace('{n}', String(days));
    return null;
  };
};

// One dated entry of the weekend and concert widgets: a date tile (the
// soonest one in the accent), title with how soon, the when and the project.
const DatedRow = ({
  to,
  date,
  title,
  soon,
  first,
  meta,
  project,
}: {
  to: string;
  date: string;
  title: string;
  soon: string | null;
  first: boolean;
  meta: ReactNode;
  project: Project;
}) => {
  const { lang } = useI18n();
  const d = new Date(`${date}T00:00:00`);
  return (
    <li>
      <Link
        to={to}
        className="group flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-surface-subtle"
      >
        <span
          className={cn(
            'flex h-11 w-11 flex-shrink-0 flex-col items-center justify-center rounded-xl leading-none',
            first ? 'bg-accent/15 text-accent' : 'bg-surface-muted text-text-secondary',
          )}
        >
          <span className="text-base font-bold">{d.getDate()}</span>
          <span className="mt-0.5 text-[10px] font-semibold uppercase">
            {d.toLocaleDateString(localeOf(lang), { month: 'short' })}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 truncate font-medium" title={title}>
              {title}
            </span>
            {soon && (
              <span
                className={cn(
                  'flex-shrink-0 rounded-full px-2 py-px text-xs font-semibold',
                  first ? 'bg-success-soft-strong text-success-strong' : 'bg-surface-muted text-text-secondary',
                )}
              >
                {soon}
              </span>
            )}
          </span>
          <span className="block truncate text-sm text-text-secondary">{meta}</span>
          <span className="mt-1 flex items-center gap-1.5 text-xs text-text-tertiary">
            <Avatar name={project.name} photoUrl={project.image_url} size={16} square />
            <span className="truncate">{project.name}</span>
          </span>
        </span>
        <ChevronRight
          size={16}
          className="flex-shrink-0 text-text-tertiary transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-text-secondary"
        />
      </Link>
    </li>
  );
};

// "Probenwochenenden": the published weekends of the account's projects that
// haven't ended yet; each opens its overview.
export const UpcomingWeekendsWidget = ({ weekends }: { weekends: UpcomingWeekend[] }) => {
  const { t, lang } = useI18n();
  const soon = useSoon();
  const today = localToday();
  if (weekends.length === 0) return <p className="py-2 text-sm text-text-tertiary">{t('noUpcomingWeekends')}</p>;
  return (
    <>
      <ul className="-mx-2">
        {weekends.slice(0, WEEKENDS_PREVIEW).map((w, i) => (
          <DatedRow
            key={w.id}
            to={`/projects/${w.project.id}/weekend/${w.id}`}
            date={w.starts_on!}
            title={w.title}
            soon={w.starts_on! < today ? t('weekendRunning') : soon(w.starts_on!)}
            first={i === 0}
            meta={[weekendDates(w, lang), w.location].filter(Boolean).join(' · ')}
            project={w.project}
          />
        ))}
      </ul>
      <MoreLink hidden={weekends.length - WEEKENDS_PREVIEW} />
    </>
  );
};

// "Konzerte": the next published concerts of the account's projects; each
// opens the concert.
export const UpcomingConcertsWidget = ({ concerts }: { concerts: UpcomingConcert[] }) => {
  const { t, lang } = useI18n();
  const soon = useSoon();
  if (concerts.length === 0) return <p className="py-2 text-sm text-text-tertiary">{t('noUpcomingConcerts')}</p>;
  const day = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(localeOf(lang), { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <>
      <ul className="-mx-2">
        {concerts.slice(0, CONCERTS_PREVIEW).map((c, i) => (
          <DatedRow
            key={c.id}
            to={`/projects/${c.project.id}/concerts/${c.id}`}
            date={c.date!}
            title={c.title}
            soon={soon(c.date!)}
            first={i === 0}
            meta={
              <>
                {[day(c.date!), c.time && (c.end_time ? `${c.time}–${c.end_time}` : c.time)].filter(Boolean).join(' · ')}
                {c.location && (
                  <>
                    {' · '}
                    <MapPin size={12} className="inline align-[-1px]" /> {c.location}
                  </>
                )}
              </>
            }
            project={c.project}
          />
        ))}
      </ul>
      <MoreLink hidden={concerts.length - CONCERTS_PREVIEW} />
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

// "Aktive Umfragen": open listed surveys meant for the account, across its
// projects — unfinished first, with project, deadline and its own state.
// Answered ones step back after a short while (folded into "Erledigt").
export const ActiveSurveysWidget = ({ surveys, rooms = [] }: { surveys: SurveyTask[]; rooms?: RoomTask[] }) => {
  const { t, lang } = useI18n();
  const [showDone, setShowDone] = useState(false);
  // Answered within the last hours: still shown as a short confirmation.
  const recent = (s: SurveyTask) =>
    Boolean(s.answered_at && s.answered_at.length > 10 && Date.now() - Date.parse(s.answered_at) < 6 * 3600_000);
  const open = surveys.filter((s) => s.my !== 'answered' || recent(s));
  const done = surveys.filter((s) => s.my === 'answered' && !recent(s));
  const projects = [...new Map(surveys.map((s) => [s.project.id, s.project])).values()];
  // A missing room choice is a to-do of the same kind.
  const roomRows = rooms.map((r) => (
    <li key={r.weekend_id}>
      <Link
        to={`/projects/${r.project.id}/weekend/${r.weekend_id}/rooms`}
        className="group flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-surface-subtle"
      >
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <BedDouble size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{t('roomTaskTitle').replace('{title}', r.title)}</span>
          <span className="block truncate text-xs text-text-tertiary">{r.project.name}</span>
        </span>
        <ChevronRight size={16} className="flex-shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  ));
  if (surveys.length === 0 && rooms.length === 0) {
    return <p className="py-2 text-sm text-text-tertiary">{t('noOpenSurveys')}</p>;
  }
  if (surveys.length === 0) return <ul className="-mx-2">{roomRows}</ul>;

  const row = (s: SurveyTask) => {
    const soon = s.closes_at && Date.parse(s.closes_at) - Date.now() < 3 * 86_400_000;
    const status =
      s.my === 'answered'
        ? { icon: CheckCircle2, label: t('surveyAnswered'), tone: 'text-success-strong' }
        : s.my === 'draft'
          ? { icon: PencilLine, label: t('surveyDraftMine'), tone: 'text-text' }
          : { icon: CircleDashed, label: t('surveyNotStarted'), tone: 'text-text-secondary' };
    return (
      <li key={s.form_id}>
        <Link
          to={`/f/${s.token}`}
          className="group flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-surface-subtle"
        >
          <Avatar name={s.project.name} photoUrl={s.project.image_url} size={32} square />
          <span className="min-w-0 flex-1">
            <span className={cn('block truncate font-medium', s.my === 'answered' && 'text-text-secondary')}>{s.title}</span>
            <span className="flex flex-wrap items-center gap-x-2 text-xs">
              <span className={cn('inline-flex items-center gap-1', status.tone)}>
                <status.icon size={12} />
                {status.label}
              </span>
              <span className="truncate text-text-tertiary">{s.project.name}</span>
              {s.closes_at && s.my !== 'answered' && (
                <span className={cn(soon ? 'font-medium text-text' : 'text-text-tertiary')}>
                  {soon && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />}
                  {t('surveyClosesShort').replace(
                    '{date}',
                    new Date(s.closes_at).toLocaleDateString(localeOf(lang), { day: 'numeric', month: 'short' }),
                  )}
                </span>
              )}
            </span>
          </span>
          <ChevronRight size={16} className="flex-shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5" />
        </Link>
      </li>
    );
  };

  return (
    <>
      {roomRows.length > 0 && <ul className="-mx-2">{roomRows}</ul>}
      {open.length === 0 ? (
        <p className="py-2 text-sm text-text-tertiary">{t('allSurveysAnswered')}</p>
      ) : (
        <ul className="-mx-2">{open.slice(0, SURVEYS_PREVIEW).map(row)}</ul>
      )}
      {done.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className="text-xs font-medium text-text-tertiary hover:text-text-secondary"
          >
            {t('surveysDone').replace('{n}', String(done.length))}
          </button>
          {showDone && <ul className="-mx-2 mt-1">{done.map(row)}</ul>}
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-x-4 border-t border-border pt-3">
        {projects.map((p) => (
          <Link
            key={p.id}
            to={`/projects/${p.id}/surveys`}
            className="inline-flex items-center gap-1 text-sm font-medium text-text-secondary hover:text-text"
          >
            {projects.length > 1 ? `${t('allSurveys')} · ${p.name}` : t('allSurveys')}
            <ChevronRight size={14} />
          </Link>
        ))}
      </div>
    </>
  );
};
