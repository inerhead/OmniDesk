import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module';
import { DemoModule } from '../demo/demo.module';
import { MembersModule } from '../members/members.module';
import { AssignConversationUseCase } from './application/assign-conversation.use-case';
import { CloseConversationUseCase } from './application/close-conversation.use-case';
import { ConversationCommandRunner } from './application/conversation-command-runner';
import { GetConversationSummaryUseCase } from './application/get-conversation-summary.use-case';
import { ListConversationsUseCase } from './application/list-conversations.use-case';
import { ListMessagesUseCase } from './application/list-messages.use-case';
import { CONVERSATION_READ_MODEL } from './application/ports/conversation-read-model';
import { CONVERSATION_REPOSITORY } from './application/ports/conversation.repository';
import { ListTimelineUseCase } from './application/list-timeline.use-case';
import { RegisterAiReplyUseCase } from './application/register-ai-reply.use-case';
import { RegisterInboundMessageUseCase } from './application/register-inbound-message.use-case';
import { ReleaseConversationUseCase } from './application/release-conversation.use-case';
import { ReopenConversationUseCase } from './application/reopen-conversation.use-case';
import { ConversationsController } from './infrastructure/http/conversations.controller';
import { PrismaConversationReadModel } from './infrastructure/prisma-conversation-read-model';
import { PrismaConversationRepository } from './infrastructure/prisma-conversation.repository';

@Module({
  imports: [ContactsModule, DemoModule, MembersModule],
  controllers: [ConversationsController],
  providers: [
    { provide: CONVERSATION_REPOSITORY, useClass: PrismaConversationRepository },
    { provide: CONVERSATION_READ_MODEL, useClass: PrismaConversationReadModel },
    RegisterInboundMessageUseCase,
    RegisterAiReplyUseCase,
    ListConversationsUseCase,
    ListMessagesUseCase,
    ListTimelineUseCase,
    GetConversationSummaryUseCase,
    ConversationCommandRunner,
    AssignConversationUseCase,
    ReleaseConversationUseCase,
    CloseConversationUseCase,
    ReopenConversationUseCase,
  ],
  exports: [RegisterInboundMessageUseCase, RegisterAiReplyUseCase],
})
export class ConversationsModule {}
