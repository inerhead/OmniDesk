import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { ChannelsModule } from '../channels/channels.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { IdentityModule } from '../identity/identity.module';
import { AttachmentDownloadWorker } from './attachment-download-worker';
import { WhatsAppSettings, WhatsAppSettingsController } from './whatsapp-settings';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppCloudProvider } from './whatsapp-cloud-provider';
import { AiReplyWorker } from './ai-reply-worker';
@Module({
  imports: [AttachmentsModule, ChannelsModule, ConversationsModule, IdentityModule],
  controllers: [WhatsAppSettingsController, WhatsAppWebhookController],
  providers: [WhatsAppSettings, WhatsAppCloudProvider, AiReplyWorker, AttachmentDownloadWorker],
  exports: [WhatsAppCloudProvider, AiReplyWorker, AttachmentDownloadWorker],
})
export class WhatsAppModule {}
