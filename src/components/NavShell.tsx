import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { SidebarNavItem, type NavItem } from './SidebarNav';
import { SidebarFooter } from './SidebarFooter';
import { AppLogo } from './AppLogo';
import { Avatar } from './Avatar';
import { cn } from '@/lib/cn';
import { config } from '@/lib/config';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { rememberReturn } from '@/lib/navReturn';

export interface NavBack {
  to: string;
  label: string;
}

// The one frame of every area with a sidebar (app, project, Probe, piece,
// account, admin). On desktop: the sidebar — `header`, the `items`, the
// account footer — next to the page. On phones the sidebar is replaced by
// three rows at the top: the app header (back · logo and name · account and
// admin), the area's `context` (what the sidebar header showed; it scrolls
// away with the page) and its pages as a row of buttons that sticks under the
// app header. Both show exactly the same pages.
export const NavShell = ({
  header,
  sidebarActions,
  items,
  back,
  context,
  contentClassName = 'max-w-[1400px] p-4 sm:p-6 lg:p-8',
  children,
}: {
  header?: ReactNode;
  sidebarActions?: ReactNode;
  items: Array<NavItem | false | null | undefined | ''>;
  // One level up from this area (none: the space stays empty).
  back?: NavBack | null;
  context?: ReactNode;
  contentClassName?: string;
  children: ReactNode;
}) => {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const pages = items.filter((item): item is NavItem => Boolean(item));
  // A page below one of the area's pages (a member, a user) goes back to it.
  const owner = deepestPage(pages, pathname);
  const up: NavBack | null =
    owner && trimSlash(pathname) !== trimSlash(owner.to) ? { to: owner.to, label: owner.label } : (back ?? null);

  return (
    <div className="flex h-full flex-col md:flex-row">
      <MobileAppHeader back={up} />

      <Sidebar actions={sidebarActions}>
        {header}
        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          {pages.map((item) => (
            <SidebarNavItem key={item.to} {...item} />
          ))}
        </div>
        <SidebarFooter />
      </Sidebar>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {context && <div className="border-b border-border bg-surface px-4 py-3 md:hidden">{context}</div>}
        {pages.length > 1 && <MobilePageRow items={pages} label={t('pageNavigation')} />}
        <div className={contentClassName}>{children}</div>
      </main>
    </div>
  );
};

const trimSlash = (path: string) => path.replace(/\/+$/, '') || '/';

// The page of the area the current path lies in or under (longest match).
const deepestPage = (pages: NavItem[], pathname: string) => {
  const path = trimSlash(pathname);
  let best: NavItem | null = null;
  for (const page of pages) {
    const to = trimSlash(page.to);
    const inside = path === to || path.startsWith(`${to}/`);
    if (inside && (!best || to.length > trimSlash(best.to).length)) best = page;
  }
  return best;
};

// 44 × 44 px hit area for the icon buttons of the mobile header.
const iconButton =
  'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors duration-150 hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';

// Back on the left, the brand in the exact middle of the screen (positioned,
// so the icons on the right can't push it aside), account and admin right.
export const MobileAppHeader = ({ back }: { back: NavBack | null }) => {
  const { t } = useI18n();
  const { user, isAdmin } = useAuth();
  const { pathname, search } = useLocation();
  const here = pathname + search;
  const name = user?.name || t('account');

  return (
    <header className="relative z-30 flex-shrink-0 border-b border-border bg-surface pt-[env(safe-area-inset-top)] md:hidden">
      <div className="relative flex h-14 items-center justify-between px-1.5">
        <div className="flex w-[6.25rem] items-center">
          {back && (
            <Link to={back.to} className={iconButton} aria-label={`${t('back')}: ${back.label}`} title={back.label}>
              <ArrowLeft size={20} />
            </Link>
          )}
        </div>

        <Link
          to="/"
          className="absolute left-1/2 top-1/2 flex max-w-[calc(100%-13rem)] -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-lg px-1 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <AppLogo className="h-5 w-5 flex-shrink-0" />
          <span className="truncate font-semibold">{config.appName}</span>
        </Link>

        <div className="flex w-[6.25rem] items-center justify-end">
          {isAdmin && (
            <HeaderIconLink
              to="/admin"
              label={t('adminConfig')}
              active={pathname.startsWith('/admin')}
              onClick={() => rememberReturn('admin', here)}
            >
              <ShieldCheck size={20} />
            </HeaderIconLink>
          )}
          <HeaderIconLink
            to="/account"
            label={t('accountSettings')}
            active={pathname.startsWith('/account')}
            onClick={() => rememberReturn('account', here)}
          >
            <Avatar name={name} photoUrl={user?.photo_url} size={28} />
          </HeaderIconLink>
        </div>
      </div>
    </header>
  );
};

