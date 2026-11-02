import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './useAuth';
import { fetchUnread, refreshPushSubscription, setAppBadge } from '@/lib/notifications';

interface NotificationsContextValue {
  // Unread, not done notifications of the signed-in account.
  unread: number;
  // Counts again now (after reading, finishing, or a push arriving).
  refresh: () => void;
  setUnread: (n: number) => void;
  // Bumped whenever lists should load again (a push came in, the app came
  // back to the foreground).
  version: number;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  unread: 0,
  refresh: () => undefined,
  setUnread: () => undefined,
  version: 0,
});

export const useNotifications = () => useContext(NotificationsContext);

const POLL = 60_000;

// The unread count behind the bell: loaded on sign-in, every minute while
// the app is visible, when it comes back to the foreground and when the
// service worker reports a push. Also shown on the installed app's icon.
export const NotificationsProvider = ({ children }: { children: ReactNode }) => {
  const { user, mfaSetupRequired } = useAuth();
  const active = Boolean(user) && !mfaSetupRequired;
  const [unread, setUnreadState] = useState(0);
  const [version, setVersion] = useState(0);
  const inFlight = useRef(false);

  const setUnread = useCallback((n: number) => {
    setUnreadState(n);
    setAppBadge(n);
  }, []);

  const refresh = useCallback(() => {
    if (!active || inFlight.current) return;
    inFlight.current = true;
    fetchUnread()
      .then(setUnread)
      .catch(() => undefined)
      .finally(() => {
        inFlight.current = false;
      });
  }, [active, setUnread]);

  useEffect(() => {
    if (!active) {
      setUnreadState(0);
      return;
    }
    refresh();
    void refreshPushSubscription();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      refresh();
      setVersion((v) => v + 1);
    };
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; path?: string } | null;
      // A tapped push in a window the worker couldn't steer itself.
      if (message?.type === 'navigate' && message.path?.startsWith('/') && !message.path.startsWith('//')) {
        window.location.assign(message.path);
        return;
      }
      if (message?.type !== 'notification') return;
      refresh();
      setVersion((v) => v + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [active, refresh]);

  const value = useMemo(() => ({ unread, refresh, setUnread, version }), [unread, refresh, setUnread, version]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};
