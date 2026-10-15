// Outgoing email (optional). Configured in Admin Config (smtp_settings), else
// through the SMTP_* environment variables; neither = email is off. Admins can
// also switch it off without removing the configuration (email_enabled).
import nodemailer, { type Transporter } from 'nodemailer';
import { db } from './db.ts';
import { env } from './env.ts';
import { decryptSecret } from './secrets.ts';
import { branding } from './branding.ts';
import { instanceSettings } from './settings.ts';
import { composeMail, mailLanguages } from './i18n.ts';
import type { Language } from '../shared/languages.ts';

// tls = implicit TLS, starttls = STARTTLS required, none = no encryption,
// auto = STARTTLS when offered (legacy behaviour of the environment config).
export type SmtpSecurity = 'tls' | 'starttls' | 'none';

export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity | 'auto';
  user?: string;
  pass?: string;
  from: string;
  fromName?: string;
}

interface SmtpRow {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string | null;
  password_enc: string | null;
  from_address: string;
  from_name: string | null;
  updated_at: string;
}

const smtpRow = () =>
  db
    .prepare(
      `select host, port, security, username, password_enc, from_address, from_name, updated_at
       from smtp_settings where id = 1`,
    )
    .get() as SmtpRow | undefined;

const envConfig = (): SmtpConfig | null =>
  env.smtp.host && env.smtp.from
    ? {
        host: env.smtp.host,
        port: env.smtp.port,
        // A password is never sent before encryption is in place, so STARTTLS
        // is required then; without one it's used whenever it's offered.
        security: env.smtp.port === 465 ? 'tls' : env.smtp.pass ? 'starttls' : 'auto',
        user: env.smtp.user,
        pass: env.smtp.pass,
        from: env.smtp.from,
        fromName: env.smtp.fromName,
      }
    : null;

// Null when the stored password can't be decrypted (SECRET_KEY or secret.key
// changed): every send would fail, so the settings count as incomplete until
// the password is entered again.
const rowConfig = (row: SmtpRow): SmtpConfig | null => {
  const pass = row.password_enc ? decryptSecret(row.password_enc) : undefined;
  if (pass === null) return null;
  return {
    host: row.host,
    port: row.port,
    security: row.security,
    user: row.username ?? undefined,
    pass,
    from: row.from_address,
    fromName: row.from_name ?? undefined,
  };
};

// The config in effect: Admin Config first, then the environment.
export const activeSmtpConfig = (): SmtpConfig | null => {
  const row = smtpRow();
  return row ? rowConfig(row) : envConfig();
};

// Read per call so a change in Admin Config applies without a restart.
export const mailEnabled = () => instanceSettings().emailEnabled && activeSmtpConfig() !== null;

export const createSmtpTransport = (config: SmtpConfig, timeoutMs = 30_000) =>
  nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.security === 'tls',
    requireTLS: config.security === 'starttls',
    ignoreTLS: config.security === 'none',
    auth: config.user ? { user: config.user, pass: config.pass ?? '' } : undefined,
    // Certificates are always verified; no legacy protocol versions.
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: Math.min(timeoutMs, 15_000),
    greetingTimeout: Math.min(timeoutMs, 10_000),
    socketTimeout: timeoutMs,
    logger: false,
    debug: false,
  });

const fromAddress = (config: SmtpConfig) =>
  config.fromName ? { name: config.fromName, address: config.from } : config.from;

// One pooled transport per distinct config; rebuilt when the config changes.
let cached: { key: string; transport: Transporter } | null = null;

const transportFor = (config: SmtpConfig) => {
  const key = JSON.stringify(config);
  if (cached?.key !== key) {
    cached?.transport.close();
    cached = { key, transport: createSmtpTransport(config) };
  }
  return cached.transport;
};

// What an email was for, in the sending statistics (mail_log.kind).
export type MailKind = 'account' | 'reminder' | 'status' | 'weekly' | 'test' | 'confirmation';

// Error class only (nodemailer code like EAUTH, or the SMTP status); never the
// message, which can contain the recipient's address.
export const mailErrorCode = (err: unknown) => {
  const e = err as { code?: unknown; responseCode?: unknown };
  if (typeof e?.code === 'string' && /^[A-Z_]{2,32}$/.test(e.code)) return e.code;
  if (typeof e?.responseCode === 'number') return `SMTP_${e.responseCode}`;
  return 'UNKNOWN';
};

