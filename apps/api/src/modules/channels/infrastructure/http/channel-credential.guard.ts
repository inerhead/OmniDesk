import {
  Inject,
  Injectable,
  HttpStatus,
  Logger,
  Optional,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { CLOCK, type Clock } from '../../../../shared/application/clock.port';
import {
  METRICS,
  type IntegrationResult,
  type Metrics,
} from '../../../../shared/application/metrics.port';
import {
  parseSignatureHeader,
  SIGNATURE_HEADER,
  verifySignature,
} from '../../../../shared/infrastructure/crypto/hmac-signature';
import { sha256Hex } from '../../../../shared/infrastructure/crypto/sha256';
import { apiError } from '../../../../shared/infrastructure/http/api-error';
import { integrationEndpoint } from '../../../../shared/infrastructure/http/integration-endpoint';
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
    @Optional() @Inject(METRICS) private readonly metrics?: Metrics,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ContextualRequest>();
    try {
      return await this.authenticate(request);
    } catch (error) {
      this.countRejection(request, error);
      throw error;
    }
  }

  /** `unauthorized` o `invalid_signature` en `omnidesk_integration_requests_total` (SPEC 11). */
  private countRejection(request: ContextualRequest, error: unknown): void {
    const endpoint = integrationEndpoint(request.path);
    if (!endpoint || !this.metrics) return;
    const code = (error as { getResponse?: () => unknown }).getResponse?.();
    const result: IntegrationResult =
      typeof code === 'object' &&
      code !== null &&
      'code' in code &&
      code.code === 'INVALID_SIGNATURE'
        ? 'invalid_signature'
        : 'unauthorized';
    this.metrics.integrationRequest(endpoint, result);
  }

  private async authenticate(request: ContextualRequest): Promise<boolean> {
    const [scheme, key] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !key) {
      throw new UnauthorizedException('Falta la credencial de integración');
    }

    const now = this.clock.now();
    const integration = await this.channels.findActiveCredential(sha256Hex(key), now);
    if (!integration) {
      throw new UnauthorizedException('Credencial de integración inválida');
    }

    const channel = await this.channels.findForSend(integration.tenantId, integration.channelId);
    if (channel?.provider === 'WHATSAPP_CLOUD')
      throw new UnauthorizedException('Usa el webhook nativo de WhatsApp para este canal');
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
