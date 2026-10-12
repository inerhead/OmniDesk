import type { SecretBlob } from '../../domain/channel';
/** Cifra y descifra los secretos HMAC de los canales (AES-256-GCM con `CHANNEL_SECRETS_KEY`). */
export interface ChannelSecretCipher {
  encrypt(plain: string): SecretBlob;
  /** Lanza si el blob está alterado o falta la clave. */
  decrypt(blob: SecretBlob): string;
}

export const CHANNEL_SECRET_CIPHER = Symbol('CHANNEL_SECRET_CIPHER');
