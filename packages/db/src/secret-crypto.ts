import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Authenticated envelope encryption for stored integration secrets
 * (webhook signing secrets, future provider credentials).
 * Format: v1:<iv_b64u>:<tag_b64u>:<ct_b64u>
 * The key comes from ENCRYPTION_KEY (base64-encoded 32 bytes) at call time —
 * the database never sees plaintext, and keys never touch the schema.
 */

export function encryptSecret(plaintext: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to 32 bytes');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(':');
}

export function decryptSecret(envelope: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to 32 bytes');
  }
  const parts = envelope.split(':');
  const [version, ivB64, tagB64, ctB64] = parts;
  if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64 || parts.length !== 4) {
    throw new Error('Unrecognized secret envelope format');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
}
