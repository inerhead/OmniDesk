import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM: `iv (12 B) || ciphertext || tag (16 B)`. `key` son 32 bytes (`CHANNEL_SECRETS_KEY`). */
export function encryptSecret(plain: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
}

/** Lanza si el blob está alterado o la clave no es la misma con la que se cifró. */
export function decryptSecret(blob: Buffer, key: Buffer): string {
  if (blob.length < IV_BYTES + TAG_BYTES) throw new Error('Secreto cifrado inválido');
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
