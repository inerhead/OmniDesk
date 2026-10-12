import { Module } from '@nestjs/common';
import { DemoModule } from '../demo/demo.module';
import { DispatchOutboundMessageUseCase } from '../messaging/application/dispatch-outbound-message.use-case';
import { MessagingModule } from '../messaging/messaging.module';
import { OUTBOUND_MESSAGE_SENDER } from './application/ports/outbound-message-sender';
import { OUTBOX_EVENT_STORE } from './application/ports/outbox-event-store';
import { REALTIME_PUBLISHER } from './application/ports/realtime-publisher';
import { OutboxDispatcher } from './infrastructure/outbox-dispatcher';
import { PrismaOutboxEventStore } from './infrastructure/prisma-outbox-event-store';
import { RealtimeGateway } from './infrastructure/realtime.gateway';
import { SocketIoRealtimePublisher } from './infrastructure/socket-io-realtime-publisher';

@Module({
  imports: [DemoModule, MessagingModule],
  providers: [
    RealtimeGateway,
    SocketIoRealtimePublisher,
    { provide: REALTIME_PUBLISHER, useExisting: SocketIoRealtimePublisher },
    { provide: OUTBOX_EVENT_STORE, useClass: PrismaOutboxEventStore },
    { provide: OUTBOUND_MESSAGE_SENDER, useExisting: DispatchOutboundMessageUseCase },
    OutboxDispatcher,
  ],
})
export class RealtimeModule {}
