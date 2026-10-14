import { Inject, Injectable } from '@nestjs/common';
import { N8nAiReplyResponseSchema } from '@omnidesk/contracts';
import { z } from 'zod';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../shared/application/transaction-runner.port';
import { OUTBOX_PORT, type OutboxPort } from '../../shared/application/outbox.port';
import { signPayload } from '../../shared/infrastructure/crypto/hmac-signature';
import {
  CHANNEL_SECRET_CIPHER,
  type ChannelSecretCipher,
} from '../channels/application/ports/channel-secret-cipher';
import { RegisterAiReplyUseCase } from '../conversations/application/register-ai-reply.use-case';
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from '../conversations/application/ports/conversation.repository';
import { decideAiReply } from '../conversations/domain/conversation';
import { enqueueSendRequested } from '../conversations/application/enqueue-send-requested';
import { WhatsAppSettings } from './whatsapp-settings';

const Payload = z.object({
  channelId: z.uuid(),
  messageId: z.uuid(),
  conversationId: z.uuid(),
  controlVersion: z.number().int(),
  from: z.object({ externalId: z.string(), displayName: z.string().optional() }),
  text: z.string(),
});
@Injectable()
export class AiReplyWorker {
  constructor(
    private readonly settings: WhatsAppSettings,
    @Inject(CHANNEL_SECRET_CIPHER) private readonly cipher: ChannelSecretCipher,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    private readonly replies: RegisterAiReplyUseCase,
  ) {}
  async process(tenantId: string, raw: unknown): Promise<void> {
    const payload = Payload.parse(raw);
    const channel = await this.settings.find(payload.channelId, tenantId);
    if (!channel?.aiEnabled || !channel.webhookUrl || !channel.hmacSecretEnc) return;
    const conversation = await this.conversations.findById(tenantId, payload.conversationId);
    if (
      !conversation ||
      conversation.channelId !== channel.id ||
      !decideAiReply(conversation, payload.controlVersion, new Date()).allowed
    )
      return;
    const idempotencyKey = `ai:${payload.messageId}`;
    if (await this.conversations.findMessageByIdempotencyKey(conversation.id, idempotencyKey))
      return;
    const body = JSON.stringify({
      type: 'ai.reply',
      messageId: payload.messageId,
      conversationId: payload.conversationId,
      controlVersion: payload.controlVersion,
      channel: { id: channel.id, externalId: channel.externalId },
      from: payload.from,
      text: payload.text,
    });
    const response = await fetch(channel.webhookUrl, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': payload.messageId,
        'X-OmniDesk-Signature': signPayload(
          this.cipher.decrypt(channel.hmacSecretEnc),
          body,
          Math.floor(Date.now() / 1000),
        ),
      },
      body,
    });
    if (!response.ok) throw new Error(`IA HTTP ${response.status}`);
    const reply = N8nAiReplyResponseSchema.parse(await response.json());
    await this.tx.run(async () => {
      const current = await this.settings.find(channel.id, tenantId);
      if (!current?.aiEnabled || current.webhookUrl !== channel.webhookUrl) return;
      const result = await this.replies.execute(
        { tenantId, channelId: channel.id },
        {
          conversationId: conversation.id,
          controlVersion: payload.controlVersion,
          idempotencyKey,
          text: reply.text,
        },
      );
      if (result.kind === 'accepted')
        await enqueueSendRequested(this.outbox, tenantId, result.messageId);
    });
  }
}
