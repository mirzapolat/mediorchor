import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

const COLLAPSED_WIDTH = 64;
const MIN_WIDTH = 200;
const MAX_WIDTH = 440;
const DEFAULT_WIDTH = 240;
const WIDTH_KEY = 'anwesenheit.sidebar.width';
const COLLAPSED_KEY = 'anwesenheit.sidebar.collapsed';

interface SidebarContextValue {
  collapsed: boolean;
}

const SidebarContext = createContext<SidebarContextValue>({ collapsed: false });

export const useSidebar = () => useContext(SidebarContext);

// Shared sidebar shell used by every layout. It is collapsible (to an icon
// rail) and resizable by dragging its right edge; both states persist to
// localStorage so the choice survives navigation and reloads.
//
// `storageKey` namespaces the persisted collapsed/width state so several
// sidebars (e.g. a primary one and a nested secondary one) keep independent
// preferences.
export const Sidebar = ({
  children,
  storageKey,
}: {
  children: ReactNode;
  storageKey?: string;
}) => {
  const { t } = useI18n();
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
  const navRef = useRef<HTMLElement>(null);

  const toggle = () =>
    setCollapsed((c) => {
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
        style={{ width: collapsed ? COLLAPSED_WIDTH : width }}
        className="relative flex-shrink-0 h-full bg-surface border-r border-border flex flex-col"
      >
        {collapsed ? (
          // Own slot at the top of the rail so it doesn't overlap the header.
          <div className="flex justify-center py-2.5">
            <button
              onClick={toggle}
              title={t('expand')}
              className="p-1.5 rounded-md text-text-secondary hover:bg-[#f0f0f0] transition-colors duration-150"
            >
              <PanelLeftOpen size={18} />
            </button>
          </div>
        ) : (
          // Pinned to the top-right corner of the header when expanded.
          <button
            onClick={toggle}
            title={t('collapse')}
            className="absolute top-2.5 right-2 z-20 p-1.5 rounded-md bg-surface text-text-secondary hover:bg-[#f0f0f0] transition-colors duration-150"
          >
            <PanelLeftClose size={18} />
          </button>
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
