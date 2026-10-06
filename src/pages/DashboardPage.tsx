import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  Eye,
  EyeOff,
  FolderKanban,
  GripVertical,
  Mail,
  Megaphone,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { PageSpinner } from '@/components/Spinner';
import { Card } from '@/components/Card';
import { HeaderAction } from '@/components/HeaderAction';
import { ParticipationWidget, UpcomingRehearsalsWidget } from '@/components/dashboard/DashboardWidgets';
import { loadDashboardData, type DashboardData } from '@/lib/dashboard';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { DashboardWidgetState } from '@/types';

type WidgetId = 'participation' | 'upcoming';

// Every widget, in its default order. A widget added here later shows up on
// everyone's dashboard after the ones they arranged.
const WIDGETS: { id: WidgetId; title: TranslationKey; icon: LucideIcon }[] = [
  { id: 'participation', title: 'widgetParticipation', icon: FolderKanban },
  { id: 'upcoming', title: 'widgetUpcoming', icon: CalendarClock },
];

// The saved layout with unknown or repeated entries dropped and new widgets added.
const resolveLayout = (saved: unknown): DashboardWidgetState[] => {
  const known = new Set<string>(WIDGETS.map((w) => w.id));
  const seen = new Set<string>();
  const layout: DashboardWidgetState[] = [];
  for (const entry of Array.isArray(saved) ? saved : []) {
    const id = (entry as DashboardWidgetState | null)?.id;
    if (typeof id !== 'string' || !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    layout.push({ id, hidden: Boolean((entry as DashboardWidgetState).hidden) });
  }
  for (const w of WIDGETS) if (!seen.has(w.id)) layout.push({ id: w.id, hidden: false });
  return layout;
};

// Each account's own dashboard: boxed widgets in two columns on desktop, one
// stream on phones. "Customize" reorders (drag, or the arrows) and hides them;
// the layout is stored on the account.
export const DashboardPage = () => {
  const { t } = useI18n();
  const { user, refreshUser } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [layout, setLayout] = useState(() => resolveLayout(user?.dashboard_layout));
  const [editing, setEditing] = useState(false);
  const dragging = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    if (user) void loadDashboardData(user.id).then(setData);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(
    async (next: DashboardWidgetState[]) => {
      if (!user) return;
      await api.from('app_users').update({ dashboard_layout: next }).eq('id', user.id);
      void refreshUser();
    },
    [user, refreshUser],
  );

  const update = (next: DashboardWidgetState[]) => {
    setLayout(next);
    void save(next);
  };

  const move = (id: string, offset: number) => {
    const from = layout.findIndex((w) => w.id === id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= layout.length) return;
    const next = [...layout];
    [next[from], next[to]] = [next[to], next[from]];
    update(next);
  };

  const toggleHidden = (id: string) =>
    update(layout.map((w) => (w.id === id ? { ...w, hidden: !w.hidden } : w)));

  // Drag and drop (desktop): the dragged widget takes the place of the one it
  // is dragged over; the order is saved once it's dropped.
  const onDragStart = (id: string) => (e: DragEvent) => {
    dragging.current = id;
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };
  const onDragOver = (id: string) => (e: DragEvent) => {
    const source = dragging.current;
    if (!source) return;
    e.preventDefault();
    if (source === id) return;
    setLayout((current) => {
      const from = current.findIndex((w) => w.id === source);
      const to = current.findIndex((w) => w.id === id);
      const next = [...current];
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
  };
  const onDragEnd = () => {
    dragging.current = null;
    setDraggingId(null);
    void save(layout);
  };

  if (!user || !data) return <PageSpinner />;

  const hasProjects = data.memberships > 0;
  const shown = editing ? layout : layout.filter((w) => !w.hidden);

  const body = (id: WidgetId): ReactNode =>
    id === 'participation' ? (
      <ParticipationWidget projects={data.projects} nextByProject={data.nextByProject} />
    ) : (
      <UpcomingRehearsalsWidget rehearsals={data.upcoming} />
    );

  return (
    <>
      <PageHeader
        title={t('dashboard')}
        subtitle={user.first_name ? t('dashboardGreeting').replace('{name}', user.first_name) : undefined}
        inlineActions
        actions={
          hasProjects ? (
            <HeaderAction
              icon={editing ? Check : SlidersHorizontal}
              label={editing ? t('done') : t('customizeDashboard')}
              variant={editing ? 'primary' : 'secondary'}
              onClick={() => setEditing((v) => !v)}
            />
          ) : undefined
        }
      />

      {!hasProjects ? (
        <NoProjectsNotice email={user.email} />
      ) : (
        <>
          {editing && <p className="mb-4 text-sm text-text-secondary">{t('customizeDashboardHint')}</p>}
          {shown.length === 0 ? (
            <Card className="text-center">
              <p className="text-sm text-text-secondary">{t('dashboardAllHidden')}</p>
            </Card>
          ) : (
            <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-2">
              {shown.map((state, index) => {
                const widget = WIDGETS.find((w) => w.id === state.id)!;
                const title = t(widget.title);
                return (
                  <section
                    key={widget.id}
                    aria-label={title}
                    draggable={editing}
                    onDragStart={editing ? onDragStart(widget.id) : undefined}
                    onDragOver={editing ? onDragOver(widget.id) : undefined}
                    onDragEnd={editing ? onDragEnd : undefined}
                    className={cn(
                      'rounded-md border bg-surface',
                      editing ? 'border-dashed border-text-tertiary' : 'border-border',
                      draggingId === widget.id && 'opacity-50',
                    )}
                  >
                    <header className="flex items-center gap-2 px-5 pt-4 max-sm:px-4">
                      {editing && (
                        <GripVertical
                          size={16}
                          aria-hidden
                          className="flex-shrink-0 cursor-grab text-text-tertiary max-lg:hidden"
                        />
                      )}
                      <widget.icon size={17} className="flex-shrink-0 text-text-secondary" />
                      <h2
                        className={cn(
                          'min-w-0 flex-1 truncate text-base font-medium',
                          state.hidden && 'text-text-tertiary',
                        )}
                      >
                        {title}
                      </h2>
                      {editing && (
                        <div className="flex flex-shrink-0 items-center">
                          <WidgetButton
                            label={`${t('moveUp')}: ${title}`}
                            disabled={index === 0}
                            onClick={() => move(widget.id, -1)}
                          >
                            <ArrowUp size={15} />
                          </WidgetButton>
                          <WidgetButton
                            label={`${t('moveDown')}: ${title}`}
                            disabled={index === shown.length - 1}
                            onClick={() => move(widget.id, 1)}
                          >
                            <ArrowDown size={15} />
                          </WidgetButton>
                          <WidgetButton
                            label={`${state.hidden ? t('showWidget') : t('hideWidget')}: ${title}`}
                            onClick={() => toggleHidden(widget.id)}
                          >
                            {state.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                          </WidgetButton>
                        </div>
                      )}
                    </header>
                    {state.hidden ? (
                      <p className="px-5 pb-4 pt-1 text-sm text-text-tertiary max-sm:px-4">{t('widgetHidden')}</p>
                    ) : (
                      <div className="px-5 pb-4 pt-1 max-sm:px-4">{body(widget.id)}</div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
};

const WidgetButton = ({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-30"
  >
    {children}
  </button>
);

// Shown instead of the widgets while the account takes part in no project.
const NoProjectsNotice = ({ email }: { email: string }) => {
  const { t } = useI18n();
  return (
    <Card className="max-w-2xl space-y-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
          <Users size={19} />
        </span>
        <div>
          <h2 className="text-base font-medium">{t('noProjectsTitle')}</h2>
          <p className="mt-1 text-sm text-text-secondary">{t('noProjectsHint')}</p>
        </div>
      </div>
      <ol className="space-y-4 border-t border-border pt-5">
        <li className="flex items-start gap-3">
          <Mail size={17} className="mt-0.5 flex-shrink-0 text-text-secondary" />
          <div className="text-sm">
            <p className="font-medium">{t('noProjectsEmailTitle')}</p>
            <p className="mt-0.5 text-text-secondary">
              {t('noProjectsEmailHint')} <span className="font-medium text-text">{email}</span>
            </p>
            <Link
              to="/account/security"
              className="mt-1.5 inline-block font-medium text-text-secondary underline underline-offset-2 hover:text-text"
            >
              {t('noProjectsEmailLink')}
            </Link>
          </div>
        </li>
        <li className="flex items-start gap-3">
          <Megaphone size={17} className="mt-0.5 flex-shrink-0 text-text-secondary" />
          <div className="text-sm">
            <p className="font-medium">{t('noProjectsJoinTitle')}</p>
            <p className="mt-0.5 text-text-secondary">{t('noProjectsJoinHint')}</p>
          </div>
        </li>
      </ol>
    </Card>
  );
};
