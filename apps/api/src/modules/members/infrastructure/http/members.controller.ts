import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { ListMembersResponse } from '@omnidesk/contracts';
import type { TenantContext } from '../../../../shared/application/request-context';
import { CurrentTenant } from '../../../../shared/infrastructure/http/request-context.decorators';
import { DemoTenantGuard } from '../../../demo/infrastructure/http/demo-tenant.guard';
import { ListMembersUseCase } from '../../application/list-members.use-case';
import { ListMembersResponseDto } from './members.dto';

/** Miembros del tenant, para el selector "Actuar como" y el menú "Asignar a…". */
@ApiTags('members')
@ApiUnauthorizedResponse({
  description: 'DEMO_MODE desactivado: la lectura requiere autenticación.',
})
@UseGuards(DemoTenantGuard)
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
