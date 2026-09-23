// Tiny fixed-window, in-memory rate limiter for the public/auth endpoints.
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { ApiError } from './db.ts';

const buckets = new Map<string, { count: number; resetAt: number }>();

// Behind Traefik the client address arrives in X-Forwarded-For.
export const clientIp = (c: Context) =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
  c.req.header('x-real-ip') ||
  getConnInfo(c).remote.address ||
  'unknown';

export const rateLimit = (c: Context, name: string, limit: number, windowMs: number) => {
  const key = `${name}:${clientIp(c)}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new ApiError('Too many requests, please try again later', 429, 'over_request_rate_limit');
  }
};

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}, 60_000).unref();
