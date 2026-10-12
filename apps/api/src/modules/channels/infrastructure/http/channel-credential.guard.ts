import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { sha256Hex } from '../../../../shared/infrastructure/crypto/sha256';
import type { ContextualRequest } from '../../../../shared/infrastructure/http/request-context.decorators';
import {
  CHANNEL_REPOSITORY,
  type ChannelRepository,
} from '../../application/ports/channel.repository';

/** Autentica integraciones con `Authorization: Bearer <api key del canal>`. */
@Injectable()
export class ChannelCredentialGuard implements CanActivate {
  constructor(@Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ContextualRequest>();
    const [scheme, key] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !key) {
      throw new UnauthorizedException('Falta la credencial de integración');
    }

    const integration = await this.channels.findActiveCredential(sha256Hex(key));
    if (!integration) {
      throw new UnauthorizedException('Credencial de integración inválida');
    }

    request.integration = integration;
    return true;
  }
}
