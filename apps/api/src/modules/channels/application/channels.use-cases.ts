import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import type { ActorContext } from '../../../shared/application/request-context';
import { ENV, type Env } from '../../../shared/config/env';
import type { Channel, ChannelSummary } from '../domain/channel';
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

/** Canales que cualquier miembro elige en la bandeja: solo id, nombre y tipo. */
@Injectable()
export class ListInboxChannelsUseCase {
  constructor(
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(actor: ActorContext): Promise<Array<Pick<ChannelSummary, 'id' | 'name' | 'type'>>> {
    const items = await this.channels.listSummaries(actor.tenantId, this.clock.now());
    return items.map(({ id, name, type }) => ({ id, name, type }));
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
  provider: 'WHATSAPP_CLOUD';
}

/** Alta de un canal de WhatsApp Cloud (SPEC 22: ya no se crean canales N8N). */
@Injectable()
export class CreateChannelUseCase {
  constructor(
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    actor: ActorContext,
    input: CreateChannelInput,
  ): Promise<{ kind: 'ok'; channel: ChannelSummary } | Forbidden | { kind: 'conflict' }> {
    if (!canManageChannels(actor.role)) return { kind: 'forbidden' };
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

/**
 * Guarda el `clientId` y el `clientSecret` que OmniDesk envía a n8n (SPEC 22). El secreto es de solo
 * escritura: omitirlo conserva el guardado, pero la primera vez es obligatorio.
 */
@Injectable()
export class ConfigureN8nClientUseCase {
  constructor(
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
    @Inject(CHANNEL_SECRET_CIPHER) private readonly cipher: ChannelSecretCipher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    actor: ActorContext,
    channelId: string,
    input: { clientId: string; clientSecret?: string },
  ): Promise<
    { kind: 'ok'; channel: ChannelSummary } | Forbidden | NotFound | { kind: 'secret-required' }
  > {
    if (!canManageChannels(actor.role)) return { kind: 'forbidden' };
    const now = this.clock.now();
    const current = await this.channels.findSummary(actor.tenantId, channelId, now);
    if (!current) return { kind: 'not-found' };
    if (input.clientSecret === undefined && !current.hasN8nClientSecret) {
      return { kind: 'secret-required' };
    }
    await this.channels.setN8nClient(actor.tenantId, channelId, {
      clientId: input.clientId,
      ...(input.clientSecret !== undefined && {
        clientSecretEnc: this.cipher.encrypt(input.clientSecret),
      }),
    });
    const channel = await this.channels.findSummary(actor.tenantId, channelId, now);
    return { kind: 'ok', channel: channel! };
  }
}

/** Quita las credenciales de cliente de n8n y apaga la IA del canal (SPEC 22). */
@Injectable()
export class RemoveN8nClientUseCase {
  constructor(
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    actor: ActorContext,
    channelId: string,
  ): Promise<{ kind: 'ok'; channel: ChannelSummary } | Forbidden | NotFound> {
    if (!canManageChannels(actor.role)) return { kind: 'forbidden' };
    if (!(await this.channels.clearN8nClient(actor.tenantId, channelId))) {
      return { kind: 'not-found' };
    }
    const channel = await this.channels.findSummary(actor.tenantId, channelId, this.clock.now());
    return { kind: 'ok', channel: channel! };
  }
}

/** `ping` al webhook del canal con las credenciales de cliente (SPEC 22), sin reintentos. */
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
    if (!channel.webhookUrl || !channel.n8nClientId || !channel.n8nClientSecretEnc) {
      return {
        kind: 'ok',
        result: {
          ok: false,
          httpStatus: null,
          latencyMs: 0,
          error: channel.webhookUrl
            ? 'El canal no tiene credenciales de cliente de n8n'
            : 'El canal no tiene webhookUrl',
        },
      };
    }
    return {
      kind: 'ok',
      result: await this.tester.ping({
        channelId: channel.id,
        webhookUrl: channel.webhookUrl,
        clientId: channel.n8nClientId,
        clientSecret: this.cipher.decrypt(channel.n8nClientSecretEnc),
        now: this.clock.now(),
      }),
    };
  }
}
