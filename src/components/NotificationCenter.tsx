import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArchiveRestore, Bell, BellOff, Check, CheckCheck, Circle, CircleDot, Inbox, Settings } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { localeOf } from '@shared/languages';
import { useNotifications } from '@/hooks/useNotifications';
import {
  archiveNotifications,
  fetchNotifications,
  lookOf,
  markNotifications,
  type NotificationItem,
  type NotificationPage,
} from '@/lib/notifications';
import { Toast, useToast } from './Toast';
import { track } from '@/lib/analytics';
import { Spinner } from './Spinner';
import { useSidebar } from './Sidebar';

// ---------------------------------------------------------------------------
// The feed: one list (open or done, optionally one area) with paging and the
// actions, kept in step with the bell's count. Reversible actions show the
// toast with "Undo".
// ---------------------------------------------------------------------------

export const useNotificationFeed = ({ view, area }: { view: 'open' | 'done'; area?: string | null }) => {
  const { t } = useI18n();
  const { setUnread, version } = useNotifications();
  const [page, setPage] = useState<NotificationPage | null>(null);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const toast = useToast();
  const request = useRef(0);

  const load = useCallback(() => {
    const id = ++request.current;
    fetchNotifications({ view, area })
      .then((data) => {
        if (id !== request.current) return;
        setPage(data);
        setUnread(data.unread);
        setError(false);
      })
      .catch(() => {
        if (id === request.current) setError(true);
      });
  }, [view, area, setUnread]);

  useEffect(() => {
    setPage(null);
    load();
  }, [load]);

  // A push came in or the app returned to the foreground.
  useEffect(() => {
    if (version) load();
  }, [version, load]);

  const loadMore = async () => {
    const last = page?.items[page.items.length - 1];
    if (!page?.has_more || !last || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchNotifications({ view, area, before: last.created_at });
      setPage((p) => (p ? { ...next, items: [...p.items, ...next.items] } : next));
    } finally {
      setLoadingMore(false);
    }
  };

  const patchItems = (ids: string[], patch: Partial<NotificationItem>) =>
    setPage((p) => (p ? { ...p, items: p.items.map((n) => (ids.includes(n.id) ? { ...n, ...patch } : n)) } : p));

  const removeItems = (ids: string[]) =>
    setPage((p) => (p ? { ...p, items: p.items.filter((n) => !ids.includes(n.id)) } : p));

  const setRead = async (items: NotificationItem[], read: boolean) => {
    const ids = items.map((n) => n.id);
    patchItems(ids, { read_at: read ? new Date().toISOString() : null });
    const result = await markNotifications({ ids, read }).catch(() => null);
    if (result) setUnread(result.unread);
    else load();
  };

  const markAllRead = async () => {
    const now = new Date().toISOString();
    setPage((p) => (p ? { ...p, items: p.items.map((n) => ({ ...n, read_at: n.read_at ?? now })) } : p));
    const result = await markNotifications({ all: true, read: true }).catch(() => null);
    if (result) setUnread(result.unread);
    load();
  };

  // Done, with "Undo" (back to open, and unread again where it was).
  const archive = async (items: NotificationItem[] | 'all_read') => {
    const chosen = items === 'all_read' ? [] : items;
    if (items !== 'all_read') removeItems(chosen.map((n) => n.id));
    const result = await archiveNotifications(
      items === 'all_read' ? { all_read: true, archived: true } : { ids: chosen.map((n) => n.id), archived: true },
    ).catch(() => null);
    if (!result) return load();
    setUnread(result.unread);
    if (items === 'all_read') load();
    if (result.ids.length === 0) return;
    const wasUnread = chosen.filter((n) => !n.read_at).map((n) => n.id);
    toast.show(
      result.ids.length === 1 ? t('notifArchived') : t('notifArchivedMany').replace('{n}', String(result.ids.length)),
      async () => {
        await archiveNotifications({ ids: result.ids, archived: false });
        if (wasUnread.length) await markNotifications({ ids: wasUnread, read: false });
        load();
      },
    );
  };

  const restore = async (items: NotificationItem[]) => {
    const ids = items.map((n) => n.id);
    removeItems(ids);
    const result = await archiveNotifications({ ids, archived: false }).catch(() => null);
    if (!result) return load();
    setUnread(result.unread);
    toast.show(t('notifRestored'), async () => {
      await archiveNotifications({ ids, archived: true });
      load();
    });
  };

  return { page, error, load, loadMore, loadingMore, setRead, markAllRead, archive, restore, toast };
};