// Records one send attempt for the statistics; never fails the send itself.
const logMail = (kind: MailKind, err?: unknown) => {
  try {
    db.prepare('insert into mail_log (kind, ok, error) values (?, ?, ?)').run(
      kind,
      err === undefined ? 1 : 0,
      err === undefined ? null : mailErrorCode(err),
    );
  } catch (logErr) {
    console.error('Could not record mail statistics:', logErr);
  }
};

export const sendMail = async (to: string, subject: string, text: string, kind: MailKind) => {
  const config = instanceSettings().emailEnabled ? activeSmtpConfig() : null;
  if (!config) throw new Error('Email is not configured or switched off');
  try {
    await transportFor(config).sendMail({ from: fromAddress(config), to, subject, text });
  } catch (err) {
    logMail(kind, err);
    throw err;
  }
  logMail(kind);
};

// Connects and authenticates with `config` (which need not be saved yet) and,
// when `to` is given, sends the test email through it. Errors never contain
// the password.
export const testSmtp = async (config: SmtpConfig, to?: string) => {
  const transport = createSmtpTransport(config, 20_000);
  try {
    await transport.verify();
    if (to) {
      try {
        await transport.sendMail({ from: fromAddress(config), to, ...testMail() });
      } catch (err) {
        logMail('test', err);
        throw err;
      }
      logMail('test');
    }
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    if (config.pass) message = message.split(config.pass).join('***');
    throw new Error(message);
  } finally {
    transport.close();
  }
};

const appName = () => branding().appName;

// Account emails. `lang` is the account's language; null (not known or not
// chosen) sends the text in the instance default and English.
const sendLocalized = (
  to: string,
  lang: Language | null,
  build: Parameters<typeof composeMail>[1],
) => {
  const { subject, text } = composeMail(mailLanguages(lang), build);
  return sendMail(to, `${appName()}: ${subject}`, text, 'account');
};

export const sendConfirmSignup = (to: string, link: string, lang: Language | null) =>
  sendLocalized(to, lang, (m) => m.confirmSignup(link));

export const sendConfirmEmailChange = (to: string, link: string, lang: Language | null) =>
  sendLocalized(to, lang, (m) => m.confirmEmailChange(link));

export const sendPasswordReset = (to: string, link: string, lang: Language | null) =>
  sendLocalized(to, lang, (m) => m.passwordReset(link));

export const sendPendingSignupNotice = (
  to: string,
  lang: Language | null,
  name: string,
  email: string,
  baseUrl?: string,
) =>
  sendLocalized(to, lang, (m) =>
    m.pendingSignup(`${name || email} (${email})`, baseUrl ? `${baseUrl}/admin/users` : null),
  );

export const sendTwoFactorCode = (to: string, code: string, lang: Language | null) =>
  sendLocalized(to, lang, (m) => m.twoFactorCode(code));

const testMail = () => {
  const { subject, text } = composeMail(mailLanguages(null), (m) => m.testMail());
  return { subject: `${appName()}: ${subject}`, text };
};

// What the admin sees about the mail setup. Never the password itself, only
// whether one is set.
export const mailStatus = () => {
  const row = smtpRow();
  const fromEnv = envConfig();
  return {
    source: row ? 'settings' : fromEnv ? 'environment' : null,
    enabled: instanceSettings().emailEnabled,
    // Without PUBLIC_URL, emailed links are built from the request's host.
    public_url_set: Boolean(env.publicUrl),
    settings: row
      ? {
          host: row.host,
          port: row.port,
          security: row.security,
          username: row.username,
          has_password: Boolean(row.password_enc),
          // Stored but can't be decrypted (SECRET_KEY or secret.key changed).
          password_unreadable: Boolean(row.password_enc) && !decryptSecret(row.password_enc!),
          from_address: row.from_address,
          from_name: row.from_name,
          updated_at: row.updated_at,
        }
      : null,
    environment: fromEnv
      ? {
          host: fromEnv.host,
          port: fromEnv.port,
          security: fromEnv.security,
          username: fromEnv.user ?? null,
          has_password: Boolean(fromEnv.pass),
          from_address: fromEnv.from,
          from_name: fromEnv.fromName ?? null,
        }
      : null,
  };
};
