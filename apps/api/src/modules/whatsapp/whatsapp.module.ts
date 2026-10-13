import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { IdentityModule } from '../identity/identity.module';
import { WhatsAppSettings, WhatsAppSettingsController } from './whatsapp-settings';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppCloudProvider } from './whatsapp-cloud-provider';
import { AiReplyWorker } from './ai-reply-worker';
@Module({
  imports: [ChannelsModule, ConversationsModule, IdentityModule],
  controllers: [WhatsAppSettingsController, WhatsAppWebhookController],
  providers: [WhatsAppSettings, WhatsAppCloudProvider, AiReplyWorker],
  exports: [WhatsAppCloudProvider, AiReplyWorker],
})
export class WhatsAppModule {}
