// Usage analytics via the self-hosted Umami (script tag in index.html).
// Umami is cookieless and stores no personal data. Never pass names, emails,
// ids or free text as properties — only small fixed sets of values.
//
// window.umami is missing when an ad blocker stops the script or the host is
// not listed in data-domains (e.g. `npm run dev`); every call is then a no-op.

type Props = Record<string, string | number | boolean>;

interface Umami {
  track: {
    (event: string, data?: Props): void;
    (payload: (props: Record<string, unknown>) => Record<string, unknown>): void;
  };
}

const umami = () => (window as Window & { umami?: Umami }).umami;

export const track = (event: string, data?: Props) => {
  try {
    umami()?.track(event, data);
  } catch {
    // Analytics must never break the app.
  }
};

// Path segments after these are ids or access tokens; they are replaced with
// ":id" so the pages report groups by screen and no check-in or registration
// token ever reaches the analytics.
const ID_PARENTS = new Set([
  'projects',
  'members',
  'users',
  'pieces',
  'events',
  'registrations',
  'groups',
  'check-in',
  'register',
]);
const LITERALS = new Set(['new']);

export const normalizePath = (pathname: string) =>
  pathname
    .split('/')
    .map((segment, i, all) =>
      i > 0 && ID_PARENTS.has(all[i - 1]) && segment && !LITERALS.has(segment) ? ':id' : segment,
    )
    .join('/');

// Pageviews are sent by hand (data-auto-track="false") with the normalized
// path instead of the real URL; query string and hash are left out.
export const trackPageview = (pathname: string) => {
  const send = () => {
    try {
      umami()?.track((props) => ({ ...props, url: normalizePath(pathname) }));
    } catch {
      // Analytics must never break the app.
    }
  };
  if (umami()) {
    send();
    return;
  }
  // First page load: the tracker script may not have run yet.
  document.getElementById('umami-script')?.addEventListener('load', send, { once: true });
};

// Buckets a count so the property stays low-cardinality.
export const sizeBucket = (n: number) => (n <= 10 ? '1-10' : n <= 50 ? '11-50' : '51+');
