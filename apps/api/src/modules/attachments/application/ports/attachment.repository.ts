import type { AttachmentKind, AttachmentStatus } from '@omnidesk/contracts';

export interface AttachmentRecord {
  id: string;
  tenantId: string;
  conversationId: string;
  kind: AttachmentKind;
  mimeType: string;
  fileName: string | null;
  sizeBytes: number | null;
  status: AttachmentStatus;
  storageKey: string | null;
  providerMediaId: string | null;
  sha256: string | null;
}

export interface AttachmentRepository {
  findById(tenantId: string, id: string): Promise<AttachmentRecord | null>;
  markReady(id: string, update: { storageKey: string; sizeBytes: number }): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
}

export const ATTACHMENT_REPOSITORY = Symbol('ATTACHMENT_REPOSITORY');
