import { Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '../../../shared/application/request-context';
import {
  CONVERSATION_READ_MODEL,
  type ConversationReadModel,
} from '../../conversations/application/ports/conversation-read-model';
import { can } from '../../conversations/domain/conversation-policy';
import {
  ATTACHMENT_REPOSITORY,
  type AttachmentRecord,
  type AttachmentRepository,
} from './ports/attachment.repository';

export type ReadyAttachment = AttachmentRecord & { storageKey: string; sizeBytes: number };

@Injectable()
export class GetAttachmentContentUseCase {
  constructor(
    @Inject(ATTACHMENT_REPOSITORY) private readonly attachments: AttachmentRepository,
    @Inject(CONVERSATION_READ_MODEL) private readonly readModel: ConversationReadModel,
  ) {}

  /** `null` si no existe en el tenant, no está READY o el actor no puede ver la conversación. */
  async execute(actor: ActorContext, attachmentId: string): Promise<ReadyAttachment | null> {
    const attachment = await this.attachments.findById(actor.tenantId, attachmentId);
    if (!attachment || attachment.status !== 'READY') return null;
    const { storageKey, sizeBytes } = attachment;
    if (storageKey === null || sizeBytes === null) return null;
    const access = await this.readModel.findAccess(actor.tenantId, attachment.conversationId);
    if (!access || !can(actor, 'view', access)) return null;
    return { ...attachment, storageKey, sizeBytes };
  }
}
