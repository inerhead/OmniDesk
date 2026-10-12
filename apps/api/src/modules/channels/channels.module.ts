import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import {
  CreateChannelUseCase,
  IssueChannelCredentialsUseCase,
  ListChannelsUseCase,
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

/** Canales: credenciales de integración (API key + HMAC) y su gestión desde la web (SPEC 09). */
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
    CreateChannelUseCase,
    UpdateChannelUseCase,
    IssueChannelCredentialsUseCase,
    TestChannelConnectionUseCase,
  ],
  exports: [CHANNEL_REPOSITORY, CHANNEL_SECRET_CIPHER, ChannelCredentialGuard],
})
export class ChannelsModule {}
