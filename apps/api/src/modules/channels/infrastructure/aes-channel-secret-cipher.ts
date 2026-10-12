import type { SecretBlob } from '../domain/channel';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../../shared/config/env';
import { decryptSecret, encryptSecret } from '../../../shared/infrastructure/crypto/secret-box';
import type { ChannelSecretCipher } from '../application/ports/channel-secret-cipher';

@Injectable()
export class AesChannelSecretCipher implements ChannelSecretCipher {
  constructor(@Inject(ENV) private readonly env: Env) {}

  encrypt(plain: string): SecretBlob {
    return new Uint8Array(encryptSecret(plain, this.key()));
  }

  decrypt(blob: SecretBlob): string {
    return decryptSecret(Buffer.from(blob), this.key());
  }

  private key(): Buffer {
    if (!this.env.CHANNEL_SECRETS_KEY) {
      throw new Error(
        'CHANNEL_SECRETS_KEY no está configurada: no se pueden usar secretos de canal',
      );
    }
    return this.env.CHANNEL_SECRETS_KEY;
  }
}
