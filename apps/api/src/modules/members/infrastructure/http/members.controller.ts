import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { ListMembersResponse } from '@omnidesk/contracts';
import type { TenantContext } from '../../../../shared/application/request-context';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { CurrentTenant } from '../../../../shared/infrastructure/http/request-context.decorators';
import { SessionGuard } from '../../../identity/infrastructure/http/session.guard';
import { ListMembersUseCase } from '../../application/list-members.use-case';
import { ListMembersResponseDto } from './members.dto';

/** Miembros activos de la empresa activa, para "Asignar a…" y la gestión de miembros. */
@ApiTags('members')
@ApiUnauthorizedResponse({ description: 'Sin sesión (`UNAUTHENTICATED`).' })
@ApiForbiddenResponse({ description: 'Sin empresa activa (`NO_ACTIVE_TENANT`).' })
@UseGuards(OriginGuard, SessionGuard)
@Controller({ path: 'members', version: '1' })
export class MembersController {
  constructor(private readonly listMembers: ListMembersUseCase) {}

  @Get()
  @ApiOkResponse({ type: ListMembersResponseDto.Output })
  async list(@CurrentTenant() tenant: TenantContext): Promise<ListMembersResponse> {
    const members = await this.listMembers.execute(tenant);
    return {
      items: members.map(({ id, displayName, role }) => ({ id, displayName, role })),
    };
  }
}
