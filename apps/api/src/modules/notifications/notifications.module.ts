import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { DeliverPushUseCase, PUSH_SENDER } from './application/deliver-push.use-case';
import { EnqueueNotificationUseCase } from './application/enqueue-notification.use-case';
import { NOTIFICATION_REPOSITORY } from './application/ports/notification.repository';
import { PUSH_TRANSPORT } from './application/ports/push-transport';
import { PresenceRegistry } from './application/presence-registry';
import { PushController } from './infrastructure/http/push.controller';
import { PrismaNotificationRepository } from './infrastructure/prisma-notification.repository';
import { WebPushTransport } from './infrastructure/web-push.transport';

@Module({
  imports: [IdentityModule],
  controllers: [PushController],
  providers: [
    PresenceRegistry,
    EnqueueNotificationUseCase,
    DeliverPushUseCase,
    { provide: NOTIFICATION_REPOSITORY, useClass: PrismaNotificationRepository },
    { provide: PUSH_TRANSPORT, useClass: WebPushTransport },
    { provide: PUSH_SENDER, useExisting: DeliverPushUseCase },
  ],
  exports: [EnqueueNotificationUseCase, PresenceRegistry, PUSH_SENDER],
})
export class NotificationsModule {}
