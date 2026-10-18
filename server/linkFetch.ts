// Previews of the links on a piece's "Dateien" page: the server reads the
// linked page once (title, description, site name and its Open Graph image)
// and keeps a copy of the image with the piece's files, so viewers never
// contact the other site. Called by editors when a link is added or
// refreshed.
//
// The URL comes from a user, so the fetch is guarded against reaching the
// server's own network (SSRF): http(s) on the standard ports only, every
// address a name resolves to must be public — checked at connect time, so a
// name can't switch to an internal address after the check — redirects are
// followed by hand and checked the same way, and time and size are limited.
import { Hono } from 'hono';
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { db, asUser, uuid, ApiError, forbidden } from './db.ts';
import { env } from './env.ts';
import { requireSession } from './auth.ts';
import { canEditPiece } from './policies.ts';
import { rateLimit } from './ratelimit.ts';

const TIMEOUT_MS = 6000;
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// Addresses that are not on the public internet.
const blocked = new net.BlockList();
for (const [net4, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net4, prefix, 'ipv4');
}
for (const [net6, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net6, prefix, 'ipv6');
}

const isPublic = (address: string): boolean => {
  const family = net.isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6) {
    // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is checked as IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublic(mapped[1]);
    return !blocked.check(address, 'ipv6');
  }
  return false;
};

// Resolves like dns.lookup, but fails unless every address is public.
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    if (addresses.length === 0 || !addresses.every((a) => isPublic(a.address))) {
      return callback(Object.assign(new Error('Address not allowed'), { code: 'EBLOCKED' }), '', 4);
    }
    if ((options as { all?: boolean }).all) {
      (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  });
};

const checkUrl = (raw: string): URL => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError('Invalid URL', 400);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ApiError('Only web links', 400);
  if (url.username || url.password) throw new ApiError('Invalid URL', 400);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (port !== '80' && port !== '443') throw new ApiError('Only standard ports', 400);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublic(host)) throw new ApiError('Address not allowed', 400);
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new ApiError('Address not allowed', 400);
  return url;
};

interface Fetched {
  url: URL;
  type: string;
  body: Buffer;
}

// GET with the guards above; follows redirects (each one checked again).
const guardedGet = (start: string, maxBytes: number, accept: string): Promise<Fetched> => {
  const attempt = (raw: string, hops: number): Promise<Fetched> =>
    new Promise((resolve, reject) => {
      const url = checkUrl(raw);
      const client = url.protocol === 'https:' ? https : http;
      const req = client.request(
        url,
        {
          method: 'GET',
          lookup: safeLookup,
          timeout: TIMEOUT_MS,
          headers: {
            accept,
            'accept-encoding': 'identity',
            'user-agent': 'Mozilla/5.0 (compatible; MediorchorLinkPreview/1.0)',
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            if (hops >= MAX_REDIRECTS) return reject(new ApiError('Too many redirects', 422));
            attempt(new URL(res.headers.location, url).toString(), hops + 1).then(resolve, reject);
            return;
          }
          if (status < 200 || status >= 300) {
            res.resume();
            return reject(new ApiError(`The page answered ${status}`, 422));
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            // Enough of the page for its head; for an image, too big.
            if (size > maxBytes) {
              res.destroy();
              if (accept.startsWith('image')) reject(new ApiError('Image too large', 422));
              else resolve({ url, type: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks) });
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => resolve({ url, type: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks) }));
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new ApiError('The page took too long', 422)));
      req.on('error', (err) => reject(err instanceof ApiError ? err : new ApiError('The page could not be reached', 422)));
      req.end();
    });
  return attempt(start, 0);
};

const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

const clean = (s: string | undefined, max: number) =>
  s ? decodeEntities(s).replace(/\s+/g, ' ').trim().slice(0, max) : '';

// The page's head: Open Graph / Twitter tags, else <title> and description.
const readMeta = (html: string) => {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
    const key = attr('property') ?? attr('name');
    const content = attr('content');
    if (!key || !content) continue;
    const k = (key[2] ?? key[3] ?? key[4] ?? '').toLowerCase();
    if (!meta.has(k)) meta.set(k, content[2] ?? content[3] ?? content[4] ?? '');
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return {
    title: clean(meta.get('og:title') ?? meta.get('twitter:title') ?? title, 200),
    description: clean(meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description'), 400),
    site: clean(meta.get('og:site_name'), 100),
    image: meta.get('og:image:secure_url') ?? meta.get('og:image') ?? meta.get('twitter:image') ?? null,
  };
};

export interface LinkPreview {
  title: string;
  description: string;
  site: string;
  // Key in the piece-files bucket ("<pieceId>/link-….jpg"), or null.
  image: string | null;
  fetched_at: string;
}

const piecePath = (key: string) => path.join(env.storageDir, 'piece-files', ...key.split('/'));

export const linkPreviewRoutes = new Hono();

// { file_id } → the link's new preview (also stored on the link).
linkPreviewRoutes.post('/', async (c) => {
  const user = requireSession(c);
  rateLimit(c, 'link-preview', 30, 60 * 1000);
  const { file_id: fileId } = (await c.req.json().catch(() => ({}))) as { file_id?: unknown };
  if (typeof fileId !== 'string') throw new ApiError('file_id required', 400);

  const link = db
    .prepare(`select id, piece_id, url, link_preview from piece_files where id = ? and kind = 'link'`)
    .get(fileId) as { id: string; piece_id: string; url: string | null; link_preview: string | null } | undefined;
  if (!link?.url) throw new ApiError('Link not found', 404);
  const allowed = asUser(user.id, () =>
    Boolean((db.prepare(`select ${canEditPiece('@pid')} as v`).get({ pid: link.piece_id }) as { v: number }).v),
  );
  if (!allowed) throw forbidden();

  const page = await guardedGet(link.url, MAX_HTML_BYTES, 'text/html,application/xhtml+xml');
  const meta = /html|xml/i.test(page.type) ? readMeta(page.body.toString('utf8')) : { title: '', description: '', site: '', image: null };

  // A copy of the preview image, kept with the piece's files.
  let image: string | null = null;
  if (meta.image) {
    try {
      const fetched = await guardedGet(new URL(meta.image, page.url).toString(), MAX_IMAGE_BYTES, 'image/*');
      const ext = IMAGE_TYPES[fetched.type.split(';')[0].trim().toLowerCase()];
      if (ext && fetched.body.length > 0) {
        image = `${link.piece_id}/link-${link.id}-${uuid().slice(0, 8)}.${ext}`;
        await fs.promises.mkdir(path.dirname(piecePath(image)), { recursive: true });
        await fs.promises.writeFile(piecePath(image), fetched.body);
      }
    } catch {
      // No image then; the rest of the preview still counts.
    }
  }

  const preview: LinkPreview = {
    title: meta.title,
    description: meta.description,
    site: meta.site || page.url.hostname.replace(/^www\./, ''),
    image,
    fetched_at: new Date().toISOString(),
  };
  // The previous image goes.
  const old = link.link_preview ? (JSON.parse(link.link_preview) as Partial<LinkPreview>) : null;
  if (old?.image && old.image !== image && old.image.startsWith(`${link.piece_id}/link-`)) {
    await fs.promises.unlink(piecePath(old.image)).catch(() => undefined);
  }
  db.prepare('update piece_files set link_preview = ? where id = ?').run(JSON.stringify(preview), link.id);
  return c.json({ preview });
});
