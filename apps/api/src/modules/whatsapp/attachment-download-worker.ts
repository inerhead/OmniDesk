import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { OUTBOX_PORT, type OutboxPort } from '../../shared/application/outbox.port';
import { ENV, type Env } from '../../shared/config/env';
import { AttachmentDownloadPayloadSchema } from '../attachments/application/enqueue-attachment-download';
import {
  ATTACHMENT_REPOSITORY,
  type AttachmentRepository,
} from '../attachments/application/ports/attachment.repository';
import {
  ATTACHMENT_STORAGE,
  attachmentStorageKey,
  type AttachmentStorage,
} from '../attachments/application/ports/attachment-storage';
import { PermanentDownloadError } from '../attachments/domain/attachment-errors';
import {
  CHANNEL_SECRET_CIPHER,
  type ChannelSecretCipher,
} from '../channels/application/ports/channel-secret-cipher';
import { enqueueConversationChanged } from '../conversations/application/enqueue-conversation-changed';
import type { AttachmentDownloader } from '../realtime/application/ports/attachment-downloader';
import { WhatsAppSettings } from './whatsapp-settings';

const MediaInfo = z.object({
  url: z.url(),
  sha256: z.string().optional(),
  file_size: z.coerce.number().int().min(0),
});

/** Meta da el sha256 en base64 en el webhook; se acepta también hex. */
export function matchesSha256(digest: Buffer, expected: string): boolean {
  return expected === digest.toString('base64') || expected.toLowerCase() === digest.toString('hex');
}

/**
 * Graph → bucket. La URL del media caduca a los 5 min: cada intento la pide de nuevo con el media id.
 * Corre dentro de la transacción del Outbox (20 s): de ahí los timeouts de 5 y 12 s.
 */
@Injectable()
export class AttachmentDownloadWorker implements AttachmentDownloader {
  constructor(
    private readonly settings: WhatsAppSettings,
    @Inject(CHANNEL_SECRET_CIPHER) private readonly cipher: ChannelSecretCipher,
    @Inject(ENV) private readonly env: Env,
    @Inject(ATTACHMENT_REPOSITORY) private readonly attachments: AttachmentRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
  ) {}

  async process(tenantId: string, raw: unknown): Promise<void> {
    const { attachmentId, channelId } = AttachmentDownloadPayloadSchema.parse(raw);
    const attachment = await this.attachments.findById(tenantId, attachmentId);
    if (!attachment || attachment.status !== 'PENDING') return;
    if (!attachment.providerMediaId) throw new PermanentDownloadError('sin media id');
    const channel = await this.settings.find(channelId, tenantId);
    if (!channel?.whatsappAccessTokenEnc)
      throw new PermanentDownloadError('falta access token de WhatsApp');
    const authorization = `Bearer ${this.cipher.decrypt(channel.whatsappAccessTokenEnc)}`;

    const meta = await fetch(
      `https://graph.facebook.com/${this.env.WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(attachment.providerMediaId)}`,
      { headers: { authorization }, redirect: 'error', signal: AbortSignal.timeout(5_000) },
    );
    if (meta.status === 404) throw new PermanentDownloadError('el media ya no existe en WhatsApp');
    if (!meta.ok) throw new Error(`WhatsApp media HTTP ${meta.status}`);
    const info = MediaInfo.parse(await meta.json());
    if (info.file_size > this.env.ATTACHMENT_INBOUND_MAX_BYTES)
      throw new PermanentDownloadError(`TOO_LARGE: ${info.file_size} bytes`);

    const file = await fetch(info.url, {
      headers: { authorization },
      signal: AbortSignal.timeout(12_000),
    });
    if (!file.ok || !file.body) throw new Error(`WhatsApp media HTTP ${file.status}`);
    const hash = createHash('sha256');
    const body = Readable.fromWeb(file.body as WebReadableStream).pipe(
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          hash.update(chunk);
          done(null, chunk);
        },
      }),
    );
    const key = attachmentStorageKey(tenantId, attachment.id);
    await this.storage.put(key, body, {
      contentType: attachment.mimeType,
      contentLength: info.file_size,
    });
    const expected = attachment.sha256 ?? info.sha256;
    if (expected && !matchesSha256(hash.digest(), expected)) {
      await this.storage.delete(key);
      throw new Error('el sha256 no coincide');
    }
    await this.attachments.markReady(attachment.id, { storageKey: key, sizeBytes: info.file_size });
    await enqueueConversationChanged(this.outbox, tenantId, attachment.conversationId, 'message', new Date());
  }

  async fail(tenantId: string, raw: unknown, reason: string): Promise<void> {
    const { attachmentId } = AttachmentDownloadPayloadSchema.parse(raw);
    const attachment = await this.attachments.findById(tenantId, attachmentId);
    if (!attachment || attachment.status !== 'PENDING') return;
    await this.attachments.markFailed(attachment.id, reason.slice(0, 500));
    await enqueueConversationChanged(this.outbox, tenantId, attachment.conversationId, 'message', new Date());
  }
}
