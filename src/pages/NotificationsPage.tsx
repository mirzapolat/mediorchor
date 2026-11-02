import { Outlet, useSearchParams } from 'react-router-dom';
import { Bell, CheckCheck, Inbox, Settings } from 'lucide-react';
import { NOTIFICATION_AREAS, type NotificationArea } from '@shared/notifications';
import { NavShell } from '@/components/NavShell';
import { SidebarSectionHeader } from '@/components/SidebarSectionHeader';
import { PageHeader } from '@/components/PageHeader';
import { OverflowMenu } from '@/components/OverflowMenu';
import { NotificationList, useNotificationFeed } from '@/components/NotificationCenter';
import { Toast } from '@/components/Toast';
import { useNotifications } from '@/hooks/useNotifications';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { returnPath } from '@/lib/navReturn';
import { PAGE_PADDING } from '@/lib/pagePadding';
import { AREA_LABEL } from '@/lib/notifications';

// The notification center: its own sidebar with the open and the done
// notifications and a way to the settings.
export const NotificationsLayout = () => {
  const { t } = useI18n();
  const { unread } = useNotifications();
  return (
    <NavShell
      header={<SidebarSectionHeader icon={Bell} title={t('notifications')} backTo={returnPath('notifications')} />}
      items={[
        { to: '/notifications', end: true, label: t('notifOpen'), icon: Bell, badge: unread },
        { to: '/notifications/done', label: t('notifDone'), icon: Inbox },
        { to: '/account/notifications', label: t('notifSettings'), icon: Settings },
      ]}
      back={{ to: returnPath('notifications'), label: t('back') }}
      contentClassName={`max-w-3xl ${PAGE_PADDING}`}
    >
      <Outlet />
    </NavShell>
  );
};

const isArea = (value: string | null): value is NotificationArea =>
  value !== null && (NOTIFICATION_AREAS as readonly string[]).includes(value);

export const NotificationsPage = ({ view }: { view: 'open' | 'done' }) => {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const raw = params.get('area');
  const area = view === 'open' && isArea(raw) ? raw : null;
  const feed = useNotificationFeed({ view, area });
  const { unread } = useNotifications();
  const areas = feed.page?.areas ?? {};
  const shownAreas = NOTIFICATION_AREAS.filter((a) => (areas[a]?.total ?? 0) > 0 || a === area);
  const hasRead = feed.page?.items.some((n) => n.read_at);

  const setArea = (next: NotificationArea | null) =>
    setParams(
      (p) => {
        if (next) p.set('area', next);
        else p.delete('area');
        return p;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader
        title={view === 'open' ? t('notifications') : t('notifDone')}
        inlineActions
        actions={
          view === 'open' && (unread > 0 || hasRead) ? (
            <OverflowMenu
              label={t('notifOptions')}
              items={[
                {
                  icon: CheckCheck,
                  label: t('notifMarkAllRead'),
                  onSelect: () => void feed.markAllRead(),
                  disabled: unread === 0,
                },
                {
                  icon: Inbox,
                  label: t('notifArchiveRead'),
                  onSelect: () => void feed.archive('all_read'),
                  disabled: !hasRead,
                },
              ]}
            />
          ) : null
        }
      />

      {/* Filter by area, when there is more than one. */}
      {view === 'open' && shownAreas.length > 1 && (
        <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <AreaChip active={!area} onClick={() => setArea(null)} label={t('notifAll')} unread={unread} />
          {shownAreas.map((a) => (
            <AreaChip
              key={a}
              active={area === a}
              onClick={() => setArea(area === a ? null : a)}
              label={t(AREA_LABEL[a])}
              unread={areas[a]?.unread ?? 0}
            />
          ))}
        </div>
      )}

      <NotificationList feed={feed} view={view} />
      <Toast toast={feed.toast.toast} onClose={feed.toast.hide} />
    </>
  );
};

const AreaChip = ({
  active,
  onClick,
  label,
  unread,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  unread: number;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      'flex h-9 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors duration-150',
      active
        ? 'border-accent bg-accent/10 text-text'
        : 'border-border text-text-secondary hover:bg-surface-subtle hover:text-text',
    )}
  >
    {label}
    {unread > 0 && (
      <span className="min-w-[1.125rem] rounded-full bg-accent px-1 text-center text-[11px] font-semibold leading-[1.125rem] text-white">
        {unread}
      </span>
    )}
  </button>
);
