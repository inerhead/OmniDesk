import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { DEMO_MEMBER_HEADER } from '@omnidesk/contracts';
import { ENV, type Env } from '../../../../shared/config/env';
import type { ContextualRequest } from '../../../../shared/infrastructure/http/request-context.decorators';
import {
  MEMBER_REPOSITORY,
  type MemberRepository,
} from '../../../members/application/ports/member.repository';
import {
  TENANT_REPOSITORY,
  type TenantRepository,
} from '../../../tenancy/application/ports/tenant.repository';
import { DEMO_TENANT } from '../../application/demo.constants';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resuelve tenant y actor para la web: el tenant demo y el miembro de `X-Demo-Member-Id`.
 * Solo existe mientras no hay login: el spec de identidad lo reemplaza por la sesión.
 */
@Injectable()
export class DemoActorGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(MEMBER_REPOSITORY) private readonly members: MemberRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.env.DEMO_MODE) throw new UnauthorizedException('Autenticación requerida');

    const request = context.switchToHttp().getRequest<ContextualRequest>();
    const header = request.header(DEMO_MEMBER_HEADER);
    if (!header) throw new UnauthorizedException('Selecciona con quién actuar');
    if (!UUID.test(header)) throw new UnauthorizedException('Miembro no válido');

    const tenant = await this.tenants.findBySlug(DEMO_TENANT.slug);
    if (!tenant) {
      throw new ServiceUnavailableException('El tenant demo todavía no está inicializado');
    }

    const member = await this.members.findById(tenant.id, header);
    if (!member) throw new UnauthorizedException('Miembro no válido');

    request.tenant = { tenantId: tenant.id };
    request.actor = { tenantId: tenant.id, memberId: member.id, role: member.role };
    return true;
  }
}
