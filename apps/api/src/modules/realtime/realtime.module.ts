import { Module } from '@nestjs/common';
import { DemoModule } from '../demo/demo.module';
import { OUTBOX_EVENT_STORE } from './application/ports/outbox-event-store';
import { REALTIME_PUBLISHER } from './application/ports/realtime-publisher';
import { OutboxDispatcher } from './infrastructure/outbox-dispatcher';
import { PrismaOutboxEventStore } from './infrastructure/prisma-outbox-event-store';
import { RealtimeGateway } from './infrastructure/realtime.gateway';
import { SocketIoRealtimePublisher } from './infrastructure/socket-io-realtime-publisher';

@Module({
  imports: [DemoModule],
  providers: [
    RealtimeGateway,
    SocketIoRealtimePublisher,
    { provide: REALTIME_PUBLISHER, useExisting: SocketIoRealtimePublisher },
    { provide: OUTBOX_EVENT_STORE, useClass: PrismaOutboxEventStore },
    OutboxDispatcher,
  ],
})
export class RealtimeModule {}
