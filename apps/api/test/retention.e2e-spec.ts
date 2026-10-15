import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from '../src/modules/attachments/application/ports/attachment-storage';
import { OutboxDispatcher } from '../src/modules/realtime/infrastructure/outbox-dispatcher';
import {
  RETENTION_LOCK_NAME,
  RetentionJob,
} from '../src/modules/retention/application/retention-job';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { testDatabaseUrl, testEnv } from './support/test-env';

const DAY = 24 * 60 * 60 * 1000;

describe('Retención y purga técnica (integración)', () => {
  let app: NestExpressApplication;
  let db: PrismaService;
  let storage: AttachmentStorage;
  let job: RetentionJob;
  let now: Date;
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

  const createTenant = async (retentionDays: number | null) => {
    const tenant = await db.tenant.create({
      data: { name: 'Retención', slug: `ret-${randomUUID()}`, retentionDays },
    });
    const channel = await db.channel.create({
      data: {
        tenantId: tenant.id,
        name: 'Ventas',
        type: 'WHATSAPP',
        provider: 'SIMULATED',
        externalId: `ret-${randomUUID()}`,
      },
    });
    return { tenantId: tenant.id, channelId: channel.id };
  };

  const createContact = async (tenant: { tenantId: string; channelId: string }) => {
    const contact = await db.contact.create({
      data: { tenantId: tenant.tenantId, displayName: 'Cliente' },
    });
    await db.contactIdentity.create({
      data: {
        tenantId: tenant.tenantId,
        contactId: contact.id,
        channelId: tenant.channelId,
        externalId: `+57${Math.floor(Math.random() * 1e10)}`,
      },
    });
    return contact.id;
  };

  /** Conversación con dos mensajes (uno con adjunto en el bucket) y un evento de cierre. */
  const createConversation = async (
    tenant: { tenantId: string; channelId: string },
    options: { status: 'OPEN' | 'CLOSED'; lastMessageDaysAgo: number; contactId?: string },
  ) => {
    const { tenantId, channelId } = tenant;
    const contactId = options.contactId ?? (await createContact(tenant));
    const conversation = await db.conversation.create({
      data: {
        tenantId,
        channelId,
        contactId,
        status: options.status,
        lastMessageAt: daysAgo(options.lastMessageDaysAgo),
        lastMessagePreview: 'Gracias',
        lastSequence: 3,
      },
    });
    const base = { tenantId, channelId, conversationId: conversation.id };
    await db.message.create({
      data: {
        ...base,
        sequence: 1,
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        text: 'Hola',
        status: 'RECEIVED',
      },
    });
    const withFile = await db.message.create({
      data: {
        ...base,
        sequence: 2,
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        text: '',
        status: 'RECEIVED',
      },
    });
    const storageKey = `tenants/${tenantId}/attachments/${randomUUID()}`;
    await storage.put(storageKey, Buffer.from('foto'), {
      contentType: 'image/jpeg',
      contentLength: 4,
    });
    await db.messageAttachment.create({
      data: {
        tenantId,
        messageId: withFile.id,
        kind: 'IMAGE',
        mimeType: 'image/jpeg',
        storageKey,
        status: 'READY',
      },
    });
    await db.conversationEvent.create({
      data: { tenantId, conversationId: conversation.id, sequence: 3, type: 'CLOSED' },
    });
    return { conversationId: conversation.id, contactId, storageKey };
  };

  const conversationExists = async (id: string) =>
    (await db.conversation.count({ where: { id } })) === 1;
  const objectExists = (key: string) =>
    storage.get(key).then(
      () => true,
      () => false,
    );

  beforeAll(async () => {
    const env = testEnv();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app, env);
    await app.init();
    // El dispatcher no debe tocar el Outbox de estas pruebas.
    await app.get(OutboxDispatcher).onModuleDestroy();
    db = app.get(PrismaService);
    storage = app.get(ATTACHMENT_STORAGE);
    job = app.get(RetentionJob);
  });
  afterAll(() => app.close());

  beforeEach(async () => {
    now = new Date();
    // Las demás empresas de la base de pruebas no deben interferir con los conteos.
    await db.tenant.updateMany({ data: { retentionDays: null } });
  });

  it('borra solo las cerradas antiguas, con sus mensajes, eventos y adjuntos', async () => {
    const tenant = await createTenant(90);
    const old = await Promise.all(
      [100, 100, 100].map((days) =>
        createConversation(tenant, { status: 'CLOSED', lastMessageDaysAgo: days }),
      ),
    );
    const recentClosed = await createConversation(tenant, {
      status: 'CLOSED',
      lastMessageDaysAgo: 10,
    });
    const oldOpen = await createConversation(tenant, { status: 'OPEN', lastMessageDaysAgo: 400 });

    const report = await job.run(now);

    expect(report?.tenants).toEqual([
      {
        tenantId: tenant.tenantId,
        conversations: 3,
        messages: 6,
        contacts: 3,
        failed: false,
      },
    ]);
    for (const conversation of old) {
      expect(await conversationExists(conversation.conversationId)).toBe(false);
      expect(await objectExists(conversation.storageKey)).toBe(false);
    }
    const oldIds = old.map((conversation) => conversation.conversationId);
    expect(await db.message.count({ where: { conversationId: { in: oldIds } } })).toBe(0);
    expect(await db.conversationEvent.count({ where: { conversationId: { in: oldIds } } })).toBe(0);
    expect(
      await db.messageAttachment.count({ where: { message: { conversationId: { in: oldIds } } } }),
    ).toBe(0);

    expect(await conversationExists(recentClosed.conversationId)).toBe(true);
    expect(await conversationExists(oldOpen.conversationId)).toBe(true);
    expect(await objectExists(recentClosed.storageKey)).toBe(true);
    expect(await db.message.count({ where: { conversationId: oldOpen.conversationId } })).toBe(2);

    const log = await db.deletionLog.findMany({ where: { tenantId: tenant.tenantId } });
    expect(log).toEqual([
      expect.objectContaining({
        kind: 'retention',
        actorMemberId: null,
        conversationsDeleted: 3,
        messagesDeleted: 6,
      }),
    ]);
  });

  it('borra los contactos que quedan sin conversaciones y conserva los que aún tienen', async () => {
    const tenant = await createTenant(180);
    const orphan = await createConversation(tenant, { status: 'CLOSED', lastMessageDaysAgo: 200 });
    const kept = await createConversation(tenant, { status: 'CLOSED', lastMessageDaysAgo: 200 });
    const recent = await createConversation(tenant, {
      status: 'OPEN',
      lastMessageDaysAgo: 1,
      contactId: kept.contactId,
    });

    await job.run(now);

    expect(await db.contact.count({ where: { id: orphan.contactId } })).toBe(0);
    expect(await db.contactIdentity.count({ where: { contactId: orphan.contactId } })).toBe(0);
    expect(await db.contact.count({ where: { id: kept.contactId } })).toBe(1);
    expect(await db.contactIdentity.count({ where: { contactId: kept.contactId } })).toBe(1);
    expect(await conversationExists(recent.conversationId)).toBe(true);
  });

  it('con retentionDays = null no borra ninguna conversación de esa empresa', async () => {
    const tenant = await createTenant(null);
    const ancient = await createConversation(tenant, { status: 'CLOSED', lastMessageDaysAgo: 900 });

    const report = await job.run(now);

    expect(report?.tenants).toEqual([]);
    expect(await conversationExists(ancient.conversationId)).toBe(true);
    expect(await db.contact.count({ where: { id: ancient.contactId } })).toBe(1);
  });

  it('procesa más de un lote de 500', async () => {
    const tenant = await createTenant(90);
    const contactId = await createContact(tenant);
    await db.conversation.createMany({
      data: Array.from({ length: 501 }, () => ({
        tenantId: tenant.tenantId,
        channelId: tenant.channelId,
        contactId,
        status: 'CLOSED' as const,
        lastMessageAt: daysAgo(120),
        lastMessagePreview: 'Hola',
      })),
    });

    const report = await job.run(now);

    expect(report?.tenants[0]).toMatchObject({ conversations: 501, contacts: 1 });
    expect(await db.conversation.count({ where: { tenantId: tenant.tenantId } })).toBe(0);
  });

  it('si otra instancia tiene el lock, termina sin hacer nada', async () => {
    const tenant = await createTenant(90);
    const old = await createConversation(tenant, { status: 'CLOSED', lastMessageDaysAgo: 100 });

    const other = new Client({ connectionString: testDatabaseUrl() });
    await other.connect();
    try {
      await other.query('SELECT pg_advisory_lock(hashtext($1))', [RETENTION_LOCK_NAME]);
      expect(await job.run(now)).toBeNull();
      expect(await conversationExists(old.conversationId)).toBe(true);
    } finally {
      await other.end();
    }

    // Con el lock libre, la siguiente ejecución sí borra.
    expect(await job.run(now)).not.toBeNull();
    expect(await conversationExists(old.conversationId)).toBe(false);
  });

  it('dos ejecuciones a la vez borran cada conversación una sola vez', async () => {
    const tenant = await createTenant(90);
    await Promise.all(
      [100, 100, 100].map((days) =>
        createConversation(tenant, { status: 'CLOSED', lastMessageDaysAgo: days }),
      ),
    );

    const reports = await Promise.all([job.run(now), job.run(now)]);

    const deleted = reports
      .flatMap((report) => report?.tenants ?? [])
      .reduce((sum, result) => sum + result.conversations, 0);
    expect(deleted).toBe(3);
    expect(await db.deletionLog.count({ where: { tenantId: tenant.tenantId } })).toBe(1);
  });

  it('purga el Outbox publicado, el Inbox, las sesiones y las invitaciones de hace más de 30 días', async () => {
    const tenant = await createTenant(null);
    const payload = {
      type: 'conversation.changed',
      conversationId: randomUUID(),
      reason: 'message',
      occurredAt: now.toISOString(),
    };
    const outbox = (publishedDaysAgo: number) =>
      db.outboxEvent.create({
        data: {
          tenantId: tenant.tenantId,
          type: 'conversation.changed',
          payload,
          publishedAt: daysAgo(publishedDaysAgo),
        },
      });
    const old31 = await outbox(31);
    const recent29 = await outbox(29);
    const pending = await db.outboxEvent.create({
      data: {
        tenantId: tenant.tenantId,
        type: 'conversation.changed',
        payload,
        createdAt: daysAgo(60),
      },
    });

    const oldInbox = await db.eventInbox.create({
      data: { channelId: tenant.channelId, externalId: randomUUID(), receivedAt: daysAgo(31) },
    });
    const recentInbox = await db.eventInbox.create({
      data: { channelId: tenant.channelId, externalId: randomUUID(), receivedAt: daysAgo(29) },
    });

    const user = await db.user.create({
      data: { email: `${randomUUID()}@e2e.local`, displayName: 'Ret' },
    });
    const session = (data: { expiresAt: Date; revokedAt?: Date }) =>
      db.session.create({
        data: { tokenHash: randomUUID(), userId: user.id, lastSeenAt: now, ...data },
      });
    const expiredOld = await session({ expiresAt: daysAgo(31) });
    const revokedOld = await session({ expiresAt: daysAgo(-10), revokedAt: daysAgo(31) });
    const expiredRecent = await session({ expiresAt: daysAgo(29) });
    const active = await session({ expiresAt: daysAgo(-30) });

    const owner = await db.tenantMember.create({
      data: {
        tenantId: tenant.tenantId,
        userId: user.id,
        email: user.email,
        displayName: 'Ret',
        role: 'OWNER',
      },
    });
    const invitation = (data: { expiresAt: Date; acceptedAt?: Date; revokedAt?: Date }) =>
      db.invitation.create({
        data: {
          tenantId: tenant.tenantId,
          email: `${randomUUID()}@e2e.local`,
          role: 'AGENT',
          tokenHash: randomUUID(),
          invitedById: owner.id,
          ...data,
        },
      });
    const acceptedOld = await invitation({ expiresAt: daysAgo(20), acceptedAt: daysAgo(31) });
    const expiredInviteOld = await invitation({ expiresAt: daysAgo(31) });
    const pendingInvite = await invitation({ expiresAt: daysAgo(-7) });
    const revokedRecent = await invitation({ expiresAt: daysAgo(-3), revokedAt: daysAgo(29) });

    await job.run(now);

    const ids = async <T extends { id: string }>(rows: Promise<T[]>) =>
      (await rows).map((row) => row.id).sort();
    expect(
      await ids(
        db.outboxEvent.findMany({ where: { id: { in: [old31.id, recent29.id, pending.id] } } }),
      ),
    ).toEqual([recent29.id, pending.id].sort());
    expect(
      await ids(db.eventInbox.findMany({ where: { id: { in: [oldInbox.id, recentInbox.id] } } })),
    ).toEqual([recentInbox.id]);
    expect(await ids(db.session.findMany({ where: { userId: user.id } }))).toEqual(
      [expiredRecent.id, active.id].sort(),
    );
    expect(await db.session.count({ where: { id: { in: [expiredOld.id, revokedOld.id] } } })).toBe(
      0,
    );
    expect(await ids(db.invitation.findMany({ where: { tenantId: tenant.tenantId } }))).toEqual(
      [pendingInvite.id, revokedRecent.id].sort(),
    );
    expect(
      await db.invitation.count({ where: { id: { in: [acceptedOld.id, expiredInviteOld.id] } } }),
    ).toBe(0);

    // Que el dispatcher de otros archivos no se encuentre este evento pendiente.
    await db.outboxEvent.deleteMany({ where: { tenantId: tenant.tenantId } });
  });
});
