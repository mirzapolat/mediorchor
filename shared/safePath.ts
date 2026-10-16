// Returns the given path only if it is a safe in-app path to redirect to:
// a single-slash relative path (never protocol-relative like `//evil.com`
// or `/\evil.com`) and not the login page itself. Otherwise null.
// Also used by the server for the `next` of emailed links, where it ends up
// in a Location header: browsers drop tabs and newlines from URLs (so
// `/\t/evil.com` would become `//evil.com`), hence no control characters,
// whitespace or backslashes at all, and the resolved URL must stay on the
// same origin.
export const safeRedirectPath = (path: string | undefined | null): string | null => {
  if (!path || /[\x00-\x20\x7f\\]/.test(path)) return null;
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  const base = 'http://app.invalid';
  let url: URL;
  try {
    url = new URL(path, base);
  } catch {
    return null;
  }
  if (url.origin !== base) return null;
  // Resolving dot segments can turn `/.//evil.com` into `//evil.com`, so the
  // result is checked again, not only the input.
  const result = url.pathname + url.search + url.hash;
  if (result.startsWith('//') || /[\x00-\x20\x7f\\]/.test(result)) return null;
  return url.pathname === '/login' ? null : result;
};
