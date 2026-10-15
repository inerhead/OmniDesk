import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Patch,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import {
  DeactivateTenantRequestSchema,
  RetentionPreviewQuerySchema,
  RetentionPreviewResponseSchema,
  UpdateTenantRequestSchema,
  type RetentionPreviewResponse,
  type TenantDetails,
} from '@omnidesk/contracts';
import { createZodDto } from 'nestjs-zod';
import type { ActorContext } from '../../../../shared/application/request-context';
import { apiError } from '../../../../shared/infrastructure/http/api-error';
import {
  ImageUploadExceptionFilter,
  ImageUploadInterceptor,
} from '../../../../shared/infrastructure/http/image-upload';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { Actor } from '../../../../shared/infrastructure/http/request-context.decorators';
import {
  AllowInactiveTenant,
  SessionGuard,
} from '../../../identity/infrastructure/http/session.guard';
import {
  GetCurrentTenantUseCase,
  GetRetentionPreviewUseCase,
  UpdateCurrentTenantUseCase,
  type UpdateTenantResult,
} from '../../application/manage-tenant.use-cases';
import {
  RemoveTenantLogoUseCase,
  UploadTenantLogoUseCase,
  type UploadTenantLogoResult,
} from '../../application/tenant-logo.use-cases';
import {
  DeactivateTenantUseCase,
  ReactivateTenantUseCase,
  type DeactivateTenantResult,
} from '../../application/tenant-status.use-cases';
import { TenantDetailsDto, toTenantDetailsDto } from './tenant-details.dto';

class UpdateTenantRequestDto extends createZodDto(UpdateTenantRequestSchema) {}
class DeactivateTenantRequestDto extends createZodDto(DeactivateTenantRequestSchema) {}
class RetentionPreviewQueryDto extends createZodDto(RetentionPreviewQuerySchema) {}
class RetentionPreviewResponseDto extends createZodDto(RetentionPreviewResponseSchema) {}

/** Traduce los resultados comunes de los casos de uso de la empresa a HTTP. */
export function tenantResponse(
  result: UpdateTenantResult | UploadTenantLogoResult | DeactivateTenantResult,
): TenantDetails {
  switch (result.kind) {
    case 'confirmation-mismatch':
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'CONFIRMATION_MISMATCH',
        'Escribe el nombre exacto de la empresa para confirmar',
      );
    case 'unsupported-type':
      throw new UnsupportedMediaTypeException('El logo debe ser JPEG o WebP');
    case 'too-large':
      throw new PayloadTooLargeException('El logo supera 1 MB');
    case 'forbidden':
      throw new ForbiddenException('Solo un Owner gestiona la empresa');
    case 'not-found':
      throw new NotFoundException('Empresa no encontrada');
    case 'slug-taken':
      throw apiError(HttpStatus.CONFLICT, 'SLUG_TAKEN', 'Ese identificador ya está en uso');
    case 'demo-slug-locked':
      throw apiError(
        HttpStatus.CONFLICT,
        'DEMO_SLUG_LOCKED',
        'La empresa demo conserva su identificador',
      );
    case 'ok':
      return toTenantDetailsDto(result.tenant);
  }
}

/** La empresa activa de la sesión (SPEC 16): solo OWNER. */
@ApiTags('tenants')
@ApiUnauthorizedResponse({ description: 'Sin sesión (`UNAUTHENTICATED`).' })
@ApiForbiddenResponse({ description: 'No es OWNER de la empresa activa.' })
@UseGuards(OriginGuard, SessionGuard)
@AllowInactiveTenant()
@Controller({ path: 'tenants/current', version: '1' })
export class CurrentTenantController {
  constructor(
    private readonly getCurrent: GetCurrentTenantUseCase,
    private readonly updateCurrent: UpdateCurrentTenantUseCase,
    private readonly uploadLogo: UploadTenantLogoUseCase,
    private readonly removeLogo: RemoveTenantLogoUseCase,
    private readonly deactivateTenant: DeactivateTenantUseCase,
    private readonly reactivateTenant: ReactivateTenantUseCase,
    private readonly retentionPreview: GetRetentionPreviewUseCase,
  ) {}

  @Get()
  @ApiOkResponse({ type: TenantDetailsDto.Output })
  async get(@Actor() actor: ActorContext): Promise<TenantDetails> {
    return tenantResponse(await this.getCurrent.execute(actor));
  }

  @Patch()
  @ApiOkResponse({ type: TenantDetailsDto.Output })
  @ApiConflictResponse({
    description: 'Slug en uso (`SLUG_TAKEN`) o slug de la demo (`DEMO_SLUG_LOCKED`).',
  })
  async update(
    @Actor() actor: ActorContext,
    @Body() body: UpdateTenantRequestDto,
  ): Promise<TenantDetails> {
    return tenantResponse(await this.updateCurrent.execute(actor, body));
  }

  /** Cuántas conversaciones cerradas borraría la próxima ejecución de la retención (SPEC 12). */
  @Get('retention-preview')
  @ApiOkResponse({ type: RetentionPreviewResponseDto.Output })
  @ApiBadRequestResponse({ description: '`days` no es 90, 180 ni 365.' })
  async preview(
    @Actor() actor: ActorContext,
    @Query() query: RetentionPreviewQueryDto,
  ): Promise<RetentionPreviewResponse> {
    const result = await this.retentionPreview.execute(actor, query.days);
    if (result.kind === 'forbidden')
      throw new ForbiddenException('Solo un Owner gestiona la empresa');
    return { conversations: result.conversations };
  }

  /** El recorte ya reducido en la web (512×512, WebP o JPEG). */
  @Put('logo')
  @UseFilters(ImageUploadExceptionFilter)
  @UseInterceptors(ImageUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOkResponse({ type: TenantDetailsDto.Output, description: 'Empresa con el logo nuevo.' })
  @ApiBadRequestResponse({ description: 'Falta el archivo.' })
  @ApiPayloadTooLargeResponse({ description: 'Más de 1 MB.' })
  @ApiUnsupportedMediaTypeResponse({ description: 'No es JPEG ni WebP por sus bytes.' })
  async putLogo(
    @Actor() actor: ActorContext,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<TenantDetails> {
    if (!file) throw new BadRequestException('Falta el archivo');
    return tenantResponse(await this.uploadLogo.execute(actor, file.buffer));
  }

  @Delete('logo')
  @ApiOkResponse({ type: TenantDetailsDto.Output, description: 'Empresa sin logo (iniciales).' })
  async deleteLogo(@Actor() actor: ActorContext): Promise<TenantDetails> {
    return tenantResponse(await this.removeLogo.execute(actor));
  }

  /** Corta la atención y el acceso de Admin y Agent. Repetir responde 200 sin cambios. */
  @Post('deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TenantDetailsDto.Output, description: 'Empresa inactiva.' })
  @ApiBadRequestResponse({ description: 'El nombre no coincide (`CONFIRMATION_MISMATCH`).' })
  async deactivate(
    @Actor() actor: ActorContext,
    @Body() body: DeactivateTenantRequestDto,
  ): Promise<TenantDetails> {
    return tenantResponse(await this.deactivateTenant.execute(actor, body.confirmName));
  }

  /** Devuelve el acceso y reenvía los mensajes cortados con la ventana de 18 h abierta. */
  @Post('reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TenantDetailsDto.Output, description: 'Empresa activa.' })
  async reactivate(@Actor() actor: ActorContext): Promise<TenantDetails> {
    return tenantResponse(await this.reactivateTenant.execute(actor));
  }
}