const HeaderIconLink = ({
  to,
  label,
  active,
  onClick,
  children,
}: {
  to: string;
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) => (
  <Link
    to={to}
    onClick={onClick}
    aria-label={label}
    title={label}
    aria-current={active ? 'page' : undefined}
    className={cn(iconButton, active && 'bg-surface-hover text-text')}
  >
    {children}
  </Link>
);

// The area's pages as one row of buttons. When they fit, they share the
// width (they grow, never shrink); when not, each keeps its natural width and
// the row scrolls sideways — swiping only scrolls the row, a tap opens a page.
// Soft fades at the edges hint at more; the active page is scrolled into view.
export const MobilePageRow = ({ items, label }: { items: NavItem[]; label: string }) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const [fade, setFade] = useState({ left: false, right: false });

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const update = () =>
      setFade({
        left: row.scrollLeft > 2,
        right: row.scrollLeft + row.clientWidth < row.scrollWidth - 2,
      });
    update();
    row.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(row);
    return () => {
      row.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [items.length]);

  // Bring the active page fully into view (after navigating or reloading),
  // without scrolling the page itself.
  useEffect(() => {
    const row = rowRef.current;
    const active = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !active) return;
    const left = active.offsetLeft - row.offsetLeft;
    const right = left + active.offsetWidth;
    const pad = 16;
    if (left < row.scrollLeft + pad) row.scrollTo({ left: Math.max(0, left - pad) });
    else if (right > row.scrollLeft + row.clientWidth - pad) row.scrollTo({ left: right - row.clientWidth + pad });
  }, [pathname]);

  return (
    <nav aria-label={label} className="sticky top-0 z-20 border-b border-border bg-surface md:hidden">
      <div className="relative">
        <div
          ref={rowRef}
          className="flex h-14 snap-x snap-proximity items-center gap-1.5 overflow-x-auto scroll-px-4 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item) => (
            <MobilePageButton key={item.to} {...item} />
          ))}
        </div>
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface to-transparent transition-opacity duration-150',
            fade.left ? 'opacity-100' : 'opacity-0',
          )}
        />
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface to-transparent transition-opacity duration-150',
            fade.right ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>
    </nav>
  );
};

const MobilePageButton = ({ to, label, icon: Icon, end, warningCount = 0, badge = 0 }: NavItem) => (
  <NavLink
    to={to}
    end={end}
    className={({ isActive }) =>
      cn(
        'flex h-11 min-w-[4.5rem] flex-shrink-0 flex-grow snap-start items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-medium transition-colors duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        isActive ? 'bg-black text-white' : 'bg-surface-muted text-text-secondary hover:bg-surface-hover',
      )
    }
  >
    <Icon size={16} className="flex-shrink-0" aria-hidden />
    <span>{label}</span>
    <PageBadge warningCount={warningCount} badge={badge} />
  </NavLink>
);

// A warning (e.g. unrecognised check-ins) or a quiet count of one's own open
// things (e.g. surveys to answer).
const PageBadge = ({ warningCount, badge }: { warningCount: number; badge: number }) =>
  warningCount > 0 ? (
    <span className="inline-flex items-center gap-0.5 rounded-md bg-danger-soft px-1 text-xs font-semibold text-danger-strong">
      <AlertTriangle size={11} aria-hidden />
      {warningCount}
    </span>
  ) : badge > 0 ? (
    <span className="min-w-[1.125rem] rounded-full bg-accent/20 px-1 text-center text-xs font-semibold text-text">
      {badge}
    </span>
  ) : null;

// Context rows (under the app header on phones): an image or icon tile and
// the title with up to two lines of meta, as the sidebar header showed them.
export const MobileContext = ({
  icon: Icon,
  image,
  title,
  meta,
  description,
}: {
  icon?: LucideIcon;
  image?: ReactNode;
  title: string;
  meta?: ReactNode;
  description?: string | null;
}) => (
  <div className="flex items-start gap-3">
    {image ??
      (Icon ? (
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-surface-muted text-text-secondary">
          <Icon size={19} />
        </span>
      ) : null)}
    <div className="min-w-0 flex-1 self-center">
      <p className="line-clamp-2 break-words font-semibold leading-snug">{title}</p>
      {meta && <div className="mt-0.5 text-sm text-text-secondary">{meta}</div>}
      {description && <p className="mt-1 line-clamp-2 text-xs text-text-tertiary">{description}</p>}
    </div>
  </div>
);
