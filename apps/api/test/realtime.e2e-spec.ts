import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  CONVERSATION_CHANGED_EVENT,
  REALTIME_PATH,
  RealtimeEventSchema,
  type RealtimeEvent,
} from '@omnidesk/contracts';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PromMetrics } from '../src/modules/observability/infrastructure/prom-metrics';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { devLogin, sessionFor } from './support/session';
import { E2E_DEMO_KEY, testEnv } from './support/test-env';

async function startApp(overrides: Record<string, string> = {}): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(testEnv(overrides))],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    rawBody: true,
  });
  configureApp(app, testEnv(overrides));
  await app.listen(0, '127.0.0.1');
  return app;
}

const urlOf = (app: NestExpressApplication) =>
  `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

const phone = () => `+57300${randomInt(1_000_000, 9_999_999)}`;

const inboundBody = (externalMessageId = randomUUID()) => ({
  externalMessageId,
  from: { externalId: phone(), displayName: 'Cliente e2e' },
  text: 'Hola',
  sentAt: new Date().toISOString(),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Repite `check` hasta que devuelve un valor o se agota el tiempo. */
async function eventually<T>(check: () => Promise<T | null>, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error('Condición no cumplida a tiempo');
    await sleep(50);
  }
}

describe('Tiempo real: Outbox + Socket.IO (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const sockets: Socket[] = [];
  /** Sesión del supervisor demo: el socket se une al room del tenant demo. */
  let ownerCookie: string;
  const http = () => request(app.getHttpServer());

  const inbound = (body: object) =>
    http()
      .post('/api/v1/integrations/messages/inbound')
      .set('Authorization', `Bearer ${E2E_DEMO_KEY}`)
      .send(body);

  const outbound = (body: object) =>
    http()
      .post('/api/v1/integrations/messages/outbound')
      .set('Authorization', `Bearer ${E2E_DEMO_KEY}`)
      .send(body);

  const outboxRows = (conversationId: string) =>
    prisma.outboxEvent.findMany({
      where: {
        type: 'conversation.changed',
        payload: { path: ['conversationId'], equals: conversationId },
      },
    });

  const connect = (cookie: string | null = ownerCookie, baseUrl = urlOf(app)): Socket => {
    const socket = io(baseUrl, {
      path: REALTIME_PATH,
      reconnection: false,
      ...(cookie && { extraHeaders: { cookie } }),
    });
    sockets.push(socket);
    return socket;
  };

  const nextEvent = (socket: Socket, timeoutMs = 2_000) =>
    new Promise<RealtimeEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sin evento a tiempo')), timeoutMs);
      socket.once(CONVERSATION_CHANGED_EVENT, (payload: unknown) => {
        clearTimeout(timer);
        resolve(RealtimeEventSchema.parse(payload));
      });
    });

  const connected = (socket: Socket) =>
    new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    const owner = await prisma.tenantMember.findFirstOrThrow({
      where: { email: 'supervisor@demo.omnidesk.local' },
    });
    ownerCookie = await devLogin(app, owner.id);
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Outbox', () => {
    it('un inbound nuevo crea exactamente una fila y un duplicado no crea ninguna', async () => {
      const body = inboundBody();
      const first = await inbound(body).expect(201);
      expect(await outboxRows(first.body.conversationId)).toHaveLength(1);

      await inbound(body).expect(200);

      expect(await outboxRows(first.body.conversationId)).toHaveLength(1);
    });

    it('un outbound de IA aceptado crea una fila y uno rechazado con 409 no crea ninguna', async () => {
      const { conversationId } = (await inbound(inboundBody()).expect(201)).body;
      const before = (await outboxRows(conversationId)).length;
      const reply = {
        conversationId,
        controlVersion: 0,
        idempotencyKey: `ai-${randomUUID()}`,
        text: 'Hola',
      };

      await outbound(reply).expect(201);
      expect(await outboxRows(conversationId)).toHaveLength(before + 1);

      await outbound({ ...reply, idempotencyKey: `ai-${randomUUID()}`, controlVersion: 99 }).expect(
        409,
      );
      expect(await outboxRows(conversationId)).toHaveLength(before + 1);
    });

    it('marca como publicadas las filas en menos de 1 s', async () => {
      const { conversationId } = (await inbound(inboundBody()).expect(201)).body;

      const rows = await eventually(async () => {
        const found = await outboxRows(conversationId);
        return found.length > 0 && found.every((row) => row.publishedAt) ? found : null;
      }, 1_500);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ attempts: 0, lastError: null });
    });
  });

  describe('Socket.IO', () => {
    it('entrega conversation.changed con el conversationId del inbound en menos de 2 s', async () => {
      const socket = connect();
      await connected(socket);
      const received = nextEvent(socket);

      const { conversationId } = (await inbound(inboundBody()).expect(201)).body;

      expect(await received).toMatchObject({
        type: 'conversation.changed',
        conversationId,
        reason: 'message',
      });
    });

    it('entrega también el evento de una respuesta de IA', async () => {
      const { conversationId } = (await inbound(inboundBody()).expect(201)).body;
      const socket = connect();
      await connected(socket);
      // El socket se une al room de forma asíncrona tras conectar.
      await sleep(200);
      const received = nextEvent(socket);

      await outbound({
        conversationId,
        controlVersion: 0,
        idempotencyKey: `ai-${randomUUID()}`,
        text: 'Hola',
      }).expect(201);

      expect(await received).toMatchObject({ conversationId, reason: 'message' });
    });

    it('acepta el origen de CORS_ORIGINS y no otro', async () => {
      const allowed = await fetch(`${urlOf(app)}${REALTIME_PATH}/?EIO=4&transport=polling`, {
        headers: { Origin: 'http://localhost:8080' },
      });
      expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:8080');

      const denied = await fetch(`${urlOf(app)}${REALTIME_PATH}/?EIO=4&transport=polling`, {
        headers: { Origin: 'http://evil.example' },
      });
      expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('sesión en el handshake', () => {
    const rejected = async (socket: Socket) => {
      const error = new Promise<string>((resolve) => socket.once('error', resolve));
      const disconnected = new Promise<void>((resolve) =>
        socket.once('disconnect', () => resolve()),
      );
      const message = await error;
      await disconnected;
      expect(socket.connected).toBe(false);
      return message;
    };

    it('el gauge de sockets cuenta solo los aceptados y baja al desconectar (SPEC 11)', async () => {
      const gauge = app.get(PromMetrics).realtimeConnectedSockets;
      const value = async () => (await gauge.get()).values[0]?.value ?? 0;
      /** El join del servidor termina después del `connect` del cliente: se espera al valor. */
      const until = async (expected: number) => {
        for (let attempt = 0; attempt < 40 && (await value()) !== expected; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(await value()).toBe(expected);
      };
      const base = await value();

      const first = connect();
      const second = connect();
      await Promise.all([connected(first), connected(second)]);
      await until(base + 2);

      await rejected(connect(null));
      expect(await value()).toBe(base + 2);

      first.close();
      await until(base + 1);
      second.close();
      await until(base);
    });

    it('sin cookie rechaza la conexión', async () => {
      expect(await rejected(connect(null))).toBe('Autenticación requerida');
    });

    it('con una cookie inválida rechaza la conexión', async () => {
      expect(await rejected(connect('omnidesk_session=falsa'))).toBe('Autenticación requerida');
    });

    it('con sesión, recibe solo los eventos de su empresa activa', async () => {
      const tenant = await prisma.tenant.create({
        data: { slug: `rt-${randomUUID()}`, name: 'Otra empresa' },
      });
      const user = await prisma.user.create({
        data: { email: `rt-${randomUUID()}@otra.local`, displayName: 'Ajena' },
      });
      await prisma.tenantMember.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          email: user.email,
          displayName: 'Ajena',
          role: 'OWNER',
        },
      });
      const foreign = connect(await sessionFor(app, user.id, tenant.id));
      const demo = connect();
      await Promise.all([connected(foreign), connected(demo)]);
      await sleep(200);
      let foreignEvents = 0;
      foreign.on(CONVERSATION_CHANGED_EVENT, () => (foreignEvents += 1));
      const received = nextEvent(demo);

      const { conversationId } = (await inbound(inboundBody()).expect(201)).body;

      expect(await received).toMatchObject({ conversationId });
      await sleep(300);
      expect(foreignEvents).toBe(0);
    });
  });
});
