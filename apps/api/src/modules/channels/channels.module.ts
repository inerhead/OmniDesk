import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import {
  CreateChannelUseCase,
  GenerateN8nClientSecretUseCase,
  ListChannelsUseCase,
  ListInboxChannelsUseCase,
  RemoveN8nClientUseCase,
  TestChannelConnectionUseCase,
  UpdateChannelUseCase,
  WebhookUrlValidator,
} from './application/channels.use-cases';
import { CHANNEL_SECRET_CIPHER } from './application/ports/channel-secret-cipher';
import { CHANNEL_WEBHOOK_TESTER } from './application/ports/channel-webhook-tester';
import { CHANNEL_REPOSITORY } from './application/ports/channel.repository';
import { AesChannelSecretCipher } from './infrastructure/aes-channel-secret-cipher';
import { HttpChannelWebhookTester } from './infrastructure/http-channel-webhook-tester';
import { ChannelCredentialGuard } from './infrastructure/http/channel-credential.guard';
import { ChannelsController } from './infrastructure/http/channels.controller';
import { PrismaChannelRepository } from './infrastructure/prisma-channel.repository';

/**
 * Canales: credenciales de integración entrantes (API key + HMAC, SPEC 09), credenciales de cliente
 * hacia n8n (SPEC 22) y su gestión desde la web.
 */
@Module({
  imports: [IdentityModule],
  controllers: [ChannelsController],
  providers: [
    { provide: CHANNEL_REPOSITORY, useClass: PrismaChannelRepository },
    { provide: CHANNEL_SECRET_CIPHER, useClass: AesChannelSecretCipher },
    { provide: CHANNEL_WEBHOOK_TESTER, useClass: HttpChannelWebhookTester },
    ChannelCredentialGuard,
    WebhookUrlValidator,
    ListChannelsUseCase,
    ListInboxChannelsUseCase,
    CreateChannelUseCase,
    UpdateChannelUseCase,
    TestChannelConnectionUseCase,
    GenerateN8nClientSecretUseCase,
    RemoveN8nClientUseCase,
  ],
  exports: [CHANNEL_REPOSITORY, CHANNEL_SECRET_CIPHER, ChannelCredentialGuard],
})
export class ChannelsModule {}
