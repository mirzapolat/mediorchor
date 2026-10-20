import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

const COLLAPSED_WIDTH = 64;
const MIN_WIDTH = 200;
const MAX_WIDTH = 440;
const DEFAULT_WIDTH = 272;
const WIDTH_KEY = 'anwesenheit.sidebar.width';
const COLLAPSED_KEY = 'anwesenheit.sidebar.collapsed';
const DESKTOP_QUERY = '(min-width: 768px)';

interface SidebarContextValue {
  collapsed: boolean;
}

const SidebarContext = createContext<SidebarContextValue>({ collapsed: false });

export const useSidebar = () => useContext(SidebarContext);

// Tracks the desktop breakpoint: the sidebar's width applies there only.
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

// The desktop sidebar shell used by every layout (through NavShell): it is
// collapsible (to an icon rail) and resizable by dragging its right edge;
// both states persist to localStorage so the choice survives navigation and
// reloads. On phones it is not shown — NavShell's top navigation replaces it.
//
// `storageKey` namespaces the persisted collapsed/width state so several
// sidebars keep independent preferences.
export const Sidebar = ({
  children,
  storageKey,
  actions,
}: {
  children: ReactNode;
  storageKey?: string;
  // Icon buttons shown next to the collapse toggle (e.g. settings). Use
  // SidebarActionLink for a consistent look.
  actions?: ReactNode;
}) => {
  const { t } = useI18n();
  const isDesktop = useIsDesktop();
  const widthKey = storageKey ? `${WIDTH_KEY}.${storageKey}` : WIDTH_KEY;
  const collapsedKey = storageKey ? `${COLLAPSED_KEY}.${storageKey}` : COLLAPSED_KEY;
  const [storedCollapsed, setStoredCollapsed] = useState(
    () => localStorage.getItem(collapsedKey) === '1',
  );
  const [width, setWidth] = useState(() => {
    const v = Number(localStorage.getItem(widthKey));
    return v >= MIN_WIDTH && v <= MAX_WIDTH ? v : DEFAULT_WIDTH;
  });
  const widthRef = useRef(width);
  widthRef.current = width;
  const dragging = useRef(false);
  const navRef = useRef<HTMLElement>(null);

  const collapsed = storedCollapsed;

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
      <nav
        ref={navRef}
        style={isDesktop ? { width: collapsed ? COLLAPSED_WIDTH : width } : undefined}
        className={[
          'relative hidden flex-shrink-0 flex-col border-r border-border bg-surface md:flex',
          // A floating panel inset from the top, left and bottom edges
          // (stretched by the flex row, hence h-auto). Nested sidebars sit next
          // to each other with the same gap.
          'my-3 ml-3 h-auto overflow-hidden rounded-2xl border',
          'shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.12)]',
        ].join(' ')}
      >
        {collapsed ? (
          // Own slot at the top of the rail so it doesn't overlap the header.
          <div className="flex flex-col items-center gap-1 py-2.5">
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
          // actions, then collapse.
          <div className="absolute right-2 top-2.5 z-20 flex items-center gap-0.5">
            {actions}
            <button
              onClick={toggle}
              title={t('collapse')}
              className="p-1.5 rounded-md bg-surface text-text-secondary hover:bg-surface-hover transition-colors duration-150"
            >
              <PanelLeftClose size={18} />
            </button>
          </div>
        )}

        {children}

        {!collapsed && (
          <div
            onMouseDown={onMouseDown}
            className="absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize hover:bg-accent/40 transition-colors duration-150"
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
