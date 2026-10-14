import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type { AttachmentRecord, AttachmentRepository } from '../application/ports/attachment.repository';

@Injectable()
export class PrismaAttachmentRepository implements AttachmentRepository {
  constructor(private readonly db: PrismaDb) {}

  async findById(tenantId: string, id: string): Promise<AttachmentRecord | null> {
    const row = await this.db.client.messageAttachment.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        tenantId: true,
        kind: true,
        mimeType: true,
        fileName: true,
        sizeBytes: true,
        status: true,
        storageKey: true,
        providerMediaId: true,
        sha256: true,
        message: { select: { conversationId: true } },
      },
    });
    if (!row) return null;
    const { message, ...attachment } = row;
    return { ...attachment, conversationId: message.conversationId };
  }

  async markReady(id: string, update: { storageKey: string; sizeBytes: number }): Promise<void> {
    await this.db.client.messageAttachment.update({
      where: { id },
      data: { status: 'READY', ...update, failureReason: null },
    });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.db.client.messageAttachment.update({
      where: { id },
      data: { status: 'FAILED', failureReason: reason },
    });
  }
}
