import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { DispatchOutboundMessageUseCase } from './application/dispatch-outbound-message.use-case';
import { MESSAGING_PROVIDER } from './application/ports/messaging-provider.port';
import { SimulatedMessagingProvider } from './infrastructure/simulated-messaging-provider';

/**
 * Hoy hay un único adaptador (`MESSAGING_PROVIDER=simulated`). Con dos, la selección pasa a
 * `Channel.provider` (arquitectura §13).
 */
@Module({
  imports: [ConversationsModule],
  providers: [
    SimulatedMessagingProvider,
    { provide: MESSAGING_PROVIDER, useExisting: SimulatedMessagingProvider },
    DispatchOutboundMessageUseCase,
  ],
  exports: [DispatchOutboundMessageUseCase],
})
export class MessagingModule {}
