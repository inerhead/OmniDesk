import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import { OUTBOX_PORT, type OutboxPort } from '../../../shared/application/outbox.port';
import type { ActorContext } from '../../../shared/application/request-context';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from '../../attachments/application/ports/attachment-storage';
import { enqueueConversationChanged } from '../../conversations/application/enqueue-conversation-changed';
import { canDeleteContact } from '../domain/deletion-policy';
import { deleteStoredObjects } from './delete-stored-objects';
import { RETENTION_STORE, type RetentionStore } from './ports/retention-store';

export type DeleteContactResult =
  | { kind: 'ok'; conversations: number; messages: number }
  | { kind: 'forbidden' }
  | { kind: 'not-found' };

/**
 * Derecho de supresión (SPEC 12): borra el contacto, sus identidades y todas sus conversaciones
 * (abiertas o cerradas) con sus mensajes, eventos y adjuntos. Deja constancia en `DeletionLog` sin
 * datos personales y avisa en tiempo real para que las pestañas abiertas quiten las conversaciones.
 */
@Injectable()
export class DeleteContactUseCase {
  constructor(
    @Inject(RETENTION_STORE) private readonly store: RetentionStore,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(actor: ActorContext, contactId: string): Promise<DeleteContactResult> {
    if (!canDeleteContact(actor.role)) return { kind: 'forbidden' };
    const { tenantId } = actor;
    return this.tx.run(
      async () => {
        const conversationIds = await this.store.lockContactConversations(tenantId, contactId);
        if (!conversationIds) return { kind: 'not-found' };

        let deleted = { conversations: 0, messages: 0 };
        if (conversationIds.length > 0) {
          await deleteStoredObjects(
            this.storage,
            await this.store.attachmentKeys(tenantId, conversationIds),
          );
          deleted = await this.store.deleteConversations(tenantId, conversationIds);
        }
        await this.store.deleteContact(tenantId, contactId);
        await this.store.logDeletion({
          tenantId,
          kind: 'contact',
          actorMemberId: actor.memberId,
          conversationsDeleted: deleted.conversations,
          messagesDeleted: deleted.messages,
        });
        const now = this.clock.now();
        for (const conversationId of conversationIds) {
          await enqueueConversationChanged(this.outbox, tenantId, conversationId, 'deleted', now);
        }
        return { kind: 'ok', ...deleted };
      },
      { timeoutMs: 60_000 },
    );
  }
}
