import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module';
import { IdentityModule } from '../identity/identity.module';
import { MembersModule } from '../members/members.module';
import { AssignConversationUseCase } from './application/assign-conversation.use-case';
import { CloseConversationUseCase } from './application/close-conversation.use-case';
import { ConversationCommandRunner } from './application/conversation-command-runner';
import { FindOutboundForSendUseCase } from './application/find-outbound-for-send.use-case';
import { GetConversationSummaryUseCase } from './application/get-conversation-summary.use-case';
import { CountInboxesUseCase } from './application/count-inboxes.use-case';
import { ListConversationsUseCase } from './application/list-conversations.use-case';
import { ListMessagesUseCase } from './application/list-messages.use-case';
import { EVENT_INBOX } from './application/ports/event-inbox';
import { CONVERSATION_READ_MODEL } from './application/ports/conversation-read-model';
import { CONVERSATION_REPOSITORY } from './application/ports/conversation.repository';
import { ListTimelineUseCase } from './application/list-timeline.use-case';
import { RegisterAiReplyUseCase } from './application/register-ai-reply.use-case';
import { RegisterInboundMessageUseCase } from './application/register-inbound-message.use-case';
import { ReleaseConversationUseCase } from './application/release-conversation.use-case';
import { ReopenConversationUseCase } from './application/reopen-conversation.use-case';
import { RetryFailedMessageUseCase } from './application/retry-failed-message.use-case';
import { SendAgentMessageUseCase } from './application/send-agent-message.use-case';
import { UpdateDeliveryStatusUseCase } from './application/update-delivery-status.use-case';
import { ConversationsController } from './infrastructure/http/conversations.controller';
import { PrismaEventInbox } from './infrastructure/prisma-event-inbox';
import { PrismaConversationReadModel } from './infrastructure/prisma-conversation-read-model';
import { PrismaConversationRepository } from './infrastructure/prisma-conversation.repository';

@Module({
  imports: [ContactsModule, IdentityModule, MembersModule],
  controllers: [ConversationsController],
  providers: [
    { provide: CONVERSATION_REPOSITORY, useClass: PrismaConversationRepository },
    { provide: CONVERSATION_READ_MODEL, useClass: PrismaConversationReadModel },
    { provide: EVENT_INBOX, useClass: PrismaEventInbox },
    RegisterInboundMessageUseCase,
    RegisterAiReplyUseCase,
    ListConversationsUseCase,
    CountInboxesUseCase,
    ListMessagesUseCase,
    ListTimelineUseCase,
    GetConversationSummaryUseCase,
    ConversationCommandRunner,
    AssignConversationUseCase,
    ReleaseConversationUseCase,
    CloseConversationUseCase,
    ReopenConversationUseCase,
    SendAgentMessageUseCase,
    RetryFailedMessageUseCase,
    UpdateDeliveryStatusUseCase,
    FindOutboundForSendUseCase,
  ],
  exports: [
    CONVERSATION_REPOSITORY,
    CONVERSATION_READ_MODEL,
    ReleaseConversationUseCase,
    RegisterInboundMessageUseCase,
    RegisterAiReplyUseCase,
    UpdateDeliveryStatusUseCase,
    FindOutboundForSendUseCase,
    SendAgentMessageUseCase,
  ],
})
export class ConversationsModule {}
