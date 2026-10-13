import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { DispatchOutboundMessageUseCase } from './application/dispatch-outbound-message.use-case';
import { MESSAGING_PROVIDER_REGISTRY } from './application/ports/messaging-provider.port';
import { ChannelMessagingProviderRegistry } from './infrastructure/messaging-provider-registry';
import { N8nMessagingProvider } from './infrastructure/n8n-messaging-provider';
import { SimulatedMessagingProvider } from './infrastructure/simulated-messaging-provider';

/** Envío saliente: un adaptador por `Channel.provider` (arquitectura §13), elegido por el registro. */
@Module({
  imports: [ConversationsModule, ChannelsModule, WhatsAppModule],
  providers: [
    SimulatedMessagingProvider,
    N8nMessagingProvider,
    { provide: MESSAGING_PROVIDER_REGISTRY, useClass: ChannelMessagingProviderRegistry },
    DispatchOutboundMessageUseCase,
  ],
  exports: [DispatchOutboundMessageUseCase],
})
export class MessagingModule {}