export type NotificationFeed = ReturnType<typeof useNotificationFeed>;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// "vor 5 Min." / "vor 3 Std." / "Mo., 14:20" / "3. Okt."
const useTimeLabel = () => {
  const { lang } = useI18n();
  const locale = localeOf(lang);
  return (iso: string) => {
    const at = new Date(iso);
    const diff = Date.now() - at.getTime();
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
    if (diff < MINUTE) return rtf.format(0, 'second');
    if (diff < HOUR) return rtf.format(-Math.floor(diff / MINUTE), 'minute');
    if (diff < 12 * HOUR) return rtf.format(-Math.floor(diff / HOUR), 'hour');
    if (diff < 6 * DAY) {
      return new Intl.DateTimeFormat(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(at);
    }
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(at);
  };
};

type DayGroup = 'notifToday' | 'notifYesterday' | 'notifThisWeek' | 'notifEarlier';

const dayGroup = (iso: string): DayGroup => {
  const today = startOfDay(new Date());
  const day = startOfDay(new Date(iso));
  if (day >= today) return 'notifToday';
  if (day >= today - DAY) return 'notifYesterday';
  if (day >= today - 6 * DAY) return 'notifThisWeek';
  return 'notifEarlier';
};

const RowAction = ({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors duration-150 hover:bg-surface-hover hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
  >
    {children}
  </button>
);

export const NotificationRow = ({
  item,
  feed,
  onNavigate,
}: {
  item: NotificationItem;
  feed: NotificationFeed;
  onNavigate?: () => void;
}) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const timeLabel = useTimeLabel();
  const { icon: Icon, tone } = lookOf(item.category);
  const unread = !item.read_at;
  const done = Boolean(item.archived_at);

  // Opening reads it and goes where it is about.
  const open = () => {
    track('notifications-open', { category: item.category });
    if (unread) void feed.setRead([item], true);
    onNavigate?.();
    if (item.link) navigate(item.link);
  };

  return (
    <li className="group/notif relative">
      <div
        role="link"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
        className={cn(
          'flex cursor-pointer gap-3 rounded-xl px-3 py-3 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          unread ? 'bg-accent/5 hover:bg-accent/10' : 'hover:bg-surface-subtle',
        )}
      >
        <span
          className={cn('relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-surface-muted', tone)}
        >
          <Icon size={17} aria-hidden />
          {unread && (
            <span className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-accent" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1 pr-[4.5rem]">
          <p
            className={cn(
              'break-words text-sm leading-snug',
              unread ? 'font-semibold text-text' : 'font-medium text-text-secondary',
            )}
          >
            {item.title}
          </p>
          {item.body && (
            <p className="mt-0.5 line-clamp-2 whitespace-pre-line break-words text-sm text-text-secondary">{item.body}</p>
          )}
          <p className="mt-1 truncate text-xs text-text-tertiary">
            {timeLabel(item.created_at)}
          </p>
        </div>
      </div>
      {/* Actions: faded in on hover (always visible below lg). */}
      <div className="absolute right-2 top-2.5 flex items-center gap-0.5 transition-opacity duration-150 focus-within:opacity-100 lg:opacity-0 lg:group-hover/notif:opacity-100">
        {done ? (
          <RowAction label={t('notifRestore')} onClick={() => void feed.restore([item])}>
            <ArchiveRestore size={16} />
          </RowAction>
        ) : (
          <>
            <RowAction
              label={unread ? t('notifMarkRead') : t('notifMarkUnread')}
              onClick={() => void feed.setRead([item], unread)}
            >
              {unread ? <Circle size={15} /> : <CircleDot size={15} />}
            </RowAction>
            <RowAction label={t('notifArchive')} onClick={() => void feed.archive([item])}>
              <Check size={16} />
            </RowAction>
          </>
        )}
      </div>
    </li>
  );
};

// The list, grouped by day, with paging and the empty state.
export const NotificationList = ({
  feed,
  view,
  onNavigate,
  compact,
}: {
  feed: NotificationFeed;
  view: 'open' | 'done';
  onNavigate?: () => void;
  compact?: boolean;
}) => {
  const { t } = useI18n();
  const { page, error } = feed;

  if (error && !page) {
    return <p className="px-3 py-8 text-center text-sm text-text-secondary">{t('loadErrorText')}</p>;
  }
  if (!page) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  if (page.items.length === 0) {
    return (
      <NotificationsEmpty
        icon={view === 'done' ? Inbox : BellOff}
        title={view === 'done' ? t('notifDoneEmpty') : t('notifEmpty')}
        hint={view === 'done' ? t('notifDoneEmptyHint') : t('notifEmptyHint')}
        compact={compact}
      />
    );
  }

  const groups: { label: DayGroup; items: NotificationItem[] }[] = [];
  for (const item of page.items) {
    const label = dayGroup(item.created_at);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <section key={group.label}>
          <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t(group.label)}</h3>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <NotificationRow key={item.id} item={item} feed={feed} onNavigate={onNavigate} />
            ))}
          </ul>
        </section>
      ))}
      {page.has_more && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={() => void feed.loadMore()}
            disabled={feed.loadingMore}
            className="h-9 rounded-lg px-4 text-sm font-medium text-text-secondary hover:bg-surface-subtle disabled:opacity-50"
          >
            {t('notifLoadMore')}
          </button>
        </div>
      )}
    </div>
  );
};

