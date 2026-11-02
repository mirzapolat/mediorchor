// Web Push (the installed app's notifications) without a library: VAPID
// (RFC 8292) to identify this server to the push services and the
// aes128gcm payload encryption (RFC 8291), both with node:crypto. The VAPID
// key pair is created once and kept in DATA_DIR/vapid.json (owner-only).
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.ts';

const keyFile = path.join(env.dataDir, 'vapid.json');

interface VapidKeys {
  publicKey: string; // base64url, uncompressed P-256 point (65 bytes)
  privateKey: KeyObject;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

const loadKeys = (): VapidKeys => {
  try {
    const stored = JSON.parse(fs.readFileSync(keyFile, 'utf8')) as { publicKey: string; privateKey: string };
    return { publicKey: stored.publicKey, privateKey: createPrivateKey(stored.privateKey) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]);
  const stored = { publicKey: b64url(raw), privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string };
  try {
    // 'wx': another process may have created it meanwhile; then use that one.
    fs.writeFileSync(keyFile, JSON.stringify(stored), { mode: 0o600, flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return loadKeys();
    throw err;
  }
  return { publicKey: stored.publicKey, privateKey };
};

let keys: VapidKeys | null = null;
const vapid = () => (keys ??= loadKeys());

// The key the app subscribes with (applicationServerKey).
export const pushPublicKey = () => vapid().publicKey;

// A signed JWT for the push service of `endpoint`, valid for 12 hours.
const vapidAuthorization = (endpoint: string) => {
  const { publicKey, privateKey } = vapid();
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: env.publicUrl ?? 'mailto:admin@localhost',
      }),
    ),
  );
  const input = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${input}.${b64url(signature)}, k=${publicKey}`;
};

const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number) =>
  Buffer.from(hkdfSync('sha256', ikm, salt, info, length));

// RFC 8291: one record, encrypted for the subscription's keys.
export const encryptPayload = (payload: Buffer, p256dh: string, auth: string) => {
  const uaPublic = Buffer.from(p256dh, 'base64url');
  const authSecret = Buffer.from(auth, 'base64url');
  const ecdh = createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const salt = randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // 0x02: the last (and only) record, no padding.
  const body = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
};

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// 'gone': the subscription no longer exists (unsubscribed, app removed) and
// is forgotten; 'failed': tried again on the next run.
export type PushResult = 'sent' | 'gone' | 'failed';

export const sendPush = async (target: PushTarget, message: unknown, ttlSeconds = 24 * 60 * 60): Promise<PushResult> => {
  let url: URL;
  try {
    url = new URL(target.endpoint);
  } catch {
    return 'gone';
  }
  // Push services are public https endpoints (checked on subscribing too).
  if (url.protocol !== 'https:') return 'gone';
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(target.endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttlSeconds),
        Urgency: 'normal',
      },
      body: encryptPayload(Buffer.from(JSON.stringify(message)), target.p256dh, target.auth),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404 || response.status === 410) return 'gone';
    if (!response.ok) {
      console.error(`Push to ${url.host} failed with status ${response.status}`);
      return 'failed';
    }
    return 'sent';
  } catch (err) {
    console.error(`Push to ${url.host} failed:`, (err as Error).message);
    return 'failed';
  }
};
