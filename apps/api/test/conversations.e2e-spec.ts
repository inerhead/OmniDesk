import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  DEMO_MEMBER_HEADER,
  InboundMessageResponseSchema,
  ListConversationsResponseSchema,
  ListMessagesResponseSchema,
} from '@omnidesk/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { sha256Hex } from '../src/shared/infrastructure/crypto/sha256';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { E2E_DEMO_KEY, testEnv } from './support/test-env';

async function createApp(overrides: Record<string, string> = {}): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(testEnv(overrides))],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app, testEnv(overrides));
  await app.init();
  return app;
}

const phone = () => `+57300${randomInt(1_000_000, 9_999_999)}`;

const inboundBody = (from: string, text = 'Hola', externalMessageId = randomUUID()) => ({
  externalMessageId,
  from: { externalId: from, displayName: 'Cliente e2e' },
  text,
  sentAt: new Date().toISOString(),
});

describe('Bandeja de conversaciones (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const otherKey = `e2e-other-key-${randomUUID()}`;
  const http = () => request(app.getHttpServer());
  let supervisorId: string;

  /** Lectura de la web: actúa como el supervisor demo (ve todas las bandejas). */
  const read = (path: string) => http().get(path).set(DEMO_MEMBER_HEADER, supervisorId);

  const inbound = (body: object, key = E2E_DEMO_KEY) =>
    http()
      .post('/api/v1/integrations/messages/inbound')
      .set('Authorization', `Bearer ${key}`)
      .send(body);

  const outbound = (body: object, key = E2E_DEMO_KEY) =>
    http()
      .post('/api/v1/integrations/messages/outbound')
      .set('Authorization', `Bearer ${key}`)
      .send(body);

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    supervisorId = (
      await prisma.tenantMember.findFirstOrThrow({
        where: { role: 'OWNER', tenant: { slug: 'demo' } },
      })
    ).id;

    // Segundo tenant con su propio canal y credencial, para probar el aislamiento.
    const tenant = await prisma.tenant.create({
      data: { slug: `otro-${randomUUID()}`, name: 'Otro tenant' },
    });
    const channel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        name: 'Otro canal',
        type: 'WHATSAPP',
        provider: 'N8N',
        externalId: 'otro',
      },
    });
    await prisma.integrationCredential.create({
      data: { tenantId: tenant.id, channelId: channel.id, keyHash: sha256Hex(otherKey) },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /integrations/messages/inbound', () => {
    it('responde 401 sin credencial o con una credencial inválida', async () => {
      await http()
        .post('/api/v1/integrations/messages/inbound')
        .send(inboundBody(phone()))
        .expect(401);
      await inbound(inboundBody(phone()), 'key-inexistente-0123456789').expect(401);
    });

    it('registra un mensaje nuevo con aiAllowed y controlVersion 0', async () => {
      const res = await inbound(inboundBody(phone())).expect(201);

      expect(InboundMessageResponseSchema.parse(res.body)).toMatchObject({
        aiAllowed: true,
        controlVersion: 0,
        duplicate: false,
      });
    });

    it('deduplica por externalMessageId sin crear filas', async () => {
      const body = inboundBody(phone());
      const first = await inbound(body).expect(201);
      const before = await prisma.message.count();

      const again = await inbound(body).expect(200);

      expect(again.body).toMatchObject({ messageId: first.body.messageId, duplicate: true });
      expect(await prisma.message.count()).toBe(before);
    });

    it('agrupa los mensajes del mismo teléfono con sequence 1 y 2', async () => {
      const from = phone();
      const first = await inbound(inboundBody(from, 'uno')).expect(201);
      const second = await inbound(inboundBody(from, 'dos')).expect(201);

      expect(second.body.conversationId).toBe(first.body.conversationId);
      const sequences = await prisma.message.findMany({
        where: { conversationId: first.body.conversationId },
        orderBy: { sequence: 'asc' },
        select: { sequence: true },
      });
      expect(sequences.map((m) => m.sequence)).toEqual([1, 2]);
    });

    it('dos inbound simultáneos de un contacto nuevo quedan en una sola conversación', async () => {
      const from = phone();
      const [a, b] = await Promise.all([
        inbound(inboundBody(from, 'a')),
        inbound(inboundBody(from, 'b')),
      ]);

      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.conversationId).toBe(b.body.conversationId);
    });

    it('responde 400 con text vacío o de más de 4096 caracteres', async () => {
      await inbound(inboundBody(phone(), '')).expect(400);
      await inbound(inboundBody(phone(), 'a'.repeat(4097))).expect(400);
    });
  });

  describe('POST /integrations/messages/outbound', () => {
    let conversationId: string;

    beforeAll(async () => {
      conversationId = (await inbound(inboundBody(phone()))).body.conversationId;
    });

    const reply = (overrides: object = {}) => ({
      conversationId,
      controlVersion: 0,
      idempotencyKey: `ai-${randomUUID()}`,
      text: '¡Hola! ¿En qué te ayudo?',
      ...overrides,
    });

    it('registra la respuesta de IA como PENDING', async () => {
      const res = await outbound(reply()).expect(201);

      expect(res.body.sendAllowed).toBe(true);
      const message = await prisma.message.findUniqueOrThrow({ where: { id: res.body.messageId } });
      expect(message).toMatchObject({ senderType: 'AI', status: 'PENDING', direction: 'OUTBOUND' });
    });

    it('es idempotente por idempotencyKey', async () => {
      const body = reply();
      const first = await outbound(body).expect(201);
      const before = await prisma.message.count();

      const again = await outbound(body).expect(201);

      expect(again.body.messageId).toBe(first.body.messageId);
      expect(await prisma.message.count()).toBe(before);
    });

    it('responde 409 CONTROL_CHANGED si el controlVersion no coincide', async () => {
      const res = await outbound(reply({ controlVersion: 99 })).expect(409);

      expect(res.body).toEqual({ sendAllowed: false, reason: 'CONTROL_CHANGED' });
    });

    it('responde 404 para una conversación de otro canal', async () => {
      await outbound(reply(), otherKey).expect(404);
    });
  });

  describe('lectura', () => {
    it('lista las conversaciones de la más reciente a la más antigua', async () => {
      const older = (await inbound(inboundBody(phone()))).body.conversationId;
      const newer = (await inbound(inboundBody(phone()))).body.conversationId;

      const res = await read('/api/v1/conversations').expect(200);
      const page = ListConversationsResponseSchema.parse(res.body);

      const ids = page.items.map((item) => item.id);
      expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
      const times = page.items.map((item) => item.lastMessageAt);
      expect([...times].sort().reverse()).toEqual(times);
    });

    it('recorre más de 30 conversaciones con nextCursor sin repetir ninguna', async () => {
      const created = new Set<string>();
      for (let i = 0; i < 31; i++) {
        created.add((await inbound(inboundBody(phone()))).body.conversationId);
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res = await read('/api/v1/conversations')
          .query(cursor ? { cursor, limit: 30 } : { limit: 30 })
          .expect(200);
        const page = ListConversationsResponseSchema.parse(res.body);
        seen.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
      } while (cursor);

      expect(new Set(seen).size).toBe(seen.length);
      for (const id of created) expect(seen).toContain(id);
    });

    it('devuelve los mensajes en orden ascendente y pagina hacia atrás con before', async () => {
      const from = phone();
      let conversationId = '';
      for (let i = 1; i <= 5; i++) {
        conversationId = (await inbound(inboundBody(from, `mensaje ${i}`))).body.conversationId;
      }

      const latest = ListMessagesResponseSchema.parse(
        (
          await read(`/api/v1/conversations/${conversationId}/messages`)
            .query({ limit: 3 })
            .expect(200)
        ).body,
      );
      expect(latest.items.map((m) => m.sequence)).toEqual([3, 4, 5]);
      expect(latest.prevCursor).toBe(3);

      const older = ListMessagesResponseSchema.parse(
        (
          await read(`/api/v1/conversations/${conversationId}/messages`)
            .query({ limit: 3, before: latest.prevCursor })
            .expect(200)
        ).body,
      );
      expect(older.items.map((m) => m.sequence)).toEqual([1, 2]);
      expect(older.prevCursor).toBeNull();
    });

    it('aísla los tenants: la conversación de otro tenant no se lista y responde 404', async () => {
      const foreign = (await inbound(inboundBody(phone()), otherKey).expect(201)).body
        .conversationId;

      await read(`/api/v1/conversations/${foreign}/messages`).expect(404);

      let cursor: string | null = null;
      const seen: string[] = [];
      do {
        const res = await read('/api/v1/conversations').query(
          cursor ? { cursor, limit: 100 } : { limit: 100 },
        );
        const page = ListConversationsResponseSchema.parse(res.body);
        seen.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).not.toContain(foreign);
    });

    it('responde 400 ante un cursor inválido y 404 ante una conversación inexistente', async () => {
      await read('/api/v1/conversations').query({ cursor: 'basura' }).expect(400);
      await read(`/api/v1/conversations/${randomUUID()}/messages`).expect(404);
    });

    it('documenta los 4 endpoints nuevos en Swagger', async () => {
      const res = await read('/api/docs-json').expect(200);

      expect(Object.keys(res.body.paths)).toEqual(
        expect.arrayContaining([
          '/api/v1/integrations/messages/inbound',
          '/api/v1/integrations/messages/outbound',
          '/api/v1/conversations',
          '/api/v1/conversations/{id}/messages',
        ]),
      );
    });
  });
});

describe('Lectura con DEMO_MODE=false (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createApp({ DEMO_MODE: 'false' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/conversations responde 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/conversations').expect(401);
  });
});
