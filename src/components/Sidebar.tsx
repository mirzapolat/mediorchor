import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';

const COLLAPSED_WIDTH = 64;
const MIN_WIDTH = 200;
const MAX_WIDTH = 440;
const DEFAULT_WIDTH = 272;
const WIDTH_KEY = 'anwesenheit.sidebar.width';
const COLLAPSED_KEY = 'anwesenheit.sidebar.collapsed';
const DESKTOP_QUERY = '(min-width: 768px)';

// Collapsed, the sidebar is an icon rail. Everything in it keeps one place in
// both states, so collapsing only narrows the panel and fades the labels —
// nothing jumps: an icon's centre sits 31 px from the panel's inner left edge
// (64 px wide minus the 1 px borders). These paddings put the usual icon
// sizes there; use them for anything new in a sidebar.
export const RAIL = {
  // Nav items (18 px icon) inside the list's p-3.
  item: 'pl-[10px] pr-3',
  // A 16 px icon in a full-width row (back links).
  icon16: 'pl-[23px] pr-5',
  // A 20 px logo.
  icon20: 'pl-[21px] pr-5',
  // A 32 px tile or avatar.
  tile: 'pl-[15px] pr-5',
} as const;

interface SidebarContextValue {
  collapsed: boolean;
  // Labels for the rail's icons, shown right next to it while collapsed.
  showTip: (label: string, anchor: Element) => void;
  hideTip: () => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  showTip: () => undefined,
  hideTip: () => undefined,
});

export const useSidebar = () => useContext(SidebarContext);

// Handlers that show `label` next to the rail while it's collapsed (hover and
// keyboard focus). Spread them on the icon's link or button.
export const useRailTip = (label: string) => {
  const { collapsed, showTip, hideTip } = useSidebar();
  if (!collapsed) return {};
  return {
    'aria-label': label,
    onMouseEnter: (e: ReactMouseEvent) => showTip(label, e.currentTarget),
    onMouseLeave: hideTip,
    onFocus: (e: FocusEvent) => showTip(label, e.currentTarget),
    onBlur: hideTip,
  };
};

// Labels fade out while the narrowing panel clips them.
export const sidebarLabel = (collapsed: boolean) =>
  cn('transition-opacity duration-200 ease-out', collapsed && 'pointer-events-none opacity-0');

// Lines under a title (dates, place, composer) that fold away when collapsed.
export const SidebarFold = ({ children }: { children: ReactNode }) => {
  const { collapsed } = useSidebar();
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
        collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
};

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

// The hidden copy of the actions must not be reachable.
const inert = (hidden: boolean) => (hidden ? ({ inert: '', 'aria-hidden': true } as object) : {});

