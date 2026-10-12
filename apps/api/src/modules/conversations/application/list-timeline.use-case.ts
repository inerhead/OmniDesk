import { Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '../../../shared/application/request-context';
import { can } from '../domain/conversation-policy';
import type { Message } from '../domain/message';
import {
  CONVERSATION_READ_MODEL,
  type ConversationEventView,
  type ConversationReadModel,
} from './ports/conversation-read-model';

export type TimelineItem =
  ({ kind: 'message' } & Message) | ({ kind: 'event' } & ConversationEventView);

export interface TimelinePage {
  /** Orden ascendente por `sequence`. */
  items: TimelineItem[];
  /** `sequence` más antigua de la página si hay elementos anteriores; si no, `null`. */
  prevCursor: number | null;
}

/** Mensajes y eventos comparten el contador `sequence`: se mezclan sin ordenar por fechas. */
@Injectable()
export class ListTimelineUseCase {
  constructor(@Inject(CONVERSATION_READ_MODEL) private readonly readModel: ConversationReadModel) {}

  /** `null` si la conversación no existe en el tenant o el actor no puede verla. */
  async execute(
    actor: ActorContext,
    conversationId: string,
    before: number | undefined,
    limit: number,
  ): Promise<TimelinePage | null> {
    const access = await this.readModel.findAccess(actor.tenantId, conversationId);
    if (!access || !can(actor, 'view', access)) return null;

    // Los `limit + 1` más recientes de la unión están entre los `limit + 1` más recientes de cada tabla.
    const [messages, events] = await Promise.all([
      this.readModel.listMessagesDescending(conversationId, before ?? null, limit + 1),
      this.readModel.listEventsDescending(conversationId, before ?? null, limit + 1),
    ]);
    const merged: TimelineItem[] = [
      ...messages.map((message) => ({ kind: 'message' as const, ...message })),
      ...events.map((event) => ({ kind: 'event' as const, ...event })),
    ].sort((a, b) => b.sequence - a.sequence);

    const items = merged.slice(0, limit).reverse();
    return { items, prevCursor: merged.length > limit && items[0] ? items[0].sequence : null };
  }
}
