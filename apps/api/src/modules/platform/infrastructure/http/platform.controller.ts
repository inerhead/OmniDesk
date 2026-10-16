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
  ApiAcceptedResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  DeleteTenantRequestSchema,
  PlatformReasonRequestSchema,
  PlatformTenantsQuerySchema,
  PlatformTenantsResponseSchema,
  TenantDeletionPreviewSchema,
  type PlatformTenantRow,
  type TenantDeletionPreview,
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
import {
  PreviewTenantDeletionUseCase,
  RequestTenantDeletionUseCase,
  type RequestTenantDeletionResult,
} from '../../application/tenant-deletion.use-cases';
import { PlatformAdminGuard } from './platform-admin.guard';

class PlatformTenantsQueryDto extends createZodDto(PlatformTenantsQuerySchema) {}
class PlatformTenantsResponseDto extends createZodDto(PlatformTenantsResponseSchema) {}
class PlatformReasonRequestDto extends createZodDto(PlatformReasonRequestSchema) {}
class DeleteTenantRequestDto extends createZodDto(DeleteTenantRequestSchema) {}
class TenantDeletionPreviewDto extends createZodDto(TenantDeletionPreviewSchema) {}

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
    // Aprobadas no lista las que están en borrado (SPEC 20); en revisión no lleva estado.
    state: tenant.state === 'pending' || tenant.state === 'deleting' ? null : tenant.state,
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
  if (result.kind === 'deleting') {
    throw apiError(HttpStatus.CONFLICT, 'TENANT_DELETING', 'La empresa se está borrando');
  }
}

function checkDeletion(result: RequestTenantDeletionResult): void {
  switch (result.kind) {
    case 'not-found':
      throw new NotFoundException('La empresa no existe');
    case 'demo-locked':
      throw apiError(HttpStatus.CONFLICT, 'DEMO_TENANT_LOCKED', 'La empresa demo no se borra');
    case 'not-suspended':
      throw apiError(HttpStatus.CONFLICT, 'NOT_SUSPENDED', 'Solo se borra una empresa suspendida');
    case 'confirmation-mismatch':
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'CONFIRMATION_MISMATCH',
        'El identificador no coincide con el de la empresa',
      );
    case 'ok':
      return;
  }
}

/** Panel de plataforma (SPEC 18 y 20): revisar solicitudes, suspender y borrar empresas. */
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
    private readonly requestDeletion: RequestTenantDeletionUseCase,
    private readonly previewDeletion: PreviewTenantDeletionUseCase,
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
  @ApiConflictResponse({
    description: 'No está aprobada (`NOT_APPROVED`) o se está borrando (`TENANT_DELETING`).',
  })
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
  @ApiConflictResponse({
    description: 'No está aprobada (`NOT_APPROVED`) o se está borrando (`TENANT_DELETING`).',
  })
  async unsuspend(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    check(await this.unsuspendTenant.execute(id));
  }

  @Get(':id/deletion-preview')
  @ApiOkResponse({ type: TenantDeletionPreviewDto.Output })
  async deletionPreview(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<TenantDeletionPreview> {
    const preview = await this.previewDeletion.execute(id);
    if (!preview) throw new NotFoundException('La empresa no existe');
    return preview;
  }

  @Post(':id/delete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: 'Borrado pedido (o ya en curso): sigue en segundo plano.' })
  @ApiBadRequestResponse({ description: 'El slug no coincide (`CONFIRMATION_MISMATCH`).' })
  @ApiConflictResponse({
    description: 'No está suspendida (`NOT_SUSPENDED`) o es la demo (`DEMO_TENANT_LOCKED`).',
  })
  async delete(
    @CurrentSession() session: SessionContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: DeleteTenantRequestDto,
  ): Promise<void> {
    checkDeletion(await this.requestDeletion.execute(session.userId, id, body.confirmSlug));
  }
}
