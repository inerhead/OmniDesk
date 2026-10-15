import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from '../src/modules/attachments/application/ports/attachment-storage';
import { OutboxDispatcher } from '../src/modules/realtime/infrastructure/outbox-dispatcher';
import { sha256Hex } from '../src/shared/infrastructure/crypto/sha256';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { sessionFor, WEB_ORIGIN } from './support/session';
import { testEnv } from './support/test-env';

describe('Borrado de un contacto a petición (e2e)', () => {
  let app: NestExpressApplication;
  let db: PrismaService;
  let storage: AttachmentStorage;
  let dispatcher: OutboxDispatcher;
  let tenantId: string;
  let channelId: string;
  let channelKey: string;
  let owner: { memberId: string; cookie: string };
  let admin: { memberId: string; cookie: string };
  let agent: { memberId: string; cookie: string };
  const http = () => request(app.getHttpServer());

  const as = (cookie: string) => ({
    get: (path: string) => http().get(path).set('Cookie', cookie),
    post: (path: string, body: object = {}) =>
      http().post(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN).send(body),
    delete: (path: string) => http().delete(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN),
  });

  const addMember = async (role: 'OWNER' | 'ADMIN' | 'AGENT', tenant = tenantId) => {
    const user = await db.user.create({
      data: { email: `${randomUUID()}@e2e.local`, displayName: `${role} e2e` },
    });
    const member = await db.tenantMember.create({
      data: { tenantId: tenant, userId: user.id, email: user.email, displayName: role, role },
    });
    return { memberId: member.id, cookie: await sessionFor(app, user.id, tenant) };
  };

  const inbound = async (phone: string, text = 'Hola') =>
    (
      await http()
        .post('/api/v1/integrations/messages/inbound')
        .set('Authorization', `Bearer ${channelKey}`)
        .send({
          externalMessageId: randomUUID(),
          from: { externalId: phone, displayName: 'Ana Pérez' },
          text,
          sentAt: new Date().toISOString(),
        })
        .expect((res) => expect([200, 201]).toContain(res.status))
    ).body as { conversationId: string; controlVersion: number };

  const controlVersion = async (conversationId: string) =>
    (await db.conversation.findUniqueOrThrow({ where: { id: conversationId } })).controlVersion;

  const contactOf = async (conversationId: string) =>
    (await db.conversation.findUniqueOrThrow({ where: { id: conversationId } })).contactId;

  /** Un adjunto en el bucket colgado de un mensaje de la conversación. */
  const attachFile = async (conversationId: string) => {
    const message = await db.message.findFirstOrThrow({ where: { conversationId } });
    const storageKey = `tenants/${tenantId}/attachments/${randomUUID()}`;
    await storage.put(storageKey, Buffer.from('foto'), {
      contentType: 'image/jpeg',
      contentLength: 4,
    });
    await db.messageAttachment.create({
      data: {
        tenantId,
        messageId: message.id,
        kind: 'IMAGE',
        mimeType: 'image/jpeg',
        storageKey,
        status: 'READY',
      },
    });
    return storageKey;
  };
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
    dispatcher = app.get(OutboxDispatcher);
    // El dispatcher se ejecuta a mano (`tick`) para controlar qué sale y cuándo.
    await dispatcher.onModuleDestroy();
    db = app.get(PrismaService);
    storage = app.get(ATTACHMENT_STORAGE);
  });
  afterAll(() => app.close());

  beforeEach(async () => {
    tenantId = (
      await db.tenant.create({
        data: { approval: 'APPROVED', name: 'Borrados', slug: `borrados-${randomUUID()}` },
      })
    ).id;
    owner = await addMember('OWNER');
    admin = await addMember('ADMIN');
    agent = await addMember('AGENT');
    channelKey = `borrados-key-${randomUUID()}`;
    channelId = (
      await db.channel.create({
        data: {
          tenantId,
          name: 'Ventas',
          type: 'WHATSAPP',
          provider: 'SIMULATED',
          externalId: `borrados-${randomUUID()}`,
        },
      })
    ).id;
    await db.integrationCredential.create({
      data: { tenantId, channelId, keyHash: sha256Hex(channelKey) },
    });
  });

  it('borra el contacto con todas sus conversaciones, mensajes, eventos y adjuntos', async () => {
    const phone = `+57301${Date.now() % 10_000_000}`;
    // Una conversación abierta y asignada, y otra antigua ya cerrada, del mismo contacto. Un
    // entrante reabriría la cerrada, así que esa se crea directamente en la base.
    const second = await inbound(phone, 'Otra consulta');
    const contactId = await contactOf(second.conversationId);
    const closed = await db.conversation.create({
      data: {
        tenantId,
        channelId,
        contactId,
        status: 'CLOSED',
        lastMessageAt: new Date(Date.now() - 86_400_000),
        lastMessagePreview: 'Hola',
        lastSequence: 2,
      },
    });
    await db.message.create({
      data: {
        tenantId,
        channelId,
        conversationId: closed.id,
        sequence: 1,
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        text: 'Hola',
        status: 'RECEIVED',
      },
    });
    await db.conversationEvent.create({
      data: { tenantId, conversationId: closed.id, sequence: 2, type: 'CLOSED' },
    });
    const first = { conversationId: closed.id };
    await as(owner.cookie)
      .post(`/api/v1/conversations/${second.conversationId}/assign`, {
        memberId: agent.memberId,
        controlVersion: await controlVersion(second.conversationId),
      })
      .expect(200);
    const key = await attachFile(second.conversationId);
    const other = await inbound(`+57302${Date.now() % 10_000_000}`);
    const ids = [first.conversationId, second.conversationId];
    const messages = await db.message.count({ where: { conversationId: { in: ids } } });

    await as(owner.cookie).delete(`/api/v1/contacts/${contactId}`).expect(204);

    expect(await db.contact.count({ where: { id: contactId } })).toBe(0);
    expect(await db.contactIdentity.count({ where: { contactId } })).toBe(0);
    expect(await db.conversation.count({ where: { id: { in: ids } } })).toBe(0);
    expect(await db.message.count({ where: { conversationId: { in: ids } } })).toBe(0);
    expect(await db.conversationEvent.count({ where: { conversationId: { in: ids } } })).toBe(0);
    expect(await objectExists(key)).toBe(false);
    await as(owner.cookie).get(`/api/v1/conversations/${second.conversationId}`).expect(404);
    // El resto de la empresa sigue intacto.
    await as(owner.cookie).get(`/api/v1/conversations/${other.conversationId}`).expect(200);

    const deletedEvents = await db.outboxEvent.findMany({
      where: {
        tenantId,
        type: 'conversation.changed',
        payload: { path: ['reason'], equals: 'deleted' },
      },
    });
    expect(
      deletedEvents
        .map((event) => (event.payload as { conversationId: string }).conversationId)
        .sort(),
    ).toEqual([...ids].sort());

    const log = await db.deletionLog.findMany({ where: { tenantId } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      kind: 'contact',
      actorMemberId: owner.memberId,
      conversationsDeleted: 2,
      messagesDeleted: messages,
    });
    // Sin datos personales: ni el teléfono ni el nombre aparecen en la fila.
    expect(JSON.stringify(log[0])).not.toContain(phone);
    expect(JSON.stringify(log[0])).not.toContain('Ana');
  });

  it('solo el Owner borra (403); un contacto desconocido o de otra empresa responde 404', async () => {
    const { conversationId } = await inbound(`+57303${Date.now() % 10_000_000}`);
    const contactId = await contactOf(conversationId);

    await as(admin.cookie).delete(`/api/v1/contacts/${contactId}`).expect(403);
    await as(agent.cookie).delete(`/api/v1/contacts/${contactId}`).expect(403);
    await as(owner.cookie).delete(`/api/v1/contacts/${randomUUID()}`).expect(404);
    await as(owner.cookie).delete('/api/v1/contacts/no-es-uuid').expect(400);

    const otherTenant = await db.tenant.create({
      data: { approval: 'APPROVED', name: 'Ajena', slug: `ajena-${randomUUID()}` },
    });
    const outsider = await addMember('OWNER', otherTenant.id);
    await as(outsider.cookie).delete(`/api/v1/contacts/${contactId}`).expect(404);

    expect(await db.contact.count({ where: { id: contactId } })).toBe(1);
    expect(await db.deletionLog.count({ where: { tenantId } })).toBe(0);
  });

  it('un envío PENDING del contacto borrado no rompe el dispatcher', async () => {
    const { conversationId } = await inbound(`+57304${Date.now() % 10_000_000}`);
    await as(owner.cookie)
      .post(`/api/v1/conversations/${conversationId}/assign`, {
        memberId: owner.memberId,
        controlVersion: await controlVersion(conversationId),
      })
      .expect(200);
    await as(owner.cookie)
      .post(`/api/v1/conversations/${conversationId}/messages`, {
        text: 'Ya te ayudo',
        clientMessageId: randomUUID(),
      })
      .expect(201);
    const sendEvent = await db.outboxEvent.findFirstOrThrow({
      where: { tenantId, type: 'message.send_requested', publishedAt: null },
    });

    await as(owner.cookie)
      .delete(`/api/v1/contacts/${await contactOf(conversationId)}`)
      .expect(204);
    await dispatcher.tick();

    const after = await db.outboxEvent.findUniqueOrThrow({ where: { id: sendEvent.id } });
    expect(after.publishedAt).not.toBeNull();
    expect(after.attempts).toBe(0);
    expect(after.lastError).toBeNull();
    expect(await db.outboxEvent.count({ where: { tenantId, publishedAt: null } })).toBe(0);
  });

  it('si el cliente vuelve a escribir, empieza de cero: contacto y conversación nuevos', async () => {
    const phone = `+57305${Date.now() % 10_000_000}`;
    const before = await inbound(phone, 'Primer mensaje');
    const oldContactId = await contactOf(before.conversationId);

    await as(owner.cookie).delete(`/api/v1/contacts/${oldContactId}`).expect(204);
    const after = await inbound(phone, 'Volví');

    expect(after.conversationId).not.toBe(before.conversationId);
    expect(await contactOf(after.conversationId)).not.toBe(oldContactId);
    const texts = (
      await db.message.findMany({ where: { conversationId: after.conversationId } })
    ).map((message) => message.text);
    expect(texts).toEqual(['Volví']);
  });
});
