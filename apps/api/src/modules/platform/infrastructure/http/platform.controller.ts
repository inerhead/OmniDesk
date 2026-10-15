import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  PlatformReasonRequestSchema,
  PlatformTenantsQuerySchema,
  PlatformTenantsResponseSchema,
  type PlatformTenantRow,
} from '@omnidesk/contracts';
import { createZodDto } from 'nestjs-zod';
import type { SessionContext } from '../../../../shared/application/request-context';
import { apiError } from '../../../../shared/infrastructure/http/api-error';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { CurrentSession } from '../../../../shared/infrastructure/http/request-context.decorators';
import {
  ApproveTenantUseCase,
  ListPlatformTenantsUseCase,
  RejectTenantUseCase,
  SuspendTenantUseCase,
  UnsuspendTenantUseCase,
  type PlatformActionResult,
  type PlatformListItem,
} from '../../application/platform.use-cases';
import { PlatformAdminGuard } from './platform-admin.guard';

class PlatformTenantsQueryDto extends createZodDto(PlatformTenantsQuerySchema) {}
class PlatformTenantsResponseDto extends createZodDto(PlatformTenantsResponseSchema) {}
class PlatformReasonRequestDto extends createZodDto(PlatformReasonRequestSchema) {}

function toRow(item: PlatformListItem): PlatformTenantRow {
  if (item.kind === 'rejection') {
    const { rejection } = item;
    return {
      id: rejection.id,
      name: rejection.tenantName,
      slug: rejection.tenantSlug,
      requester: rejection.requester,
      contactPhone: rejection.contactPhone,
      contactEmail: rejection.contactEmail,
      requestedAt: rejection.requestedAt.toISOString(),
      approvedAt: null,
      rejectedAt: rejection.rejectedAt.toISOString(),
      rejectionReason: rejection.reason,
      state: null,
      suspensionReason: null,
    };
  }
  const { tenant } = item;
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    requester: tenant.requester
      ? { displayName: tenant.requester.displayName, email: tenant.requester.email }
      : { displayName: 'Sin Owner', email: '' },
    contactPhone: tenant.contactPhone,
    contactEmail: tenant.contactEmail,
    requestedAt: tenant.requestedAt.toISOString(),
    approvedAt: tenant.approvedAt?.toISOString() ?? null,
    rejectedAt: null,
    rejectionReason: null,
    state: tenant.state === 'pending' ? null : tenant.state,
    suspensionReason: tenant.suspensionReason,
  };
}

function check(result: PlatformActionResult): void {
  if (result.kind === 'not-found') throw new NotFoundException('La empresa no existe');
  if (result.kind === 'not-pending') {
    throw apiError(HttpStatus.CONFLICT, 'NOT_PENDING', 'La empresa ya no está en revisión');
  }
  if (result.kind === 'not-approved') {
    throw apiError(HttpStatus.CONFLICT, 'NOT_APPROVED', 'La empresa no está aprobada');
  }
}

/** Panel de plataforma (SPEC 18): revisar solicitudes y suspender empresas. */
@ApiTags('platform')
@ApiUnauthorizedResponse({ description: 'Sin sesión (`UNAUTHENTICATED`).' })
@ApiNotFoundResponse({ description: 'No es admin de plataforma, o la empresa no existe.' })
@UseGuards(OriginGuard, PlatformAdminGuard)
@Controller({ path: 'platform/tenants', version: '1' })
export class PlatformController {
  constructor(
    private readonly list: ListPlatformTenantsUseCase,
    private readonly approveTenant: ApproveTenantUseCase,
    private readonly rejectTenant: RejectTenantUseCase,
    private readonly suspendTenant: SuspendTenantUseCase,
    private readonly unsuspendTenant: UnsuspendTenantUseCase,
  ) {}

  @Get()
  @ApiOkResponse({ type: PlatformTenantsResponseDto.Output })
  async tenants(@Query() query: PlatformTenantsQueryDto): Promise<PlatformTenantRow[]> {
    return (await this.list.execute(query.status)).map(toRow);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Aprobada.' })
  @ApiConflictResponse({ description: 'No está en revisión (`NOT_PENDING`).' })
  async approve(
    @CurrentSession() session: SessionContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    check(await this.approveTenant.execute(session.userId, id));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Rechazada: la empresa se borra.' })
  @ApiBadRequestResponse({ description: 'Motivo de menos de 5 o más de 500 caracteres.' })
  @ApiConflictResponse({ description: 'No está en revisión (`NOT_PENDING`).' })
  async reject(
    @CurrentSession() session: SessionContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PlatformReasonRequestDto,
  ): Promise<void> {
    check(await this.rejectTenant.execute(session.userId, id, body.reason));
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Suspendida (o ya lo estaba).' })
  @ApiBadRequestResponse({ description: 'Motivo de menos de 5 o más de 500 caracteres.' })
  @ApiConflictResponse({ description: 'No está aprobada (`NOT_APPROVED`).' })
  async suspend(
    @CurrentSession() session: SessionContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PlatformReasonRequestDto,
  ): Promise<void> {
    check(await this.suspendTenant.execute(session.userId, id, body.reason));
  }

  @Post(':id/unsuspend')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Sin suspensión (o ya no la tenía).' })
  @ApiConflictResponse({ description: 'No está aprobada (`NOT_APPROVED`).' })
  async unsuspend(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    check(await this.unsuspendTenant.execute(id));
  }
}
