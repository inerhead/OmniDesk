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
  hmacSecretEnc: SecretBlob | null;
}

export interface CredentialRotation {
  keyHash: string;
  hmacSecretEnc: SecretBlob;
  now: Date;
  /** Hasta cuándo valen la API key y el secreto anteriores. */
  previousValidUntil: Date;
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
   * Nueva API key y nuevo secreto. Las credenciales vigentes vencen en `previousValidUntil` y el
   * secreto actual pasa a "anterior" hasta esa fecha. `hadPrevious`: había credenciales vigentes.
   */
  rotateCredentials(
    tenantId: string,
    channelId: string,
    rotation: CredentialRotation,
  ): Promise<{ hadPrevious: boolean }>;
  upsertChannel(tenantId: string, channel: NewChannel): Promise<Channel>;
  /** Deja `keyHash` como única credencial activa del canal (revoca las demás). */
  setOnlyActiveCredential(tenantId: string, channelId: string, keyHash: string): Promise<void>;
}

export const CHANNEL_REPOSITORY = Symbol('CHANNEL_REPOSITORY');
