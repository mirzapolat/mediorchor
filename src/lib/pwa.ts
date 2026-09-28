// Installable app (PWA): service worker registration and the install prompt.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

// Width of the screen-edge strip where iOS starts its "swipe back" gesture.
const EDGE_PX = 16;

// In the installed app, a swipe from the screen edge must not navigate back
// (it's easy to trigger by accident while turning pages or scrolling). iOS
// only lets that be stopped where the touch begins; overscroll navigation
// elsewhere (Android, trackpads) is switched off in CSS (html.standalone).
const blockEdgeSwipe = () => {
  document.documentElement.classList.add('standalone');
  document.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return;
      const x = e.touches[0].clientX;
      if (x < EDGE_PX || x > window.innerWidth - EDGE_PX) e.preventDefault();
    },
    { passive: false },
  );
};

// Chrome/Edge/Android offer installation through this event; it may fire
// before any page that shows an install button is mounted, so keep it.
export const initPwa = () => {
  if (isInstalled()) blockEdgeSwipe();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
  // Only in production builds: in development vite serves changing modules.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
  }
};

export const subscribeInstall = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const canPromptInstall = () => deferredPrompt !== null;

export const promptInstall = async (): Promise<boolean> => {
  const event = deferredPrompt;
  if (!event) return false;
  deferredPrompt = null;
  notify();
  await event.prompt();
  return (await event.userChoice).outcome === 'accepted';
};

// Already running as the installed app (home screen / app window).
export const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

// iPhone/iPad Safari has no install prompt: it's "Share → Add to Home Screen".
export const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
