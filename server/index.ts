// mediorchor server: JSON API + file storage + the built single-page app, all
// on one origin, backed by a single SQLite file in DATA_DIR.
import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'node:fs';
import path from 'node:path';
import { db, migrate, loadTableMeta, translateDbError, ApiError } from './db.ts';
import { env, mailEnabled } from './env.ts';
import { authRoutes, withSessionUser, purgeExpired, createAccount } from './auth.ts';
import { executeDbRequest, type DbRequest } from './rest.ts';
import { callFunction, PUBLIC_WRITE_FUNCTIONS } from './rpc.ts';
import { storageRoutes, fileRoutes } from './storage.ts';
import { adminRoutes } from './admin.ts';
import { rateLimit } from './ratelimit.ts';

migrate();
loadTableMeta();

const app = new Hono();

app.onError((err, c) => {
  const error = translateDbError(err);
  return c.json({ error: { message: error.message, code: error.code } }, error.status as 400);
});

// Cookie sessions + SameSite=Lax already stop cross-site writes; rejecting a
// foreign Origin on state-changing requests is a second, explicit guard.
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin');
    const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
    if (origin && host && new URL(origin).host !== host) throw new ApiError('Cross-origin request blocked', 403);
  }
  await next();
  c.res.headers.set('Cache-Control', 'no-store');
});

const jsonBody = async (c: Context) => {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError('Invalid JSON body', 400);
  }
};

app.get('/api/health', (c) => {
  db.prepare('select 1').get();
  return c.json({ ok: true });
});

app.route('/api/auth', authRoutes);

// Generic table access (the former PostgREST endpoint).
app.post('/api/db', async (c) => {
  const request = (await jsonBody(c)) as DbRequest;
  const result = withSessionUser(c, (user) => {
    if (!user) throw new ApiError('Not authenticated', 401, 'not_authenticated');
    return executeDbRequest(request);
  });
  return c.json(result);
});

// Server functions (the former Postgres RPCs). Some work without a session.
app.post('/api/rpc/:name', async (c) => {
  const name = c.req.param('name');
  if (PUBLIC_WRITE_FUNCTIONS.has(name)) rateLimit(c, 'public-submit', 30, 60 * 1000);
  const args = (await jsonBody(c)) as Record<string, unknown>;
  const data = withSessionUser(c, () => callFunction(name, args));
  return c.json({ data: data ?? null });
});

app.route('/api/storage', storageRoutes);
app.route('/api/functions', adminRoutes);
app.all('/api/*', (c) => c.json({ error: { message: 'Not found' } }, 404));

app.route('/files', fileRoutes);

// Runtime branding config, read by the SPA before it boots.
app.get('/config.js', (c) => {
  c.header('Content-Type', 'text/javascript; charset=utf-8');
  c.header('Cache-Control', 'no-store');
  return c.body(`window.__APP_CONFIG__ = ${JSON.stringify(env.client)};\n`);
});

// Built frontend with SPA fallback (only when dist/ exists; vite serves it in dev).
const indexHtml = path.join(env.staticDir, 'index.html');
if (fs.existsSync(indexHtml)) {
  const spa = (c: Context) => {
    c.header('Cache-Control', 'no-store');
    return c.html(fs.readFileSync(indexHtml, 'utf8'));
  };
  app.get('/', spa);
  app.get('/index.html', spa);
  // Fingerprinted build output can be cached forever.
  app.use(
    '/assets/*',
    async (c, next) => {
      await next();
      if (c.res.ok) c.res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    },
    serveStatic({ root: env.staticDir }),
  );
  app.use('*', serveStatic({ root: env.staticDir }));
  app.get('*', spa);
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

const bootstrapAdmin = async () => {
  if (env.adminEmail && env.adminPassword) {
    const existing = db.prepare('select id from auth_users where email = ? collate nocase').get(env.adminEmail) as
      | { id: string }
      | undefined;
    if (existing) {
      db.prepare('update app_users set is_admin = 1 where id = ?').run(existing.id);
      db.prepare('update auth_users set email_confirmed_at = coalesce(email_confirmed_at, ?) where id = ?').run(
        new Date().toISOString(),
        existing.id,
      );
    } else {
      await createAccount({
        email: env.adminEmail,
        password: env.adminPassword,
        name: env.adminName,
        confirmed: true,
        isAdmin: true,
      });
      console.log(`Created admin account ${env.adminEmail}`);
    }
  }
  const { n } = db.prepare('select count(*) as n from app_users where is_admin').get() as { n: number };
  if (n === 0) {
    console.warn(
      'No admin account exists yet. Set ADMIN_EMAIL and ADMIN_PASSWORD, or run:\n' +
        '  node server/cli.ts create-admin <email> <password> [name]',
    );
  }
};

await bootstrapAdmin();
purgeExpired();
setInterval(purgeExpired, 60 * 60 * 1000).unref();

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`mediorchor listening on http://localhost:${info.port}`);
  console.log(`Data directory: ${env.dataDir}`);
  console.log(mailEnabled ? 'Email confirmation enabled (SMTP configured).' : 'SMTP not configured: sign-ups are confirmed immediately.');
});

const shutdown = () => {
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
