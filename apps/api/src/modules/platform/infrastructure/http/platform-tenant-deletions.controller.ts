import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  PlatformTenantDeletionsResponseSchema,
  type PlatformTenantDeletionRow,
} from '@omnidesk/contracts';
import { createZodDto } from 'nestjs-zod';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { ListTenantDeletionsUseCase } from '../../application/tenant-deletion.use-cases';
import { PlatformAdminGuard } from './platform-admin.guard';

class PlatformTenantDeletionsResponseDto extends createZodDto(
  PlatformTenantDeletionsResponseSchema,
) {}

/** Pestaña "Borradas" de `/platform` (SPEC 20): las constancias, también las que siguen en curso. */
@ApiTags('platform')
@ApiUnauthorizedResponse({ description: 'Sin sesión (`UNAUTHENTICATED`).' })
@ApiNotFoundResponse({ description: 'No es admin de plataforma.' })
@UseGuards(OriginGuard, PlatformAdminGuard)
@Controller({ path: 'platform/tenant-deletions', version: '1' })
export class PlatformTenantDeletionsController {
  constructor(private readonly list: ListTenantDeletionsUseCase) {}

  @Get()
  @ApiOkResponse({ type: PlatformTenantDeletionsResponseDto.Output })
  async deletions(): Promise<PlatformTenantDeletionRow[]> {
    return (await this.list.execute()).map((record) => ({
      id: record.id,
      tenantName: record.tenantName,
      tenantSlug: record.tenantSlug,
      requestedByEmail: record.requestedByEmail,
      requestedAt: record.requestedAt.toISOString(),
      completedAt: record.completedAt?.toISOString() ?? null,
      membersDeleted: record.membersDeleted,
      usersDeleted: record.usersDeleted,
      conversationsDeleted: record.conversationsDeleted,
      messagesDeleted: record.messagesDeleted,
      attachmentsDeleted: record.attachmentsDeleted,
    }));
  }
}
