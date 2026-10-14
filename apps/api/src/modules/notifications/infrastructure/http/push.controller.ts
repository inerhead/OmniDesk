import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Patch,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  NotificationPreferencesSchema,
  PushSubscriptionRequestSchema,
  type NotificationPreferences,
  type PushConfigResponse,
} from '@omnidesk/contracts';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ENV, type Env } from '../../../../shared/config/env';
import type { ActorContext } from '../../../../shared/application/request-context';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { Actor } from '../../../../shared/infrastructure/http/request-context.decorators';
import { SessionGuard } from '../../../identity/infrastructure/http/session.guard';
import { DeliverPushUseCase } from '../../application/deliver-push.use-case';
import { pushConfigured } from '../../application/push-configured';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '../../application/ports/notification.repository';

class PushSubscriptionRequestDto extends createZodDto(PushSubscriptionRequestSchema) {}
class DeletePushSubscriptionDto extends createZodDto(z.object({ endpoint: z.url() })) {}
class NotificationPreferencesDto extends createZodDto(NotificationPreferencesSchema) {}

@ApiTags('push')
@UseGuards(OriginGuard, SessionGuard)
@Controller({ version: '1' })
export class PushController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepository,
    private readonly push: DeliverPushUseCase,
  ) {}

  @Get('push/config')
  config(): PushConfigResponse {
    if (!pushConfigured(this.env) || !this.env.VAPID_PUBLIC_KEY) {
      throw new NotFoundException('Notificaciones no disponibles en este entorno');
    }
    return { vapidPublicKey: this.env.VAPID_PUBLIC_KEY };
  }

  @Post('push/subscriptions')
  async subscribe(
    @Actor() actor: ActorContext,
    @Body() body: PushSubscriptionRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.ensureEnabled();
    const result = await this.notifications.upsertSubscription(actor.userId, {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: request.header('user-agent')?.slice(0, 500) ?? null,
    });
    response.status(result === 'created' ? HttpStatus.CREATED : HttpStatus.OK);
  }

  @Delete('push/subscriptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsubscribe(
    @Actor() actor: ActorContext,
    @Body() body: DeletePushSubscriptionDto,
  ): Promise<void> {
    await this.notifications.deleteOwnSubscription(actor.userId, body.endpoint);
  }

  @Post('push/test')
  @HttpCode(HttpStatus.NO_CONTENT)
  async test(@Actor() actor: ActorContext): Promise<void> {
    const result = await this.push.sendTest(actor.userId, actor.tenantId);
    if (result === 'disabled') {
      throw new NotFoundException('Notificaciones no disponibles en este entorno');
    }
    if (result === 'no-devices') {
      throw new ServiceUnavailableException('Este usuario no tiene dispositivos suscritos');
    }
  }

  @Get('me/notification-preferences')
  async getPreferences(@Actor() actor: ActorContext): Promise<NotificationPreferences> {
    const prefs = await this.notifications.getPreferences(actor.tenantId, actor.memberId);
    if (!prefs) throw new NotFoundException('Miembro no encontrado');
    return prefs;
  }

  @Patch('me/notification-preferences')
  async updatePreferences(
    @Actor() actor: ActorContext,
    @Body() body: NotificationPreferencesDto,
  ): Promise<NotificationPreferences> {
    const prefs = await this.notifications.updatePreferences(actor.tenantId, actor.memberId, body);
    if (!prefs) throw new NotFoundException('Miembro no encontrado');
    return prefs;
  }

  private ensureEnabled(): void {
    if (!pushConfigured(this.env)) {
      throw new NotFoundException('Notificaciones no disponibles en este entorno');
    }
  }
}
