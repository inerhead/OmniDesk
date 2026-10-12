import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { InboundMessagesController } from './infrastructure/http/inbound-messages.controller';
import { OutboundMessagesController } from './infrastructure/http/outbound-messages.controller';

/** Endpoints servicio a servicio (n8n, simulador). El tenant y el canal salen de la credencial. */
@Module({
  imports: [ChannelsModule, ConversationsModule],
  controllers: [InboundMessagesController, OutboundMessagesController],
})
export class IntegrationsModule {}
