import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { checkOutboundAttachment, type OutboundAttachmentRejection } from '@omnidesk/contracts';
import type { ActorContext } from '../../../shared/application/request-context';
import {
  SendAgentMessageUseCase,
  type SendAgentMessageResult,
} from '../../conversations/application/send-agent-message.use-case';
import { cleanFileName } from '../domain/file-name';
import {
  ATTACHMENT_STORAGE,
  outboundStorageKey,
  type AttachmentStorage,
} from './ports/attachment-storage';

export interface SendAgentAttachmentInput {
  conversationId: string;
  clientMessageId: string;
  caption: string;
  file: { buffer: Buffer; mimeType: string; fileName: string; sizeBytes: number };
}

export type SendAgentAttachmentResult =
  | SendAgentMessageResult
  | { kind: 'invalid'; reason: OutboundAttachmentRejection };

/**
 * Sube el archivo al bucket y registra el mensaje `PENDING` (el Outbox lo envía). El objeto se sube
 * antes de la transacción; si el mensaje no se crea (duplicado, permisos, error), se borra.
 */
@Injectable()
export class SendAgentAttachmentUseCase {
  constructor(
    private readonly sendMessage: SendAgentMessageUseCase,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
  ) {}

  async execute(
    actor: ActorContext,
    input: SendAgentAttachmentInput,
  ): Promise<SendAgentAttachmentResult> {
    const check = checkOutboundAttachment(
      { mimeType: input.file.mimeType, sizeBytes: input.file.sizeBytes },
      input.caption,
    );
    if (!check.ok) return { kind: 'invalid', reason: check.reason };

    const storageKey = outboundStorageKey(actor.tenantId, randomUUID());
    await this.storage.put(storageKey, input.file.buffer, {
      contentType: check.mimeType,
      contentLength: input.file.sizeBytes,
    });
    try {
      const result = await this.sendMessage.execute(actor, {
        conversationId: input.conversationId,
        text: input.caption.trim(),
        clientMessageId: input.clientMessageId,
        attachment: {
          kind: check.kind,
          mimeType: check.mimeType,
          fileName: cleanFileName(input.file.fileName),
          sizeBytes: input.file.sizeBytes,
          status: 'READY',
          storageKey,
        },
      });
      if (result.kind !== 'ok' || result.duplicate) await this.discard(storageKey);
      return result;
    } catch (error) {
      await this.discard(storageKey);
      throw error;
    }
  }

  private async discard(storageKey: string): Promise<void> {
    await this.storage.delete(storageKey).catch(() => undefined);
  }
}
