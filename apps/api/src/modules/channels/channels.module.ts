import { Module } from '@nestjs/common';
import { CHANNEL_REPOSITORY } from './application/ports/channel.repository';
import { ChannelCredentialGuard } from './infrastructure/http/channel-credential.guard';
import { PrismaChannelRepository } from './infrastructure/prisma-channel.repository';

@Module({
  providers: [
    { provide: CHANNEL_REPOSITORY, useClass: PrismaChannelRepository },
    ChannelCredentialGuard,
  ],
  exports: [CHANNEL_REPOSITORY, ChannelCredentialGuard],
})
export class ChannelsModule {}
