import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  DeliveryStatusResponseSchema,
  ListMessagesResponseSchema,
  MessageSchema,
  type Message,
} from '@omnidesk/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { ENV, type Env } from '../src/shared/config/env';
import { sha256Hex } from '../src/shared/infrastructure/crypto/sha256';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { devLogin, WEB_ORIGIN } from './support/session';
import { E2E_DEMO_KEY, testEnv } from './support/test-env';

const phone = () => `+57300${randomInt(1_000_000, 9_999_999)}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Repite `check` hasta que devuelve un valor o se agota el tiempo. */
async function eventually<T>(check: () => Promise<T | null>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error('Condición no cumplida a tiempo');
    await sleep(50);
  }
}

describe('Atención humana (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let env: Env;
  let owner: string;
  let laura: string;
  let mateo: string;
  let foreignKey: string;
  const http = () => request(app.getHttpServer());

  const integrationPost = (path: string, body: object, key = E2E_DEMO_KEY) =>
    http().post(path).set('Authorization', `Bearer ${key}`).send(body);

  const inbound = async () =>
    (
      await integrationPost('/api/v1/integrations/messages/inbound', {
        externalMessageId: randomUUID(),
        from: { externalId: phone(), displayName: 'Cliente e2e' },
        text: 'Hola',
        sentAt: new Date().toISOString(),
      })
    ).body as { conversationId: string; controlVersion: number };

  /** Cookie de sesión de cada miembro demo (dev-login en `beforeAll`). */
  const cookies = new Map<string, string>();
  const post = (actor: string, path: string, body: object = {}) =>
    http().post(path).set('Cookie', cookies.get(actor)!).set('Origin', WEB_ORIGIN).send(body);

  /** Conversación nueva asignada a Laura. */
  async function lauraConversation(): Promise<string> {
    const { conversationId, controlVersion } = await inbound();
    await post(owner, `/api/v1/conversations/${conversationId}/assign`, {
      memberId: laura,
      controlVersion,
    }).expect(200);
    return conversationId;
  }

  const send = (
    actor: string,
    conversationId: string,
    text = 'Hola, soy Laura',
    id = randomUUID(),
  ) =>
    post(actor, `/api/v1/conversations/${conversationId}/messages`, { text, clientMessageId: id });

  const statusOf = async (messageId: string) =>
    (await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).status;

  const waitForStatus = (messageId: string, status: string, timeoutMs: number) =>
    eventually(async () => ((await statusOf(messageId)) === status ? status : null), timeoutMs);

  const report = (messageId: string, status: string, key = E2E_DEMO_KEY) =>
    integrationPost(
      '/api/v1/integrations/messages/status',
      {
        messageId,
        providerMessageId: `ext-${messageId}`,
        status,
        occurredAt: new Date().toISOString(),
      },
      key,
    );

  /** Respuesta de IA registrada (PENDING) en una conversación nueva. */
  async function aiMessage(): Promise<string> {
    const { conversationId, controlVersion } = await inbound();
    const res = await integrationPost('/api/v1/integrations/messages/outbound', {
      conversationId,
      controlVersion,
      idempotencyKey: randomUUID(),
      text: 'Respuesta de IA',
    }).expect(201);
    return (res.body as { messageId: string }).messageId;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(testEnv())],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bufferLogs: true,
      rawBody: true,
    });
    configureApp(app, testEnv());
    await app.init();
    prisma = app.get(PrismaService);
    env = app.get<Env>(ENV);

    const member = async (email: string) =>
      (await prisma.tenantMember.findFirstOrThrow({ where: { email } })).id;
    owner = await member('supervisor@demo.omnidesk.local');
    laura = await member('laura@demo.omnidesk.local');
    mateo = await member('mateo@demo.omnidesk.local');
    for (const id of [owner, laura, mateo]) cookies.set(id, await devLogin(app, id));

    // Otro tenant con su canal y su credencial, para probar el aislamiento por canal.
    foreignKey = `otro-canal-key-${randomUUID()}`;
    const tenant = await prisma.tenant.create({
      data: { approval: 'APPROVED', slug: `otro-${randomUUID()}`, name: 'Otro tenant' },
    });
    const channel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        name: 'Otro canal',
        type: 'WHATSAPP',
        provider: 'N8N',
        externalId: `otro-${randomUUID()}`,
      },
    });
    await prisma.integrationCredential.create({
      data: { tenantId: tenant.id, channelId: channel.id, keyHash: sha256Hex(foreignKey) },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /conversations/:id/messages', () => {
    it('Laura (asignada) recibe 201 con PENDING, AGENT y su nombre', async () => {
      const conversationId = await lauraConversation();

      const res = await send(laura, conversationId).expect(201);

      const message = MessageSchema.parse(res.body);
      expect(message).toMatchObject({
        status: 'PENDING',
        senderType: 'AGENT',
        direction: 'OUTBOUND',
        sender: { id: laura, displayName: 'Laura' },
        failureReason: null,
      });
    });

    it('repetir el POST con el mismo clientMessageId devuelve el mismo mensaje sin crear filas', async () => {
      const conversationId = await lauraConversation();
      const clientMessageId = randomUUID();

      const first = await send(laura, conversationId, 'Uno', clientMessageId).expect(201);
      const again = await send(laura, conversationId, 'Uno', clientMessageId).expect(200);

      expect(again.body.id).toBe(first.body.id);
      expect(await prisma.message.count({ where: { conversationId, senderType: 'AGENT' } })).toBe(
        1,
      );
      expect(
        await prisma.outboxEvent.count({
          where: {
            type: 'message.send_requested',
            payload: { path: ['messageId'], equals: first.body.id },
          },
        }),
      ).toBe(1);
    });

    it('Mateo y Sup. Demo, que la ven sin estar asignados, reciben 403 (SPEC 21)', async () => {
      const conversationId = await lauraConversation();

      await send(mateo, conversationId).expect(403);
      await send(owner, conversationId).expect(403);
      expect(await prisma.message.count({ where: { conversationId, senderType: 'AGENT' } })).toBe(
        0,
      );
    });

    it('en una conversación CLOSED responde 409 INVALID_STATE', async () => {
      const conversationId = await lauraConversation();
      const { controlVersion } = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
      });
      await post(laura, `/api/v1/conversations/${conversationId}/close`, { controlVersion }).expect(
        200,
      );

      const res = await send(laura, conversationId).expect(409);

      expect(res.body).toMatchObject({ reason: 'INVALID_STATE' });
    });

    it('rechaza un cuerpo inválido con 400', async () => {
      const conversationId = await lauraConversation();

      await post(laura, `/api/v1/conversations/${conversationId}/messages`, {
        text: '',
        clientMessageId: randomUUID(),
      }).expect(400);
      await post(laura, `/api/v1/conversations/${conversationId}/messages`, {
        text: 'Hola',
        clientMessageId: 'no-uuid',
      }).expect(400);
    });

    it('el mensaje pasa a SENT (≤ 1 s), DELIVERED (≈ 1,5 s) y READ (≈ 4 s) con el providerMessageId', async () => {
      const conversationId = await lauraConversation();
      const res = await send(laura, conversationId).expect(201);
      const messageId = (res.body as Message).id;
      const startedAt = Date.now();

      await waitForStatus(messageId, 'SENT', 1_500);
      await waitForStatus(messageId, 'DELIVERED', 3_000);
      await waitForStatus(messageId, 'READ', 6_000);

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(3_500);
      const stored = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(stored.externalId).toBe(`sim-${messageId}`);

      const list = await http()
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .set('Cookie', cookies.get(laura)!)
        .expect(200);
      const agentMessage = ListMessagesResponseSchema.parse(list.body).items.find(
        (m) => m.id === messageId,
      );
      expect(agentMessage).toMatchObject({ status: 'READ', sender: { displayName: 'Laura' } });
    });

    it('cada cambio de estado encola conversation.changed con reason delivery', async () => {
      const conversationId = await lauraConversation();
      const res = await send(laura, conversationId).expect(201);
      await waitForStatus((res.body as Message).id, 'SENT', 2_000);

      const events = await prisma.outboxEvent.findMany({
        where: {
          type: 'conversation.changed',
          payload: { path: ['conversationId'], equals: conversationId },
        },
      });
      const reasons = events.map((e) => (e.payload as { reason: string }).reason);
      expect(reasons.filter((r) => r === 'delivery').length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('POST /integrations/messages/status', () => {
    it('SENT para una respuesta de IA PENDING responde 200 { applied: true, status: SENT }', async () => {
      const messageId = await aiMessage();

      const res = await report(messageId, 'SENT').expect(200);

      expect(DeliveryStatusResponseSchema.parse(res.body)).toEqual({
        applied: true,
        status: 'SENT',
      });
      expect(await statusOf(messageId)).toBe('SENT');
    });

    it('repetir el reporte responde applied: false y no crea filas en event_inbox', async () => {
      const messageId = await aiMessage();
      await report(messageId, 'SENT').expect(200);
      const rows = await prisma.eventInbox.count();

      const res = await report(messageId, 'SENT').expect(200);

      expect(res.body).toMatchObject({ applied: false, status: 'SENT' });
      expect(await prisma.eventInbox.count()).toBe(rows);
    });

    it('READ y después DELIVERED deja el mensaje en READ', async () => {
      const messageId = await aiMessage();
      await report(messageId, 'READ').expect(200);

      const res = await report(messageId, 'DELIVERED').expect(200);

      expect(res.body).toMatchObject({ applied: false, status: 'READ' });
      expect(await statusOf(messageId)).toBe('READ');
    });

    it('un FAILED tardío no pisa un DELIVERED', async () => {
      const messageId = await aiMessage();
      await report(messageId, 'DELIVERED').expect(200);

      const res = await report(messageId, 'FAILED').expect(200);

      expect(res.body).toMatchObject({ applied: false, status: 'DELIVERED' });
    });

    it('un messageId de otro canal responde 404; sin credencial, 401', async () => {
      const messageId = await aiMessage();

      await report(messageId, 'SENT', foreignKey).expect(404);
      await http()
        .post('/api/v1/integrations/messages/status')
        .send({
          messageId,
          providerMessageId: 'x',
          status: 'SENT',
          occurredAt: new Date().toISOString(),
        })
        .expect(401);
      expect(await statusOf(messageId)).toBe('PENDING');
    });

    it('rechaza un estado inválido con 400', async () => {
      await report(randomUUID(), 'PENDING').expect(400);
    });
  });

  describe('POST /conversations/:id/messages/:messageId/retry', () => {
    it('sobre un mensaje que no está en FAILED responde 409 INVALID_STATE', async () => {
      const conversationId = await lauraConversation();
      const res = await send(laura, conversationId).expect(201);

      const retry = await post(
        laura,
        `/api/v1/conversations/${conversationId}/messages/${(res.body as Message).id}/retry`,
      ).expect(409);

      expect(retry.body).toMatchObject({ reason: 'INVALID_STATE' });
    });
  });

  describe('fallo del proveedor', () => {
    it('queda FAILED tras 5 reintentos (≈ 31 s) y el reintento manual lo lleva a PENDING y SENT', async () => {
      const conversationId = await lauraConversation();
      env.SIMULATED_PROVIDER_FAILURE_RATE = 1;
      const res = await send(laura, conversationId).expect(201);
      const messageId = (res.body as Message).id;

      await waitForStatus(messageId, 'FAILED', 45_000);

      const failed = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
      expect(failed.failureReason).toBeTruthy();
      const event = await prisma.outboxEvent.findFirstOrThrow({
        where: {
          type: 'message.send_requested',
          payload: { path: ['messageId'], equals: messageId },
        },
      });
      expect(event.attempts).toBe(5);

      // Solo el agente asignado puede reintentar.
      await post(
        owner,
        `/api/v1/conversations/${conversationId}/messages/${messageId}/retry`,
      ).expect(403);

      env.SIMULATED_PROVIDER_FAILURE_RATE = 0;
      const retry = await post(
        laura,
        `/api/v1/conversations/${conversationId}/messages/${messageId}/retry`,
      ).expect(200);
      expect(retry.body).toMatchObject({ status: 'PENDING', failureReason: null });

      await waitForStatus(messageId, 'SENT', 3_000);
    }, 70_000);
  });
});
