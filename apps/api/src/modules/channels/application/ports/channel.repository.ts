import type { IntegrationContext } from '../../../../shared/application/request-context';
import type { Channel, NewChannel } from '../../domain/channel';

export interface ChannelRepository {
  /** Credencial no revocada con ese hash, o `null`. */
  findActiveCredential(keyHash: string): Promise<IntegrationContext | null>;
  upsertChannel(tenantId: string, channel: NewChannel): Promise<Channel>;
  /** Deja `keyHash` como única credencial activa del canal (revoca las demás). */
  setOnlyActiveCredential(tenantId: string, channelId: string, keyHash: string): Promise<void>;
}

export const CHANNEL_REPOSITORY = Symbol('CHANNEL_REPOSITORY');
