// Pull to refresh for the installed app (PWA). A standalone app has no reload
// button and iOS offers no pull-to-refresh there, so pulling down from the top
// of any page reloads it — which also picks up a new version of the app (the
// service worker fetches the HTML network-first).
//
// Pages scroll inside their layout's <main>, not the window, so a pull only
// starts when every scrollable element under the finger is at its top. It
// never starts inside dialogs, form fields or elements that handle touch
// themselves (touch-action: none, e.g. drag handles and the piece player).

// Finger travel (after resistance) that triggers the reload.
const THRESHOLD = 70;
// The indicator stops following the finger here.
const MAX_PULL = 110;
// Finger movement counts half: pulling feels "heavy", like native.
const RESISTANCE = 0.5;

const EXCLUDED = '[role="dialog"], input, textarea, select, [contenteditable="true"], [data-no-pull-refresh]';

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>';

// True when the touch starts where a downward pull can't scroll anything.
const atTop = (target: Element) => {
  if (window.scrollY > 0) return false;
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (el.scrollTop > 0) {
      const { overflowY } = getComputedStyle(el);
      if (overflowY === 'auto' || overflowY === 'scroll') return false;
    }
  }
  return true;
};

const handlesTouchItself = (target: Element) => {
  for (let el: Element | null = target; el; el = el.parentElement) {
    const { touchAction } = getComputedStyle(el);
    if (touchAction === 'none' || touchAction === 'pan-x') return true;
  }
  return false;
};

export const initPullToRefresh = () => {
  const indicator = document.createElement('div');
  indicator.className =
    'pointer-events-none fixed left-1/2 z-[100] flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-text-secondary shadow-md opacity-0';
  indicator.style.top = 'calc(env(safe-area-inset-top) + 8px)';
  indicator.style.transform = 'translate(-50%, -60px)';
  indicator.innerHTML = ICON;
  const icon = indicator.firstElementChild as SVGElement;
  document.body.appendChild(indicator);

  let startX = 0;
  let startY = 0;
  // 'idle' → finger down at the top ('armed') → moving down ('pulling').
  let state: 'idle' | 'armed' | 'pulling' | 'refreshing' = 'idle';
  let distance = 0;

  const render = (animate: boolean) => {
    indicator.style.transition = animate ? 'transform 200ms ease, opacity 200ms ease' : 'none';
    indicator.style.transform = `translate(-50%, ${distance - 60}px)`;
    indicator.style.opacity = String(Math.min(1, distance / THRESHOLD));
    icon.style.transform = `rotate(${(distance / THRESHOLD) * 270}deg)`;
    indicator.classList.toggle('text-text', distance >= THRESHOLD);
    indicator.classList.toggle('text-text-secondary', distance < THRESHOLD);
  };

  const reset = () => {
    state = 'idle';
    distance = 0;
    render(true);
  };

  document.addEventListener(
    'touchstart',
    (e) => {
      if (state === 'refreshing') return;
      state = 'idle';
      if (e.touches.length !== 1) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target || target.closest(EXCLUDED) || handlesTouchItself(target) || !atTop(target)) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      state = 'armed';
    },
    { passive: true },
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      if (state !== 'armed' && state !== 'pulling') return;
      if (e.touches.length !== 1) return reset();
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (state === 'armed') {
        // Scrolling up, or a sideways swipe (carousels, horizontal tables).
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
          state = 'idle';
          return;
        }
        if (dy < 6) return;
        state = 'pulling';
      }
      // Keep the page itself from bouncing while the indicator follows.
      if (e.cancelable) e.preventDefault();
      distance = Math.min(MAX_PULL, Math.max(0, dy * RESISTANCE));
      render(false);
    },
    { passive: false },
  );

  const end = () => {
    if (state !== 'pulling') {
      if (state === 'armed') state = 'idle';
      return;
    }
    if (distance < THRESHOLD) return reset();
    state = 'refreshing';
    distance = THRESHOLD;
    render(true);
    icon.style.transform = '';
    icon.classList.add('animate-spin');
    window.location.reload();
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', () => state === 'pulling' && reset(), { passive: true });
};