// The desktop sidebar shell used by every layout (through NavShell): it is
// collapsible (to an icon rail, animated) with the small arrow on the middle
// of its right edge, and resizable by dragging that edge; both states persist
// to localStorage so the choice survives navigation and reloads. On phones it
// is not shown — NavShell's top navigation replaces it.
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
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(collapsedKey) === '1');
  const [width, setWidth] = useState(() => {
    const v = Number(localStorage.getItem(widthKey));
    return v >= MIN_WIDTH && v <= MAX_WIDTH ? v : DEFAULT_WIDTH;
  });
  const widthRef = useRef(width);
  widthRef.current = width;
  const dragging = useRef(false);
  const [resizing, setResizing] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);

  const toggle = () => {
    setTip(null);
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(collapsedKey, next ? '1' : '0');
      return next;
    });
  };

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    setResizing(true);
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
      setResizing(false);
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
  }, [widthKey]);

  const showTip = useCallback((label: string, anchor: Element) => {
    const nav = navRef.current?.getBoundingClientRect();
    if (!nav) return;
    const rect = anchor.getBoundingClientRect();
    // Clear of the edge arrow.
    setTip({ label, top: rect.top + rect.height / 2, left: nav.right + 16 });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);
  const context = useMemo(() => ({ collapsed, showTip, hideTip }), [collapsed, showTip, hideTip]);

  return (
    <SidebarContext.Provider value={context}>
      {/* The panel clips its content; the arrow sits outside it on the edge. */}
      <div
        style={isDesktop ? { width: collapsed ? COLLAPSED_WIDTH : width } : undefined}
        className={cn(
          // A floating panel inset from the top, left and bottom edges
          // (stretched by the flex row). Nested sidebars sit next to each
          // other with the same gap.
          'group/sidebar relative my-3 ml-3 hidden flex-shrink-0 md:flex',
          // Collapsing and expanding are animated; dragging the edge is not.
          !resizing && 'transition-[width] duration-200 ease-out motion-reduce:transition-none',
        )}
      >
        <nav
          ref={navRef}
          className={cn(
            'relative flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface',
            'shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.12)]',
          )}
        >
          {actions && (
            <>
              {/* Collapsed: the actions in their own row at the top, which
                  opens and closes with the panel. */}
              <div
                className={cn(
                  'grid flex-shrink-0 transition-[grid-template-rows,opacity] duration-200 ease-out',
                  collapsed ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
                )}
                {...inert(!collapsed)}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="flex w-[62px] flex-col items-center gap-1 border-b border-border py-2.5">
                    {collapsed && actions}
                  </div>
                </div>
              </div>
              {/* Expanded: pinned top-right in the header. */}
              <div
                className={cn(
                  'absolute right-2 top-2.5 z-20 flex items-center gap-0.5 transition-opacity duration-200',
                  collapsed ? 'pointer-events-none opacity-0' : 'opacity-100',
                )}
                {...inert(collapsed)}
              >
                {!collapsed && actions}
              </div>
            </>
          )}

          {children}
        </nav>

        {!collapsed && (
          <div
            onMouseDown={onMouseDown}
            className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize rounded-r-2xl transition-colors duration-150 hover:bg-accent/40"
          />
        )}

        {/* Collapse / expand: a small arrow on the middle of the edge. */}
        <button
          type="button"
          onClick={toggle}
          onMouseEnter={(e) => collapsed && showTip(t('expand'), e.currentTarget)}
          onMouseLeave={hideTip}
          title={collapsed ? undefined : t('collapse')}
          aria-label={collapsed ? t('expand') : t('collapse')}
          aria-expanded={!collapsed}
          className={cn(
            'absolute right-0 top-1/2 z-20 flex h-6 w-6 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full',
            'border border-border bg-surface text-text-tertiary shadow-sm transition-colors duration-150',
            'hover:bg-surface-hover hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          )}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
      {collapsed &&
        tip &&
        createPortal(
          <div
            role="tooltip"
            style={{ top: tip.top, left: tip.left }}
            className="pointer-events-none fixed z-[70] -translate-y-1/2 animate-[fadein_120ms_ease-out] whitespace-nowrap rounded-lg bg-black px-2.5 py-1.5 text-xs font-medium text-white shadow-lg"
          >
            {tip.label}
          </div>,
          document.body,
        )}
    </SidebarContext.Provider>
  );
};

// Icon link for Sidebar `actions`, styled like the collapse toggle and
// highlighted while its section is open.
export const SidebarActionLink = ({
  to,
  label,
  icon: Icon,
  onClick,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
}) => {
  const { collapsed } = useSidebar();
  const tip = useRailTip(label);
  return (
    <NavLink
      to={to}
      title={collapsed ? undefined : label}
      aria-label={label}
      onClick={onClick}
      {...tip}
      className={({ isActive }) =>
        cn(
          'flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150',
          isActive ? 'bg-surface-hover text-text' : 'bg-surface text-text-secondary hover:bg-surface-hover',
        )
      }
    >
      <Icon size={18} />
    </NavLink>
  );
};
