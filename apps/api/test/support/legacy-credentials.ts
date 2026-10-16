import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  CHANNEL_SECRET_CIPHER,
  type ChannelSecretCipher,
} from '../../src/modules/channels/application/ports/channel-secret-cipher';
import { CREDENTIALS_GRACE_MS } from '../../src/modules/channels/domain/channel';
import { sha256Hex } from '../../src/shared/infrastructure/crypto/sha256';
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service';

/**
 * API key y secreto HMAC de un canal N8N existente, escritos en la base. Desde SPEC 22 la API ya no
 * los emite; los canales anteriores los conservan y los endpoints de integración siguen
 * aceptándolos. Si el canal ya tenía, los anteriores valen 24 h, como tras la rotación de SPEC 09.
 */
export async function issueLegacyCredentials(
  app: INestApplication,
  tenantId: string,
  channelId: string,
): Promise<{ apiKey: string; hmacSecret: string }> {
  const prisma = app.get(PrismaService);
  const cipher = app.get<ChannelSecretCipher>(CHANNEL_SECRET_CIPHER);
  const issued = {
    apiKey: `odk_${randomBytes(24).toString('base64url')}`,
    hmacSecret: randomBytes(32).toString('hex'),
  };
  const now = new Date();
  const previousValidUntil = new Date(now.getTime() + CREDENTIALS_GRACE_MS);
  const channel = await prisma.channel.findUniqueOrThrow({
    where: { id: channelId },
    select: { hmacSecretEnc: true },
  });
  await prisma.integrationCredential.updateMany({
    where: {
      channelId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: previousValidUntil } }],
    },
    data: { expiresAt: previousValidUntil },
  });
  await prisma.integrationCredential.create({
    data: { tenantId, channelId, keyHash: sha256Hex(issued.apiKey) },
  });
  await prisma.channel.update({
    where: { id: channelId },
    data: {
      hmacSecretEnc: cipher.encrypt(issued.hmacSecret),
      hmacSecretPrevEnc: channel.hmacSecretEnc,
      hmacSecretPrevUntil: channel.hmacSecretEnc ? previousValidUntil : null,
      credentialsRotatedAt: now,
    },
  });
  return issued;
}
