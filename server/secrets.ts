// Encryption for secrets stored in the database (the SMTP password), so a
// leaked or backed-up app.db alone doesn't reveal them. The key comes from
// SECRET_KEY, else from a random key file created next to the database with
// owner-only permissions.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.ts';

const keyFile = path.join(env.dataDir, 'secret.key');

const loadKey = (): Buffer => {
  if (env.secretKey) return createHash('sha256').update(env.secretKey).digest();
  try {
    return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const key = randomBytes(32);
  // 'wx' fails instead of overwriting if another process created it meanwhile.
  fs.writeFileSync(keyFile, key.toString('base64'), { mode: 0o600, flag: 'wx' });
  return key;
};

let cached: Buffer | null = null;
const key = () => {
  cached ??= loadKey();
  if (cached.length !== 32) throw new Error(`Invalid key in ${keyFile}`);
  return cached;
};

// "v1:<iv>:<tag>:<ciphertext>", all base64.
export const encryptSecret = (plain: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64'))).join(':');
};

// Null when the value can't be decrypted (e.g. the key changed).
export const decryptSecret = (stored: string): string | null => {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== 'v1' || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
};
