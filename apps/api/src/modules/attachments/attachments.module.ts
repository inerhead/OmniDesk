import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { IdentityModule } from '../identity/identity.module';
import { ENV, type Env } from '../../shared/config/env';
import { GetAttachmentContentUseCase } from './application/get-attachment-content.use-case';
import { SendAgentAttachmentUseCase } from './application/send-agent-attachment.use-case';
import { ATTACHMENT_REPOSITORY } from './application/ports/attachment.repository';
import { ATTACHMENT_STORAGE } from './application/ports/attachment-storage';
import { AttachmentsController } from './infrastructure/http/attachments.controller';
import { ConversationAttachmentsController } from './infrastructure/http/conversation-attachments.controller';
import { MemoryAttachmentStorage } from './infrastructure/memory-attachment-storage';
import { PrismaAttachmentRepository } from './infrastructure/prisma-attachment.repository';
import { S3AttachmentStorage } from './infrastructure/s3-attachment-storage';

@Module({
  imports: [ConversationsModule, IdentityModule],
  controllers: [AttachmentsController, ConversationAttachmentsController],
  providers: [
    GetAttachmentContentUseCase,
    SendAgentAttachmentUseCase,
    {
      provide: ATTACHMENT_STORAGE,
      inject: [ENV],
      useFactory: async (env: Env) => {
        if (env.ATTACHMENT_STORAGE_DRIVER === 'memory') return new MemoryAttachmentStorage();
        const storage = new S3AttachmentStorage(env);
        await storage.ensureBucket();
        return storage;
      },
    },
    { provide: ATTACHMENT_REPOSITORY, useClass: PrismaAttachmentRepository },
  ],
  exports: [ATTACHMENT_STORAGE, ATTACHMENT_REPOSITORY],
})
export class AttachmentsModule {}
