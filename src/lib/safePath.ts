// Returns the given path only if it is a safe in-app path to redirect to:
// a single-slash relative path (never protocol-relative like `//evil.com`
// or `/\evil.com`) and not the login page itself. Otherwise null.
export const safeRedirectPath = (path: string | undefined | null): string | null => {
  if (!path || !path.startsWith('/')) return null;
  if (path.startsWith('//') || path.startsWith('/\\')) return null;
  if (path === '/login') return null;
  return path;
};
