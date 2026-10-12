import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ENV, type Env } from '../../../../shared/config/env';
import type { ContextualRequest } from '../../../../shared/infrastructure/http/request-context.decorators';
import {
  TENANT_REPOSITORY,
  type TenantRepository,
} from '../../../tenancy/application/ports/tenant.repository';
import { DEMO_TENANT } from '../../application/demo.constants';

/**
 * Resuelve el tenant demo para la lectura desde la web.
 * Solo existe mientras no hay login: el spec de identidad lo reemplaza por la sesión.
 */
@Injectable()
export class DemoTenantGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.env.DEMO_MODE) {
      throw new UnauthorizedException('Autenticación requerida');
    }

    const tenant = await this.tenants.findBySlug(DEMO_TENANT.slug);
    if (!tenant) {
      throw new ServiceUnavailableException('El tenant demo todavía no está inicializado');
    }

    context.switchToHttp().getRequest<ContextualRequest>().tenant = { tenantId: tenant.id };
    return true;
  }
}
