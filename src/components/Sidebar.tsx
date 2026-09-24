import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu, PanelLeftClose, PanelLeftOpen, X, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { FadingText } from './FadingText';
import { config } from '@/lib/config';
import { AppLogo } from './AppLogo';

const COLLAPSED_WIDTH = 64;
const MIN_WIDTH = 200;
const MAX_WIDTH = 440;
const DEFAULT_WIDTH = 240;
const WIDTH_KEY = 'anwesenheit.sidebar.width';
const COLLAPSED_KEY = 'anwesenheit.sidebar.collapsed';
const DESKTOP_QUERY = '(min-width: 768px)';

interface SidebarContextValue {
  collapsed: boolean;
}

const SidebarContext = createContext<SidebarContextValue>({ collapsed: false });

export const useSidebar = () => useContext(SidebarContext);

// Tracks the desktop breakpoint so the sidebar can switch between its resizable
// desktop rail and a mobile off-canvas drawer.
const useIsDesktop = () => {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
};

// Shared sidebar shell used by every layout. On desktop it is collapsible (to an
// icon rail) and resizable by dragging its right edge; both states persist to
// localStorage so the choice survives navigation and reloads. On mobile it
// becomes an off-canvas drawer toggled from a fixed top bar.
//
// `storageKey` namespaces the persisted collapsed/width state so several
// sidebars (e.g. a primary one and a nested secondary one) keep independent
// preferences.
//
// `hideMobileBar` suppresses the mobile top bar for nested/secondary sidebars
// whose parent already renders one.
export const Sidebar = ({
  children,
  storageKey,
  hideMobileBar = false,
  actions,
}: {
  children: ReactNode;
  storageKey?: string;
  hideMobileBar?: boolean;
  // Icon buttons shown next to the collapse toggle (e.g. settings). Use
  // SidebarActionLink for a consistent look.
  actions?: ReactNode;
}) => {
  const { t } = useI18n();
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const widthKey = storageKey ? `${WIDTH_KEY}.${storageKey}` : WIDTH_KEY;
  const collapsedKey = storageKey ? `${COLLAPSED_KEY}.${storageKey}` : COLLAPSED_KEY;
  const [storedCollapsed, setStoredCollapsed] = useState(
    () => localStorage.getItem(collapsedKey) === '1',
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [width, setWidth] = useState(() => {
    const v = Number(localStorage.getItem(widthKey));
    return v >= MIN_WIDTH && v <= MAX_WIDTH ? v : DEFAULT_WIDTH;
  });
  const widthRef = useRef(width);
  widthRef.current = width;
  const dragging = useRef(false);
  const navRef = useRef<HTMLElement>(null);

  // Inside the mobile drawer the rail is always fully expanded.
  const collapsed = isDesktop ? storedCollapsed : false;

  // Close the drawer whenever the route changes (e.g. tapping a nav item).
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Prevent the page behind the drawer from scrolling while it is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  const toggle = () =>
    setStoredCollapsed((c) => {
      const next = !c;
      localStorage.setItem(collapsedKey, next ? '1' : '0');
      return next;
    });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      // Measure from the sidebar's own left edge so nested/offset sidebars
      // resize correctly (not just one anchored at the viewport edge).
      const left = navRef.current?.getBoundingClientRect().left ?? 0;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX - left)));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      localStorage.setItem(widthKey, String(widthRef.current));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <SidebarContext.Provider value={{ collapsed }}>
      {/* Mobile top bar: holds the hamburger that opens the drawer. */}
      {!hideMobileBar && (
        <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label={t('expand')}
            className="-ml-1.5 rounded-md p-1.5 text-text-secondary transition-colors duration-150 hover:bg-surface-hover"
          >
            <Menu size={20} />
          </button>
          <AppLogo className="h-5 w-5 flex-shrink-0" />
          <FadingText className="font-semibold">{config.appName}</FadingText>
        </div>
      )}

      {/* Backdrop behind the open mobile drawer. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-scrim/40 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <nav
        ref={navRef}
        style={isDesktop ? { width: collapsed ? COLLAPSED_WIDTH : width } : undefined}
        className={[
          'flex h-full w-[280px] max-w-[85vw] flex-col border-r border-border bg-surface',
          'fixed inset-y-0 left-0 z-50 transform transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:relative md:z-auto md:w-auto md:max-w-none md:translate-x-0 md:flex-shrink-0 md:transition-none',
          // Desktop: a floating panel inset from the top, left and bottom edges
          // (stretched by the flex row, hence h-auto). Nested sidebars sit next
          // to each other with the same gap.
          'md:my-3 md:ml-3 md:h-auto md:overflow-hidden md:rounded-2xl md:border',
          'md:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.12)]',
        ].join(' ')}
      >
        {collapsed ? (
          // Own slot at the top of the rail so it doesn't overlap the header.
          <div className="hidden flex-col items-center gap-1 py-2.5 md:flex">
            <button
              onClick={toggle}
              title={t('expand')}
              className="p-1.5 rounded-md text-text-secondary hover:bg-surface-hover transition-colors duration-150"
            >
              <PanelLeftOpen size={18} />
            </button>
            {actions}
          </div>
        ) : (
          // Pinned to the top-right corner of the header when expanded: the
          // actions, then collapse (desktop) or close (mobile drawer).
          <div className="absolute right-2 top-2.5 z-20 flex items-center gap-0.5">
            {actions}
            <button
              onClick={toggle}
              title={t('collapse')}
              className="hidden p-1.5 rounded-md bg-surface text-text-secondary hover:bg-surface-hover transition-colors duration-150 md:block"
            >
              <PanelLeftClose size={18} />
            </button>
            <button
              onClick={() => setMobileOpen(false)}
              aria-label={t('close')}
              className="rounded-md p-1.5 text-text-secondary transition-colors duration-150 hover:bg-surface-hover md:hidden"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {children}

        {!collapsed && (
          <div
            onMouseDown={onMouseDown}
            className="absolute top-0 right-0 z-10 hidden h-full w-1 cursor-col-resize hover:bg-accent/40 transition-colors duration-150 md:block"
          />
        )}
      </nav>
    </SidebarContext.Provider>
  );
};

// Icon link for Sidebar `actions`, styled like the collapse toggle and
// highlighted while its section is open.
export const SidebarActionLink = ({ to, label, icon: Icon }: { to: string; label: string; icon: LucideIcon }) => (
  <NavLink
    to={to}
    title={label}
    aria-label={label}
    className={({ isActive }) =>
      [
        'p-1.5 rounded-md transition-colors duration-150',
        isActive ? 'bg-surface-hover text-text' : 'bg-surface text-text-secondary hover:bg-surface-hover',
      ].join(' ')
    }
  >
    <Icon size={18} />
  </NavLink>
);
