import { Inject, Injectable } from '@nestjs/common';
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
  type OutboundForSend,
} from './ports/conversation.repository';

/** Lo que el dispatcher necesita para entregar un mensaje saliente al proveedor. */
@Injectable()
export class FindOutboundForSendUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
  ) {}

  execute(tenantId: string, messageId: string): Promise<OutboundForSend | null> {
    return this.conversations.findOutboundForSend(tenantId, messageId);
  }
}
