import type { IntegrationContext } from '../../../../shared/application/request-context';
import type {
  Channel,
  ChannelProvider,
  ChannelSigningSecrets,
  ChannelSummary,
  NewChannel,
  SecretBlob,
} from '../../domain/channel';

/** Lo que el adaptador de envío necesita del canal. */
export interface ChannelForSend {
  id: string;
  provider: ChannelProvider;
  externalId: string;
  webhookUrl: string | null;
  /** Credenciales de cliente hacia n8n (SPEC 22); el secreto va cifrado. */
  n8nClientId: string | null;
  n8nClientSecretEnc: SecretBlob | null;
}

export interface ChannelRepository {
  /** Credencial no revocada ni vencida con ese hash, o `null` (también con la empresa en borrado). */
  findActiveCredential(keyHash: string, now: Date): Promise<IntegrationContext | null>;
  findSigningSecrets(channelId: string): Promise<ChannelSigningSecrets | null>;
  findForSend(tenantId: string, channelId: string): Promise<ChannelForSend | null>;
  listSummaries(tenantId: string, now: Date): Promise<ChannelSummary[]>;
  findSummary(tenantId: string, channelId: string, now: Date): Promise<ChannelSummary | null>;
  /** `null` si ya existe un canal con ese `externalId` en la empresa. */
  create(tenantId: string, channel: NewChannel): Promise<Channel | null>;
  /** `null` si el canal no existe en la empresa. */
  update(
    tenantId: string,
    channelId: string,
    patch: { name?: string; webhookUrl?: string | null },
  ): Promise<Channel | null>;
  /**
   * Guarda el `clientId` y, si viene, el `clientSecret` cifrado (SPEC 22). `false` si el canal no
   * existe en la empresa.
   */
  setN8nClient(
    tenantId: string,
    channelId: string,
    client: { clientId: string; clientSecretEnc?: SecretBlob },
  ): Promise<boolean>;
  /** Borra las credenciales de cliente y apaga la IA. `false` si el canal no existe en la empresa. */
  clearN8nClient(tenantId: string, channelId: string): Promise<boolean>;
  upsertChannel(tenantId: string, channel: NewChannel): Promise<Channel>;
  /** Deja `keyHash` como única credencial activa del canal (revoca las demás). */
  setOnlyActiveCredential(tenantId: string, channelId: string, keyHash: string): Promise<void>;
}

export const CHANNEL_REPOSITORY = Symbol('CHANNEL_REPOSITORY');
