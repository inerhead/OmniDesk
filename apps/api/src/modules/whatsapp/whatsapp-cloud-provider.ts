import { buffer } from 'node:stream/consumers';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ENV, type Env } from '../../shared/config/env';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from '../attachments/application/ports/attachment-storage';
import {
  CHANNEL_SECRET_CIPHER,
  type ChannelSecretCipher,
} from '../channels/application/ports/channel-secret-cipher';
import {
  ChannelNotConfiguredError,
  type MessagingProvider,
  type OutboundAttachment,
  type SendMessageRequest,
} from '../messaging/application/ports/messaging-provider.port';
import { WhatsAppSettings } from './whatsapp-settings';

const SendResponse = z.object({ messages: z.array(z.object({ id: z.string().min(1) })).min(1) });
const UploadResponse = z.object({ id: z.string().min(1) });

@Injectable()
export class WhatsAppCloudProvider implements MessagingProvider {
  constructor(
    private readonly settings: WhatsAppSettings,
    @Inject(CHANNEL_SECRET_CIPHER) private readonly cipher: ChannelSecretCipher,
    @Inject(ENV) private readonly env: Env,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
  ) {}

  async send(request: SendMessageRequest): Promise<{ providerMessageId: string }> {
    const channel = await this.settings.find(request.channel.id, request.tenantId);
    if (!channel?.whatsappAccessTokenEnc)
      throw new ChannelNotConfiguredError('falta access token de WhatsApp');
    const authorization = `Bearer ${this.cipher.decrypt(channel.whatsappAccessTokenEnc)}`;
    const content = request.attachment
      ? await this.mediaContent(channel.externalId, authorization, request.attachment, request.text)
      : { type: 'text', text: { body: request.text } };
    const res = await fetch(`${this.graph(channel.externalId)}/messages`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', authorization },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: request.to.replace(/^\+/, ''),
        ...content,
        biz_opaque_callback_data: request.messageId,
      }),
    });
    if (!res.ok) throw new Error(`WhatsApp HTTP ${res.status}`);
    return { providerMessageId: SendResponse.parse(await res.json()).messages[0]!.id };
  }

  private graph(phoneNumberId: string): string {
    return `https://graph.facebook.com/${this.env.WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}`;
  }

  /** Sube el archivo a Meta en cada intento: un reintento tras un fallo vuelve a subirlo. */
  private async mediaContent(
    phoneNumberId: string,
    authorization: string,
    attachment: OutboundAttachment,
    caption: string,
  ): Promise<Record<string, unknown>> {
    const bytes = await buffer((await this.storage.get(attachment.storageKey)).body);
    const form = new FormData();
    form.set('messaging_product', 'whatsapp');
    form.set('type', attachment.mimeType);
    form.set(
      'file',
      new Blob([new Uint8Array(bytes)], { type: attachment.mimeType }),
      attachment.fileName ?? 'archivo',
    );
    const res = await fetch(`${this.graph(phoneNumberId)}/media`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
      headers: { authorization },
      body: form,
    });
    if (!res.ok) throw new Error(`WhatsApp media HTTP ${res.status}`);
    const { id } = UploadResponse.parse(await res.json());
    const type = attachment.kind.toLowerCase();
    return {
      type,
      [type]: {
        id,
        ...(caption !== '' && attachment.kind !== 'AUDIO' && { caption }),
        ...(attachment.kind === 'DOCUMENT' &&
          attachment.fileName !== null && { filename: attachment.fileName }),
      },
    };
  }
}
