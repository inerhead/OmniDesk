import { Inject, Injectable } from '@nestjs/common';
import type { TenantContext } from '../../../shared/application/request-context';
import type { Message } from '../domain/message';
import {
  CONVERSATION_READ_MODEL,
  type ConversationReadModel,
} from './ports/conversation-read-model';

export interface MessagePage {
  /** Orden ascendente por `sequence`. */
  items: Message[];
  /** `sequence` más antigua de la página si hay mensajes anteriores; si no, `null`. */
  prevCursor: number | null;
}

@Injectable()
export class ListMessagesUseCase {
  constructor(@Inject(CONVERSATION_READ_MODEL) private readonly readModel: ConversationReadModel) {}

  /** `null` si la conversación no existe en el tenant. */
  async execute(
    tenant: TenantContext,
    conversationId: string,
    before: number | undefined,
    limit: number,
  ): Promise<MessagePage | null> {
    if (!(await this.readModel.conversationExists(tenant.tenantId, conversationId))) return null;

    const rows = await this.readModel.listMessagesDescending(
      conversationId,
      before ?? null,
      limit + 1,
    );
    const items = rows.slice(0, limit).reverse();
    return { items, prevCursor: rows.length > limit && items[0] ? items[0].sequence : null };
  }
}
