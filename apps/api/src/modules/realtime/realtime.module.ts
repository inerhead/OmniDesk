import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DispatchOutboundMessageUseCase } from '../messaging/application/dispatch-outbound-message.use-case';
import { MessagingModule } from '../messaging/messaging.module';
import { AttachmentDownloadWorker } from '../whatsapp/attachment-download-worker';
import { ATTACHMENT_DOWNLOADER } from './application/ports/attachment-downloader';
import { OUTBOUND_MESSAGE_SENDER } from './application/ports/outbound-message-sender';
import { OUTBOX_EVENT_STORE } from './application/ports/outbox-event-store';
import { REALTIME_PUBLISHER } from './application/ports/realtime-publisher';
import { OutboxDispatcher } from './infrastructure/outbox-dispatcher';
import { PrismaOutboxEventStore } from './infrastructure/prisma-outbox-event-store';
import { RealtimeGateway } from './infrastructure/realtime.gateway';
import { SocketIoRealtimePublisher } from './infrastructure/socket-io-realtime-publisher';

@Module({
  imports: [IdentityModule, MessagingModule, WhatsAppModule, NotificationsModule],
  providers: [
    RealtimeGateway,
    SocketIoRealtimePublisher,
    { provide: REALTIME_PUBLISHER, useExisting: SocketIoRealtimePublisher },
    { provide: OUTBOX_EVENT_STORE, useClass: PrismaOutboxEventStore },
    { provide: OUTBOUND_MESSAGE_SENDER, useExisting: DispatchOutboundMessageUseCase },
    { provide: ATTACHMENT_DOWNLOADER, useExisting: AttachmentDownloadWorker },
    OutboxDispatcher,
  ],
})
export class RealtimeModule {}
