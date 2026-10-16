/** Secreto cifrado (AES-256-GCM) tal como lo guarda Prisma (`Bytes`). */
export type SecretBlob = Uint8Array<ArrayBuffer>;

export type ChannelType = 'WHATSAPP';
export type ChannelProvider = 'SIMULATED' | 'N8N' | 'CUSTOM' | 'WHATSAPP_CLOUD';

export interface Channel {
  id: string;
  tenantId: string;
  name: string;
  type: ChannelType;
  provider: ChannelProvider;
  /** phone_number_id de Meta (o el id del número en el proveedor). */
  externalId: string;
  /** Número público en E.164, para mostrar. */
  phoneNumber: string | null;
  webhookUrl: string | null;
}

export type NewChannel = Pick<Channel, 'name' | 'type' | 'provider' | 'externalId'> &
  Partial<Pick<Channel, 'phoneNumber' | 'webhookUrl'>>;

/** Canal para la UI de gestión: nunca lleva secretos. */
export interface ChannelSummary extends Channel {
  credentialsRotatedAt: Date | null;
  aiEnabled?: boolean;
  hasWhatsAppCredentials?: boolean;
  /** Tiene `clientSecret` para n8n; el valor solo sale al generarlo (SPEC 22). */
  hasN8nClientSecret: boolean;
}

/**
 * Cabeceras con las que OmniDesk se autentica ante n8n en cada llamada (SPEC 22): el `clientId` es el
 * id del canal.
 */
export function n8nClientHeaders(channelId: string, clientSecret: string): Record<string, string> {
  return { 'X-Client-Id': channelId, 'X-Client-Secret': clientSecret };
}

/** Secretos HMAC cifrados de un canal. */
export interface ChannelSigningSecrets {
  current: SecretBlob | null;
  previous: SecretBlob | null;
  previousUntil: Date | null;
}

/** Tras una rotación, la API key y el secreto anteriores siguen valiendo 24 h. */
export const CREDENTIALS_GRACE_MS = 24 * 60 * 60 * 1000;

/** Secretos con los que se acepta una firma entrante: el actual y, si sigue vigente, el anterior. */
export function acceptedSigningSecrets(secrets: ChannelSigningSecrets, now: Date): SecretBlob[] {
  const accepted: SecretBlob[] = [];
  if (secrets.current) accepted.push(secrets.current);
  if (secrets.previous && secrets.previousUntil && secrets.previousUntil > now) {
    accepted.push(secrets.previous);
  }
  return accepted;
}

/** Una credencial vale si no está revocada ni vencida (las anteriores a una rotación vencen a las 24 h). */
export function isCredentialActive(
  credential: { revokedAt: Date | null; expiresAt: Date | null },
  now: Date,
): boolean {
  return (
    credential.revokedAt === null && (credential.expiresAt === null || credential.expiresAt > now)
  );
}
