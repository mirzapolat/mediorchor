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
export const Sidebar = ({ children }: { children: ReactNode }) => {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1');
  const [width, setWidth] = useState(() => {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    return v >= MIN_WIDTH && v <= MAX_WIDTH ? v : DEFAULT_WIDTH;
  });
  const widthRef = useRef(width);
  widthRef.current = width;
  const dragging = useRef(false);

  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
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
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX)));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      localStorage.setItem(WIDTH_KEY, String(widthRef.current));
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
