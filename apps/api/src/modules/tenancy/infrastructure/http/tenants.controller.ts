import { Body, Controller, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CreateTenantRequestSchema, TenantSchema, type Tenant } from '@omnidesk/contracts';
import { createZodDto } from 'nestjs-zod';
import type { SessionContext } from '../../../../shared/application/request-context';
import { apiError } from '../../../../shared/infrastructure/http/api-error';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { CurrentSession } from '../../../../shared/infrastructure/http/request-context.decorators';
import { UserSessionGuard } from '../../../identity/infrastructure/http/session.guard';
import { CreateTenantUseCase } from '../../application/create-tenant.use-case';

class CreateTenantRequestDto extends createZodDto(CreateTenantRequestSchema) {}
class TenantDto extends createZodDto(TenantSchema) {}

@ApiTags('tenants')
@ApiUnauthorizedResponse({ description: 'Sin sesión (`UNAUTHENTICATED`).' })
@UseGuards(OriginGuard, UserSessionGuard)
@Controller({ path: 'tenants', version: '1' })
export class TenantsController {
  constructor(private readonly createTenant: CreateTenantUseCase) {}

  @Post()
  @ApiCreatedResponse({
    type: TenantDto.Output,
    description:
      'Empresa creada y activa: en revisión (`PENDING`) salvo para un admin de plataforma.',
  })
  @ApiConflictResponse({
    description:
      'El slug ya existe (`SLUG_TAKEN`) o ya hay una solicitud en revisión (`REQUEST_PENDING`).',
  })
  @ApiForbiddenResponse({
    description: 'Solo quien no tiene empresa o es OWNER en alguna (`TENANT_CREATION_FORBIDDEN`).',
  })
  async create(
    @CurrentSession() session: SessionContext,
    @Body() body: CreateTenantRequestDto,
  ): Promise<Tenant> {
    const result = await this.createTenant.execute(session, body);
    if (result.kind === 'slug-taken') {
      throw apiError(HttpStatus.CONFLICT, 'SLUG_TAKEN', 'Ese identificador ya está en uso');
    }
    if (result.kind === 'request-pending') {
      throw apiError(
        HttpStatus.CONFLICT,
        'REQUEST_PENDING',
        'Ya tienes una solicitud de empresa en revisión',
      );
    }
    if (result.kind === 'forbidden') {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'TENANT_CREATION_FORBIDDEN',
        'Solo un OWNER puede crear otra empresa',
      );
    }
    if (result.kind === 'user-not-found') {
      throw apiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Inicia sesión para continuar');
    }
    return result.tenant;
  }
}
