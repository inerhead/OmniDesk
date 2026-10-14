import { z } from 'zod';
import type { OutboxPort } from '../../../shared/application/outbox.port';

export const ATTACHMENT_DOWNLOAD_REQUESTED = 'attachment.download_requested';

export const AttachmentDownloadPayloadSchema = z.object({
  attachmentId: z.uuid(),
  channelId: z.uuid(),
});
export type AttachmentDownloadPayload = z.infer<typeof AttachmentDownloadPayloadSchema>;

/** Encola la descarga del media de WhatsApp, en la transacción activa. */
export function enqueueAttachmentDownload(
  outbox: OutboxPort,
  tenantId: string,
  payload: AttachmentDownloadPayload,
): Promise<void> {
  return outbox.enqueue({ tenantId, type: ATTACHMENT_DOWNLOAD_REQUESTED, payload });
}
