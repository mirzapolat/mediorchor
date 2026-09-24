// Server configuration, read once from the environment.
import path from 'node:path';

const int = (value: string | undefined, fallback: number) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const dataDir = path.resolve(process.env.DATA_DIR ?? './data');

export const env = {
  port: int(process.env.PORT, 3000),
  dataDir,
  dbPath: path.join(dataDir, 'app.db'),
  storageDir: path.join(dataDir, 'storage'),
  // Built frontend (vite build output). Absent in dev, where vite serves it.
  staticDir: path.resolve(process.env.STATIC_DIR ?? './dist'),
  // Absolute base URL used in emailed links. Falls back to the request origin.
  publicUrl: process.env.PUBLIC_URL?.replace(/\/+$/, '') || undefined,
  maxUploadBytes: int(process.env.MAX_UPLOAD_MB, 100) * 1024 * 1024,
  sessionDays: int(process.env.SESSION_DAYS, 30),
  // Key for secrets stored in the database (e.g. the SMTP password). Optional:
  // without it a random key is kept in DATA_DIR/secret.key.
  secretKey: process.env.SECRET_KEY || undefined,

  // First admin, created (or promoted) at start-up when set.
  adminEmail: process.env.ADMIN_EMAIL?.trim() || undefined,
  adminPassword: process.env.ADMIN_PASSWORD || undefined,
  adminName: process.env.ADMIN_NAME?.trim() || 'Admin',

  // Optional SMTP. When configured, self sign-ups and email changes must be
  // confirmed through an emailed link; without it they apply immediately.
  // Settings saved in Admin Config take precedence (see server/mail.ts).
  smtp: {
    host: process.env.SMTP_HOST?.trim() || undefined,
    port: int(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: process.env.SMTP_FROM || undefined,
    fromName: process.env.SMTP_FROM_NAME || undefined,
  },

  // Browser runtime config, served as /config.js.
  client: {
    VITE_DEFAULT_LANGUAGE: process.env.VITE_DEFAULT_LANGUAGE ?? 'en',
    VITE_APP_NAME: process.env.VITE_APP_NAME ?? 'Anwesenheit',
    VITE_ACCENT_COLOR: process.env.VITE_ACCENT_COLOR ?? '#efa100',
  },
};
