import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import type { ActorContext } from '../../../shared/application/request-context';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import { ENV, type Env } from '../../../shared/config/env';
import { hashToken } from '../../identity/application/session-token';
import { CREDENTIALS_GRACE_MS, type Channel, type ChannelSummary } from '../domain/channel';
import { canManageChannels, checkWebhookUrl, type WebhookUrlCheck } from '../domain/channel-policy';
import { CHANNEL_SECRET_CIPHER, type ChannelSecretCipher } from './ports/channel-secret-cipher';
import {
  CHANNEL_WEBHOOK_TESTER,
  type ChannelTestResult,
  type ChannelWebhookTester,
} from './ports/channel-webhook-tester';
import { CHANNEL_REPOSITORY, type ChannelRepository } from './ports/channel.repository';

type Forbidden = { kind: 'forbidden' };
type NotFound = { kind: 'not-found' };
type InvalidWebhook = {
  kind: 'invalid-webhook';
  reason: Exclude<WebhookUrlCheck, { ok: true }>['reason'];
};

/** Valida `webhookUrl` con la política del entorno (https en producción, sin IP privadas). */
@Injectable()
export class WebhookUrlValidator {
  constructor(@Inject(ENV) private readonly env: Env) {}

  check(url: string): WebhookUrlCheck {
    return checkWebhookUrl(url, {
      production: this.env.NODE_ENV === 'production',
      allowedHosts: this.env.N8N_WEBHOOK_ALLOWED_HOSTS,
    });
  }
}

@Injectable()
export class ListChannelsUseCase {
  constructor(
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(actor: ActorContext): Promise<{ kind: 'ok'; items: ChannelSummary[] } | Forbidden> {
    if (!canManageChannels(actor.role)) return { kind: 'forbidden' };
    return {
      kind: 'ok',
      items: await this.channels.listSummaries(actor.tenantId, this.clock.now()),
    };
  }
}

export interface CreateChannelInput {
  name: string;
  phoneNumber: string;
  externalId: string;
  provider: 'N8N' | 'WHATSAPP_CLOUD';
  webhookUrl?: string;
}

/** Alta de un canal de WhatsApp por n8n, sin credenciales (se emiten aparte). */
@Injectable()
export class CreateChannelUseCase {
  constructor(
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
    private readonly webhookUrls: WebhookUrlValidator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    actor: ActorContext,
    input: CreateChannelInput,
  ): Promise<
    { kind: 'ok'; channel: ChannelSummary } | Forbidden | InvalidWebhook | { kind: 'conflict' }
  > {
    if (!canManageChannels(actor.role)) return { kind: 'forbidden' };
    if (input.webhookUrl) {
      const check = this.webhookUrls.check(input.webhookUrl);
      if (!check.ok) return { kind: 'invalid-webhook', reason: check.reason };
    }
    const created = await this.channels.create(actor.tenantId, { ...input, type: 'WHATSAPP' });
    if (!created) return { kind: 'conflict' };
    const channel = await this.channels.findSummary(actor.tenantId, created.id, this.clock.now());
    return { kind: 'ok', channel: channel! };
  }
}

@Injectable()
export class UpdateChannelUseCase {
  constructor(
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
    private readonly webhookUrls: WebhookUrlValidator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    actor: ActorContext,
    channelId: string,
    patch: { name?: string; webhookUrl?: string | null },
  ): Promise<{ kind: 'ok'; channel: ChannelSummary } | Forbidden | NotFound | InvalidWebhook> {
    if (!canManageChannels(actor.role)) return { kind: 'forbidden' };
    if (patch.webhookUrl === null) {
      const current = await this.channels.findForSend(actor.tenantId, channelId);
      if (current?.provider === 'N8N') return { kind: 'invalid-webhook', reason: 'invalid' };
    }
    if (patch.webhookUrl) {
      const check = this.webhookUrls.check(patch.webhookUrl);
      if (!check.ok) return { kind: 'invalid-webhook', reason: check.reason };
    }
    const updated: Channel | null = await this.channels.update(actor.tenantId, channelId, patch);
    if (!updated) return { kind: 'not-found' };
    const channel = await this.channels.findSummary(actor.tenantId, channelId, this.clock.now());
    return { kind: 'ok', channel: channel! };
  }
}

export interface IssuedCredentials {
  apiKey: string;
  hmacSecret: string;
  previousValidUntil: Date | null;
}

/** Nueva API key (`odk_…`) y secreto HMAC (`whsec_…`): 32 bytes aleatorios cada uno. */
export function newChannelCredentials(): { apiKey: string; hmacSecret: string } {
  return {
    apiKey: `odk_${randomBytes(32).toString('base64url')}`,
    hmacSecret: `whsec_${randomBytes(32).toString('base64url')}`,
  };
}

/**
 * Emite (o rota) la API key y el secreto HMAC. Se devuelven una sola vez: la key se guarda como
 * sha256 y el secreto cifrado. Si ya existían, los anteriores siguen valiendo 24 h.
 */
@Injectable()
export class IssueChannelCredentialsUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
    @Inject(CHANNEL_SECRET_CIPHER) private readonly cipher: ChannelSecretCipher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    actor: ActorContext,
    channelId: string,
  ): Promise<{ kind: 'ok'; credentials: IssuedCredentials } | Forbidden | NotFound> {
    if (!canManageChannels(actor.role)) return { kind: 'forbidden' };
    const now = this.clock.now();
    const previousValidUntil = new Date(now.getTime() + CREDENTIALS_GRACE_MS);
    const issued = newChannelCredentials();
    const hmacSecretEnc = this.cipher.encrypt(issued.hmacSecret);

    return this.tx.run(async () => {
      if (!(await this.channels.findSummary(actor.tenantId, channelId, now))) {
        return { kind: 'not-found' };
      }
      const { hadPrevious } = await this.channels.rotateCredentials(actor.tenantId, channelId, {
        keyHash: hashToken(issued.apiKey),
        hmacSecretEnc,
        now,
        previousValidUntil,
      });
      return {
        kind: 'ok',
        credentials: { ...issued, previousValidUntil: hadPrevious ? previousValidUntil : null },
      };
    });
  }
}

/** `ping` firmado al webhook del canal, sin reintentos. */
@Injectable()
export class TestChannelConnectionUseCase {
  constructor(
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
    @Inject(CHANNEL_SECRET_CIPHER) private readonly cipher: ChannelSecretCipher,
    @Inject(CHANNEL_WEBHOOK_TESTER) private readonly tester: ChannelWebhookTester,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    actor: ActorContext,
    channelId: string,
  ): Promise<{ kind: 'ok'; result: ChannelTestResult } | Forbidden | NotFound> {
    if (!canManageChannels(actor.role)) return { kind: 'forbidden' };
    const channel = await this.channels.findForSend(actor.tenantId, channelId);
    if (!channel) return { kind: 'not-found' };
    if (!channel.webhookUrl || !channel.hmacSecretEnc) {
      return {
        kind: 'ok',
        result: {
          ok: false,
          httpStatus: null,
          latencyMs: 0,
          error: channel.webhookUrl
            ? 'El canal no tiene credenciales: genéralas primero'
            : 'El canal no tiene webhookUrl',
        },
      };
    }
    return {
      kind: 'ok',
      result: await this.tester.ping({
        channelId: channel.id,
        webhookUrl: channel.webhookUrl,
        secret: this.cipher.decrypt(channel.hmacSecretEnc),
        now: this.clock.now(),
      }),
    };
  }
}
