import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CreateInvitationRequestSchema,
  CreateInvitationResponseSchema,
  InvitationPreviewSchema,
  ListInvitationsResponseSchema,
  type CreateInvitationResponse,
  type InvitationPreview,
  type ListInvitationsResponse,
} from '@omnidesk/contracts';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import type { ActorContext, SessionContext } from '../../../../shared/application/request-context';
import { ENV, type Env } from '../../../../shared/config/env';
import { publicUrl } from '../../../../shared/config/public-url';
import { apiError } from '../../../../shared/infrastructure/http/api-error';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import {
  Actor,
  CurrentSession,
} from '../../../../shared/infrastructure/http/request-context.decorators';
import {
  SessionGuard,
  UserSessionGuard,
} from '../../../identity/infrastructure/http/session.guard';
import { sendLogo } from '../../../tenancy/infrastructure/http/tenant-logo.controller';
import {
  AcceptInvitationUseCase,
  CreateInvitationUseCase,
  GetInvitationLogoUseCase,
  ListInvitationsUseCase,
  PreviewInvitationUseCase,
  RevokeInvitationUseCase,
} from '../../application/invitations.use-cases';

class CreateInvitationRequestDto extends createZodDto(CreateInvitationRequestSchema) {}
class CreateInvitationResponseDto extends createZodDto(CreateInvitationResponseSchema) {}
class ListInvitationsResponseDto extends createZodDto(ListInvitationsResponseSchema) {}
class InvitationPreviewDto extends createZodDto(InvitationPreviewSchema) {}

/** Invitaciones por enlace a la empresa activa de la sesión (sin email). */
@ApiTags('invitations')
@UseGuards(OriginGuard)
@Controller({ path: 'invitations', version: '1' })
export class InvitationsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly createInvitation: CreateInvitationUseCase,
    private readonly listInvitations: ListInvitationsUseCase,
    private readonly revokeInvitation: RevokeInvitationUseCase,
    private readonly previewInvitation: PreviewInvitationUseCase,
    private readonly acceptInvitation: AcceptInvitationUseCase,
    private readonly invitationLogo: GetInvitationLogoUseCase,
  ) {}

  @Post()
  @UseGuards(SessionGuard)
  @ApiCreatedResponse({ type: CreateInvitationResponseDto.Output })
  @ApiForbiddenResponse({ description: 'El rol no puede invitar con ese rol.' })
  @ApiConflictResponse({ description: 'Ya es miembro (`ALREADY_MEMBER`).' })
  async create(
    @Actor() actor: ActorContext,
    @Body() body: CreateInvitationRequestDto,
  ): Promise<CreateInvitationResponse> {
    const result = await this.createInvitation.execute(actor, body);
    if (result.kind === 'forbidden') {
      throw new ForbiddenException('Tu rol no puede invitar con ese rol');
    }
    if (result.kind === 'already-member') {
      throw apiError(HttpStatus.CONFLICT, 'ALREADY_MEMBER', 'Esa persona ya es miembro');
    }
    return {
      id: result.invitation.id,
      url: publicUrl(this.env.APP_URL, `/invite/${result.token}`),
      expiresAt: result.invitation.expiresAt.toISOString(),
    };
  }

  @Get()
  @UseGuards(SessionGuard)
  @ApiOkResponse({ type: ListInvitationsResponseDto.Output })
  @ApiForbiddenResponse({ description: 'Solo OWNER y ADMIN.' })
  async list(@Actor() actor: ActorContext): Promise<ListInvitationsResponse> {
    const result = await this.listInvitations.execute(actor);
    if (result === 'forbidden') throw new ForbiddenException('Tu rol no puede ver invitaciones');
    return {
      items: result.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        invitedBy: invitation.invitedBy,
        createdAt: invitation.createdAt.toISOString(),
        expiresAt: invitation.expiresAt.toISOString(),
      })),
    };
  }

  @Delete(':id')
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Invitación revocada.' })
  @ApiNotFoundResponse({ description: 'No existe o ya no está pendiente.' })
  async revoke(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    const result = await this.revokeInvitation.execute(actor, id);
    if (result === 'forbidden') throw new ForbiddenException('Tu rol no puede revocarla');
    if (result === 'not-found') throw new NotFoundException('Invitación no encontrada');
  }

  /** Pública: la pantalla `/invite/:token` la muestra antes de iniciar sesión. */
  @Get('by-token/:token')
  @ApiOkResponse({ type: InvitationPreviewDto.Output })
  @ApiNotFoundResponse({ description: 'Enlace desconocido.' })
  async preview(@Param('token') token: string): Promise<InvitationPreview> {
    const preview = await this.previewInvitation.execute(token);
    if (!preview) throw new NotFoundException('Invitación no válida');
    return preview;
  }

  /** Pública: el logo de la empresa en `/invite/:token`, solo con una invitación vigente. */
  @Get(':token/logo')
  @ApiOkResponse({ description: 'El logo (JPEG o WebP).' })
  @ApiNotFoundResponse({
    description: 'Sin logo, o enlace desconocido, vencido, usado o revocado.',
  })
  async logo(@Param('token') token: string, @Res() res: Response): Promise<void> {
    sendLogo(res, await this.invitationLogo.execute(token));
  }

  @Post('by-token/:token/accept')
  @UseGuards(UserSessionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Ahora es miembro y la empresa es la activa.' })
  @ApiGoneResponse({ description: 'Vencida, ya usada o revocada (`INVITATION_EXPIRED`).' })
  @ApiConflictResponse({
    description:
      'Otro email (`INVITATION_EMAIL_MISMATCH`), ya es miembro (`ALREADY_MEMBER`), la empresa está inactiva (`TENANT_INACTIVE`) o suspendida (`TENANT_SUSPENDED`).',
  })
  async accept(
    @CurrentSession() session: SessionContext,
    @Param('token') token: string,
  ): Promise<void> {
    const result = await this.acceptInvitation.execute(session, token);
    switch (result.kind) {
      case 'ok':
        return;
      case 'not-found':
        throw new NotFoundException('Invitación no válida');
      case 'expired':
        throw apiError(HttpStatus.GONE, 'INVITATION_EXPIRED', 'La invitación ya no es válida');
      case 'email-mismatch':
        throw apiError(
          HttpStatus.CONFLICT,
          'INVITATION_EMAIL_MISMATCH',
          'La invitación es para otro email',
        );
      case 'already-member':
        throw apiError(HttpStatus.CONFLICT, 'ALREADY_MEMBER', 'Ya eres miembro de esta empresa');
      case 'tenant-inactive':
        throw apiError(HttpStatus.CONFLICT, 'TENANT_INACTIVE', 'La empresa está inactiva');
      case 'tenant-suspended':
        throw apiError(
          HttpStatus.CONFLICT,
          'TENANT_SUSPENDED',
          'La empresa está suspendida por la plataforma',
        );
    }
  }
}
