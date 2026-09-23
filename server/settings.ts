// Instance settings (app_settings singleton) as the server needs them, with
// environment fallbacks. Read fresh each time: it's one indexed row and admins
// expect changes to apply immediately.
import { db } from './db.ts';
import { env } from './env.ts';

interface SettingsRow {
  allow_self_signup: number;
  session_days: number | null;
  signup_allowed_domains: string;
  signup_requires_approval: number;
  require_admin_2fa: number;
}

export const MIN_SESSION_DAYS = 1;
export const MAX_SESSION_DAYS = 365;

export const instanceSettings = () => {
  const row = db
    .prepare(
      `select allow_self_signup, session_days, signup_allowed_domains,
              signup_requires_approval, require_admin_2fa
       from app_settings where id = 1`,
    )
    .get() as SettingsRow | undefined;
  const days = row?.session_days ?? env.sessionDays;
  return {
    allowSelfSignup: row ? Boolean(row.allow_self_signup) : true,
    sessionDays: Math.min(MAX_SESSION_DAYS, Math.max(MIN_SESSION_DAYS, days)),
    allowedDomains: parseDomains(row?.signup_allowed_domains ?? ''),
    requiresApproval: Boolean(row?.signup_requires_approval),
    requireAdmin2fa: Boolean(row?.require_admin_2fa),
  };
};

// "example.org, @verein.de\nmail.example.com" → ['example.org', 'verein.de', ...]
export const parseDomains = (value: string) =>
  value
    .split(/[\s,;]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);

export const emailDomainAllowed = (email: string, domains: string[]) => {
  if (domains.length === 0) return true;
  const domain = email.split('@').pop()?.toLowerCase() ?? '';
  return domains.includes(domain);
};
