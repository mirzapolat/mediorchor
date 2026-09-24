// Outgoing email (optional). Configured in Admin Config (smtp_settings), else
// through the SMTP_* environment variables; neither = email is off.
import nodemailer, { type Transporter } from 'nodemailer';
import { db } from './db.ts';
import { env } from './env.ts';
import { decryptSecret } from './secrets.ts';

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
        security: env.smtp.port === 465 ? 'tls' : 'auto',
        user: env.smtp.user,
        pass: env.smtp.pass,
        from: env.smtp.from,
        fromName: env.smtp.fromName,
      }
    : null;

const rowConfig = (row: SmtpRow): SmtpConfig => ({
  host: row.host,
  port: row.port,
  security: row.security,
  user: row.username ?? undefined,
  pass: (row.password_enc && decryptSecret(row.password_enc)) ?? undefined,
  from: row.from_address,
  fromName: row.from_name ?? undefined,
});

// The config in effect: Admin Config first, then the environment.
export const activeSmtpConfig = (): SmtpConfig | null => {
  const row = smtpRow();
  return row ? rowConfig(row) : envConfig();
};

// Read per call so a change in Admin Config applies without a restart.
export const mailEnabled = () => activeSmtpConfig() !== null;

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

export const sendMail = async (to: string, subject: string, text: string) => {
  const config = activeSmtpConfig();
  if (!config) throw new Error('Email is not configured');
  await transportFor(config).sendMail({ from: fromAddress(config), to, subject, text });
};

// Connects and authenticates with `config` (which need not be saved yet) and,
// when `to` is given, sends the test email through it. Errors never contain
// the password.
export const testSmtp = async (config: SmtpConfig, to?: string) => {
  const transport = createSmtpTransport(config, 20_000);
  try {
    await transport.verify();
    if (to) await transport.sendMail({ from: fromAddress(config), to, ...testMail() });
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    if (config.pass) message = message.split(config.pass).join('***');
    throw new Error(message);
  } finally {
    transport.close();
  }
};

const appName = () => env.client.VITE_APP_NAME;

export const sendConfirmSignup = (to: string, link: string) =>
  sendMail(
    to,
    `${appName()}: Bitte E-Mail-Adresse bestätigen / Confirm your email`,
    [
      'Hallo,',
      '',
      'bitte bestätige deine E-Mail-Adresse über diesen Link:',
      link,
      '',
      'Hello,',
      '',
      'please confirm your email address using this link:',
      link,
      '',
      'Der Link ist 24 Stunden gültig. / The link is valid for 24 hours.',
    ].join('\n'),
  );

export const sendConfirmEmailChange = (to: string, link: string) =>
  sendMail(
    to,
    `${appName()}: Neue E-Mail-Adresse bestätigen / Confirm your new email`,
    [
      'Hallo,',
      '',
      'bitte bestätige deine neue E-Mail-Adresse über diesen Link:',
      link,
      '',
      'Hello,',
      '',
      'please confirm your new email address using this link:',
      link,
      '',
      'Der Link ist 24 Stunden gültig. / The link is valid for 24 hours.',
    ].join('\n'),
  );

export const sendPendingSignupNotice = (to: string, name: string, email: string, baseUrl?: string) =>
  sendMail(
    to,
    `${appName()}: Neues Konto wartet auf Freigabe / New account awaiting approval`,
    [
      'Hallo,',
      '',
      `${name || email} (${email}) hat sich registriert und wartet auf deine Freigabe.`,
      ...(baseUrl ? ['', `Freigeben: ${baseUrl}/admin/users`] : []),
      '',
      'Hello,',
      '',
      `${name || email} (${email}) signed up and is waiting for your approval.`,
      ...(baseUrl ? ['', `Approve: ${baseUrl}/admin/users`] : []),
    ].join('\n'),
  );

const testMail = () => ({
  subject: `${appName()}: Test-E-Mail / Test email`,
  text: [
    'Diese Test-E-Mail bestätigt, dass der E-Mail-Versand funktioniert.',
    '',
    'This test email confirms that sending email works.',
  ].join('\n'),
});

// What the admin sees about the mail setup. Never the password itself, only
// whether one is set.
export const mailStatus = () => {
  const row = smtpRow();
  const fromEnv = envConfig();
  return {
    source: row ? 'settings' : fromEnv ? 'environment' : null,
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
