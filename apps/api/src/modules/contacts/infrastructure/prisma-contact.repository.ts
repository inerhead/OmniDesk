import { Injectable } from '@nestjs/common';
import { rethrowUniqueConflict } from '../../../shared/infrastructure/prisma/prisma-errors';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type { ContactRepository } from '../application/ports/contact.repository';
import type { Contact, ContactIdentityRef } from '../domain/contact';

const select = { id: true, tenantId: true, displayName: true } as const;

@Injectable()
export class PrismaContactRepository implements ContactRepository {
  constructor(private readonly db: PrismaDb) {}

  async findOrCreateByIdentity(
    identity: ContactIdentityRef,
    displayName?: string,
  ): Promise<Contact> {
    const found = await this.db.client.contactIdentity.findUnique({
      where: {
        channelId_externalId: { channelId: identity.channelId, externalId: identity.externalId },
      },
      select: { contact: { select } },
    });

    if (found) {
      if (displayName && displayName !== found.contact.displayName) {
        return this.db.client.contact.update({
          where: { id: found.contact.id },
          data: { displayName },
          select,
        });
      }
      return found.contact;
    }

    try {
      return await this.db.client.contact.create({
        data: {
          tenantId: identity.tenantId,
          displayName: displayName ?? null,
          identities: {
            create: {
              tenantId: identity.tenantId,
              channelId: identity.channelId,
              externalId: identity.externalId,
            },
          },
        },
        select,
      });
    } catch (error) {
      rethrowUniqueConflict(error);
    }
  }
}
