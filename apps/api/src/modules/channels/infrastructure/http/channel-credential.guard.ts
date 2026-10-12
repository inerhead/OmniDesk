import {
  Inject,
  Injectable,
  HttpStatus,
  Logger,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { CLOCK, type Clock } from '../../../../shared/application/clock.port';
import {
  parseSignatureHeader,
  SIGNATURE_HEADER,
  verifySignature,
} from '../../../../shared/infrastructure/crypto/hmac-signature';
import { sha256Hex } from '../../../../shared/infrastructure/crypto/sha256';
import { apiError } from '../../../../shared/infrastructure/http/api-error';
import type { ContextualRequest } from '../../../../shared/infrastructure/http/request-context.decorators';
import {
  CHANNEL_SECRET_CIPHER,
  type ChannelSecretCipher,
} from '../../application/ports/channel-secret-cipher';
import {
  CHANNEL_REPOSITORY,
  type ChannelRepository,
} from '../../application/ports/channel.repository';
import { acceptedSigningSecrets, type SecretBlob } from '../../domain/channel';

/**
 * Autentica integraciones con `Authorization: Bearer <api key del canal>` y, si el canal tiene
 * secreto HMAC, exige `X-OmniDesk-Signature` válida sobre el cuerpo crudo (`req.rawBody`).
 */
@Injectable()
export class ChannelCredentialGuard implements CanActivate {
  private readonly logger = new Logger(ChannelCredentialGuard.name);

  constructor(
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
    @Inject(CHANNEL_SECRET_CIPHER) private readonly cipher: ChannelSecretCipher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ContextualRequest>();
    const [scheme, key] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !key) {
      throw new UnauthorizedException('Falta la credencial de integración');
    }

    const now = this.clock.now();
    const integration = await this.channels.findActiveCredential(sha256Hex(key), now);
    if (!integration) {
      throw new UnauthorizedException('Credencial de integración inválida');
    }

    const secrets = await this.channels.findSigningSecrets(integration.channelId);
    const accepted = secrets ? acceptedSigningSecrets(secrets, now) : [];
    // Solo el canal demo (SIMULATED) no tiene secreto: ahí no se exige firma.
    if (accepted.length > 0) this.verify(request, accepted, now, integration.channelId);

    request.integration = integration;
    return true;
  }

  private verify(
    request: ContextualRequest,
    accepted: SecretBlob[],
    now: Date,
    channelId: string,
  ): void {
    const header = request.header(SIGNATURE_HEADER);
    const rawBody = (request as ContextualRequest & { rawBody?: Buffer }).rawBody;
    const nowSec = Math.floor(now.getTime() / 1000);
    const result = verifySignature(
      header,
      rawBody?.toString('utf8') ?? '',
      accepted.map((blob) => this.cipher.decrypt(blob)),
      nowSec,
    );
    if (result === 'ok') return;

    const skew = header ? parseSignatureHeader(header)?.t : undefined;
    this.logger.warn(
      `Firma rechazada (${result}) en el canal ${channelId}` +
        (result === 'expired' && skew !== undefined ? `: desfase de ${nowSec - skew} s` : ''),
    );
    throw apiError(HttpStatus.UNAUTHORIZED, 'INVALID_SIGNATURE', 'Firma HMAC ausente o inválida');
  }
}
