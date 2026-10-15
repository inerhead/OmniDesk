import {
  Inject,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import {
  PLATFORM_ADMINS,
  type PlatformAdmins,
} from '../../../../shared/application/platform-admins';
import type { ContextualRequest } from '../../../../shared/infrastructure/http/request-context.decorators';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../../../identity/application/ports/user.repository';
import { UserSessionGuard } from '../../../identity/infrastructure/http/session.guard';

/**
 * Sesión de un admin de plataforma (SPEC 18). `401` sin sesión; `404` a cualquier otro usuario, para
 * no revelar que `/platform` existe.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly userSession: UserSessionGuard,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PLATFORM_ADMINS) private readonly admins: PlatformAdmins,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.userSession.canActivate(context);
    const session = context.switchToHttp().getRequest<ContextualRequest>().session!;
    const user = await this.users.findById(session.userId);
    if (!user || !this.admins.isPlatformAdmin(user.email)) throw new NotFoundException();
    return true;
  }
}