const NotificationsEmpty = ({
  icon: Icon,
  title,
  hint,
  compact,
}: {
  icon: typeof Inbox;
  title: string;
  hint: string;
  compact?: boolean;
}) => (
  <div
    className={cn(
      'flex flex-col items-center justify-center gap-2 text-center',
      compact ? 'px-6 py-10' : 'rounded-2xl border border-dashed border-border px-6 py-16',
    )}
  >
    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-muted text-text-tertiary">
      <Icon size={20} />
    </span>
    <p className="font-semibold">{title}</p>
    <p className="text-sm text-text-secondary">{hint}</p>
  </div>
);

// ---------------------------------------------------------------------------
// The bell: in every sidebar's footer (desktop) and the mobile header.
// ---------------------------------------------------------------------------

export const UnreadBadge = ({ count, className }: { count: number; className?: string }) =>
  count > 0 ? (
    <span
      className={cn(
        'pointer-events-none absolute flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-white ring-2 ring-surface',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  ) : null;

export const useBellLabel = () => {
  const { t } = useI18n();
  const { unread } = useNotifications();
  return unread ? `${t('notifications')} · ${t('notifUnread').replace('{n}', String(unread))}` : t('notifications');
};

const PANEL_WIDTH = 400;

// Desktop: the bell opens a panel next to the sidebar with the open
// notifications; the full page has filters and the done ones.
export const NotificationBell = () => {
  const { unread } = useNotifications();
  const { collapsed } = useSidebar();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const label = useBellLabel();

  // Closes when the page changes (a notification was opened).
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          'relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors duration-150 hover:bg-surface-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          (open || pathname.startsWith('/notifications')) && 'bg-surface-hover text-text',
        )}
      >
        <Bell size={16} />
        <UnreadBadge count={unread} className={collapsed ? '-right-1.5 -top-1.5' : '-right-1 -top-1'} />
      </button>
      {open && <NotificationPanel anchor={buttonRef} onClose={() => setOpen(false)} />}
    </>
  );
};

const NotificationPanel = ({ anchor, onClose }: { anchor: RefObject<HTMLButtonElement>; onClose: () => void }) => {
  const { t } = useI18n();
  const feed = useNotificationFeed({ view: 'open' });
  const panelRef = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState<number | null>(null);

  // Next to the sidebar, from the bottom (where the bell sits).
  useLayoutEffect(() => {
    const place = () => {
      const nav = anchor.current?.closest('nav');
      const right = nav?.getBoundingClientRect().right ?? anchor.current?.getBoundingClientRect().right ?? 0;
      setLeft(Math.max(12, Math.min(right + 12, window.innerWidth - PANEL_WIDTH - 12)));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element;
      // The undo toast belongs to the panel too.
      if (target.closest?.('[role="status"]')) return;
      if (!panelRef.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onClose();
      anchor.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  const hasUnread = feed.page?.items.some((n) => !n.read_at);
  const hasRead = feed.page?.items.some((n) => n.read_at);

  return createPortal(
    <>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t('notifications')}
        style={{ left: left ?? 0, width: PANEL_WIDTH, visibility: left === null ? 'hidden' : undefined }}
        className="fixed bottom-3 z-50 flex max-h-[min(680px,calc(100vh-24px))] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_40px_-12px_rgba(0,0,0,0.25)]"
      >
        <div className="flex h-14 flex-shrink-0 items-center gap-0.5 border-b border-border pl-4 pr-2">
          <h2 className="min-w-0 flex-1 truncate font-semibold">{t('notifications')}</h2>
          {hasUnread && (
            <PanelIconButton label={t('notifMarkAllRead')} onClick={() => void feed.markAllRead()}>
              <CheckCheck size={17} />
            </PanelIconButton>
          )}
          {hasRead && (
            <PanelIconButton label={t('notifArchiveRead')} onClick={() => void feed.archive('all_read')}>
              <Inbox size={17} />
            </PanelIconButton>
          )}
          <Link
            to="/account/notifications"
            onClick={onClose}
            title={t('notifSettings')}
            aria-label={t('notifSettings')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted hover:text-text"
          >
            <Settings size={17} />
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <NotificationList feed={feed} view="open" onNavigate={onClose} compact />
        </div>
        <Link
          to="/notifications"
          onClick={onClose}
          className="flex h-11 flex-shrink-0 items-center justify-center border-t border-border text-sm font-medium text-text-secondary hover:bg-surface-subtle hover:text-text"
        >
          {t('notifShowAll')}
        </Link>
      </div>
      <Toast toast={feed.toast.toast} onClose={feed.toast.hide} />
    </>,
    document.body,
  );
};

const PanelIconButton = ({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted hover:text-text"
  >
    {children}
  </button>
);
