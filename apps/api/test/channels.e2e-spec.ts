import 'reflect-metadata';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  ChannelCredentialsResponseSchema,
  ChannelSchema,
  ListChannelsResponseSchema,
  type Message,
} from '@omnidesk/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import {
  CHANNEL_SECRET_CIPHER,
  type ChannelSecretCipher,
} from '../src/modules/channels/application/ports/channel-secret-cipher';
import {
  CHANNEL_REPOSITORY,
  type ChannelRepository,
} from '../src/modules/channels/application/ports/channel.repository';
import { CREDENTIALS_GRACE_MS } from '../src/modules/channels/domain/channel';
import { signPayload, verifySignature } from '../src/shared/infrastructure/crypto/hmac-signature';
import { sha256Hex } from '../src/shared/infrastructure/crypto/sha256';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { sessionFor, WEB_ORIGIN } from './support/session';
import { E2E_DEMO_KEY, testEnv } from './support/test-env';

const phone = () => `+57300${randomInt(1_000_000, 9_999_999)}`;
const nowSec = () => Math.floor(Date.now() / 1000);

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

async function createApp(overrides: Record<string, string> = {}): Promise<NestExpressApplication> {
  const env = testEnv(overrides);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    rawBody: true,
  });
  configureApp(app, env);
  await app.init();
  return app;
}

describe('Canales: firma HMAC de entrada (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let channelId: string;
  let apiKey: string;
  let secret: string;
  const http = () => request(app.getHttpServer());

  const inboundBody = () =>
    JSON.stringify({
      externalMessageId: randomUUID(),
      from: { externalId: phone(), displayName: 'Cliente firmado' },
      text: 'Hola',
      sentAt: new Date().toISOString(),
    });

  /** POST de un cuerpo crudo, con la firma indicada (o sin ella). */
  const postInbound = (raw: string, signature?: string, key = apiKey) => {
    const req = http()
      .post('/api/v1/integrations/messages/inbound')
      .set('Authorization', `Bearer ${key}`)
      .set('Content-Type', 'application/json');
    if (signature) req.set('X-OmniDesk-Signature', signature);
    return req.send(raw);
  };

  /** Emite API key + secreto nuevos por el repositorio (como lo hará la API de canales). */
  async function rotate(): Promise<{ apiKey: string; secret: string }> {
    const repo = app.get<ChannelRepository>(CHANNEL_REPOSITORY);
    const cipher = app.get<ChannelSecretCipher>(CHANNEL_SECRET_CIPHER);
    const issued = {
      apiKey: `odk_${randomBytes(24).toString('base64url')}`,
      secret: randomBytes(32).toString('hex'),
    };
    const now = new Date();
    await repo.rotateCredentials(tenantId, channelId, {
      keyHash: sha256Hex(issued.apiKey),
      hmacSecretEnc: cipher.encrypt(issued.secret),
      now,
      previousValidUntil: new Date(now.getTime() + CREDENTIALS_GRACE_MS),
    });
    return issued;
  }

  let tenantId: string;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    const tenant = await prisma.tenant.create({
      data: { slug: `firma-${randomUUID().slice(0, 8)}`, name: 'Firma e2e' },
    });
    tenantId = tenant.id;
    const channel = await prisma.channel.create({
      data: {
        tenantId,
        name: 'WhatsApp firmado',
        type: 'WHATSAPP',
        provider: 'N8N',
        externalId: `pnid-${randomUUID().slice(0, 8)}`,
        phoneNumber: phone(),
        webhookUrl: 'https://n8n.example.com/webhook/x',
      },
    });
    channelId = channel.id;
    ({ apiKey, secret } = await rotate());
  });

  afterAll(async () => {
    await app.close();
  });

  it('sin firma, en un canal con secreto, responde 401 INVALID_SIGNATURE', async () => {
    const res = await postInbound(inboundBody()).expect(401);
    expect(res.body.code).toBe('INVALID_SIGNATURE');
  });

  it('con una firma de hace 6 min responde 401', async () => {
    const raw = inboundBody();
    await postInbound(raw, signPayload(secret, raw, nowSec() - 360)).expect(401);
  });

  it('con la firma correcta responde 201', async () => {
    const raw = inboundBody();
    await postInbound(raw, signPayload(secret, raw, nowSec())).expect(201);
  });

  it('verifica los bytes recibidos: espacios y orden de claves propios del emisor', async () => {
    const body = JSON.parse(inboundBody()) as Record<string, unknown>;
    const raw = `{ "text": "Hola",  "sentAt": "${String(body.sentAt)}", "from": ${JSON.stringify(body.from)}, "externalMessageId": "${String(body.externalMessageId)}" }`;
    await postInbound(raw, signPayload(secret, raw, nowSec())).expect(201);
  });

  it('alterar un byte del cuerpo después de firmarlo da 401', async () => {
    const raw = inboundBody();
    const signature = signPayload(secret, raw, nowSec());
    await postInbound(raw.replace('Hola', 'Holb'), signature).expect(401);
  });

  it('una firma con otro secreto da 401', async () => {
    const raw = inboundBody();
    await postInbound(raw, signPayload('otro-secreto', raw, nowSec())).expect(401);
  });

  it('también se exige en outbound y status', async () => {
    const outbound = JSON.stringify({ conversationId: randomUUID(), controlVersion: 0, text: 'x' });
    const res = await http()
      .post('/api/v1/integrations/messages/outbound')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('Content-Type', 'application/json')
      .send(outbound)
      .expect(401);
    expect(res.body.code).toBe('INVALID_SIGNATURE');
    await http()
      .post('/api/v1/integrations/messages/status')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('Content-Type', 'application/json')
      .send('{}')
      .expect(401);
  });

  it('durante una rotación acepta la key y el secreto anteriores; vencidos, 401', async () => {
    const old = { apiKey, secret };
    const fresh = await rotate();

    let raw = inboundBody();
    await postInbound(raw, signPayload(old.secret, raw, nowSec()), old.apiKey).expect(201);
    raw = inboundBody();
    await postInbound(raw, signPayload(fresh.secret, raw, nowSec()), fresh.apiKey).expect(201);
    // Firma del anterior con la key nueva: también vale (el secreto anterior sigue vigente).
    raw = inboundBody();
    await postInbound(raw, signPayload(old.secret, raw, nowSec()), fresh.apiKey).expect(201);

    // Pasadas las 24 h (se adelanta el vencimiento en la base).
    const past = new Date(Date.now() - 1000);
    await prisma.integrationCredential.updateMany({
      where: { channelId, keyHash: sha256Hex(old.apiKey) },
      data: { expiresAt: past },
    });
    await prisma.channel.update({ where: { id: channelId }, data: { hmacSecretPrevUntil: past } });

    raw = inboundBody();
    await postInbound(raw, signPayload(old.secret, raw, nowSec()), old.apiKey).expect(401);
    raw = inboundBody();
    const res = await postInbound(raw, signPayload(old.secret, raw, nowSec()), fresh.apiKey).expect(
      401,
    );
    expect(res.body.code).toBe('INVALID_SIGNATURE');
    apiKey = fresh.apiKey;
    secret = fresh.secret;
  });

  it('el canal demo SIMULATED (sin secreto) sigue aceptando peticiones sin firma', async () => {
    await postInbound(inboundBody(), undefined, E2E_DEMO_KEY).expect(201);
  });
});

interface Received {
  headers: IncomingMessage['headers'];
  body: string;
}

describe('Canales: API de gestión y envío por n8n (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let server: Server;
  let webhookUrl: string;
  let received: Received[];
  let reply: (res: ServerResponse, body: string) => void;
  let tenantId: string;
  let ownerCookie: string;
  let ownerMemberId: string;
  let agentCookie: string;
  const http = () => request(app.getHttpServer());

  const as = (cookie: string) => ({
    get: (path: string) => http().get(path).set('Cookie', cookie),
    post: (path: string, body?: object) =>
      http().post(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN).send(body),
    patch: (path: string, body: object) =>
      http().patch(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN).send(body),
  });

  const newChannel = (overrides: object = {}) => ({
    name: 'WhatsApp Ventas',
    phoneNumber: phone(),
    externalId: `pnid-${randomUUID().slice(0, 12)}`,
    provider: 'N8N',
    webhookUrl,
    ...overrides,
  });

  async function memberWithSession(role: 'OWNER' | 'ADMIN' | 'AGENT') {
    const user = await prisma.user.create({
      data: {
        email: `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@e2e.local`,
        displayName: role,
      },
    });
    const member = await prisma.tenantMember.create({
      data: { tenantId, displayName: role, email: user.email, role, userId: user.id },
    });
    return { memberId: member.id, cookie: await sessionFor(app, user.id, tenantId) };
  }

  /** Canal N8N con credenciales emitidas por la API. */
  async function channelWithCredentials(overrides: object = {}) {
    const channel = ChannelSchema.parse(
      (await as(ownerCookie).post('/api/v1/channels', newChannel(overrides)).expect(201)).body,
    );
    const credentials = ChannelCredentialsResponseSchema.parse(
      (await as(ownerCookie).post(`/api/v1/channels/${channel.id}/credentials`).expect(201)).body,
    );
    return { channel, ...credentials };
  }

  const signedPost = (path: string, body: object, apiKey: string, secret: string) => {
    const raw = JSON.stringify(body);
    return http()
      .post(path)
      .set('Authorization', `Bearer ${apiKey}`)
      .set('Content-Type', 'application/json')
      .set('X-OmniDesk-Signature', signPayload(secret, raw, nowSec()))
      .send(raw);
  };

  /** Conversación nueva por un inbound firmado, asignada al OWNER. */
  async function ownedConversation(apiKey: string, secret: string): Promise<string> {
    const res = await signedPost(
      '/api/v1/integrations/messages/inbound',
      {
        externalMessageId: randomUUID(),
        from: { externalId: phone(), displayName: 'Cliente n8n' },
        text: 'Hola',
        sentAt: new Date().toISOString(),
      },
      apiKey,
      secret,
    ).expect(201);
    const { conversationId, controlVersion } = res.body as {
      conversationId: string;
      controlVersion: number;
    };
    await as(ownerCookie)
      .post(`/api/v1/conversations/${conversationId}/assign`, {
        memberId: ownerMemberId,
        controlVersion,
      })
      .expect(200);
    return conversationId;
  }

  const sendAgentMessage = async (conversationId: string) =>
    (
      await as(ownerCookie)
        .post(`/api/v1/conversations/${conversationId}/messages`, {
          text: 'Hola desde la PWA',
          clientMessageId: randomUUID(),
        })
        .expect(201)
    ).body as Message;

  const messageRow = (id: string) => prisma.message.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        reply(res, body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    webhookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook/omnidesk`;

    // El webhook falso escucha en 127.0.0.1: se permite como en el VPS se permite "n8n".
    app = await createApp({ N8N_WEBHOOK_ALLOWED_HOSTS: '127.0.0.1,n8n' });
    prisma = app.get(PrismaService);
    tenantId = (
      await prisma.tenant.create({
        data: { slug: `canales-${randomUUID().slice(0, 8)}`, name: 'Canales e2e' },
      })
    ).id;
    ({ memberId: ownerMemberId, cookie: ownerCookie } = await memberWithSession('OWNER'));
    ({ cookie: agentCookie } = await memberWithSession('AGENT'));
  });

  beforeEach(() => {
    received = [];
    reply = (res, body) => {
      const { messageId } = JSON.parse(body || '{}') as { messageId?: string };
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ providerMessageId: `wamid.${messageId ?? 'ping'}` }));
    };
  });

  afterAll(async () => {
    await app.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  describe('gestión', () => {
    it('un AGENT recibe 403 en GET y POST /channels', async () => {
      await as(agentCookie).get('/api/v1/channels').expect(403);
      await as(agentCookie).post('/api/v1/channels', newChannel()).expect(403);
    });

    it('el OWNER crea un canal N8N: aparece en la lista sin credenciales', async () => {
      const body = newChannel();
      const created = ChannelSchema.parse(
        (await as(ownerCookie).post('/api/v1/channels', body).expect(201)).body,
      );
      expect(created).toMatchObject({
        name: body.name,
        provider: 'N8N',
        phoneNumber: body.phoneNumber,
        externalId: body.externalId,
        webhookUrl,
        hasCredentials: false,
        credentialsRotatedAt: null,
      });

      const list = ListChannelsResponseSchema.parse(
        (await as(ownerCookie).get('/api/v1/channels').expect(200)).body,
      );
      expect(list.items.map((c) => c.id)).toContain(created.id);
    });

    it('un externalId repetido en la empresa responde 409', async () => {
      const body = newChannel();
      await as(ownerCookie).post('/api/v1/channels', body).expect(201);
      const res = await as(ownerCookie).post('/api/v1/channels', body).expect(409);
      expect(res.body.code).toBe('CHANNEL_EXTERNAL_ID_TAKEN');
    });

    it('valida webhookUrl: IP privada 400, host permitido por http sí', async () => {
      const res = await as(ownerCookie)
        .post('/api/v1/channels', newChannel({ webhookUrl: 'http://10.0.0.5/hook' }))
        .expect(400);
      expect(res.body.code).toBe('INVALID_WEBHOOK_URL');
      await as(ownerCookie)
        .post('/api/v1/channels', newChannel({ webhookUrl: 'http://n8n:5678/webhook/x' }))
        .expect(201);
    });

    it('PATCH cambia nombre y webhookUrl, y valida la URL', async () => {
      const { channel } = await channelWithCredentials();
      const res = await as(ownerCookie)
        .patch(`/api/v1/channels/${channel.id}`, {
          name: 'Renombrado',
          webhookUrl: 'https://n8n.example.com/webhook/y',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'Renombrado',
        webhookUrl: 'https://n8n.example.com/webhook/y',
      });
      await as(ownerCookie)
        .patch(`/api/v1/channels/${channel.id}`, { webhookUrl: 'http://192.168.1.2/x' })
        .expect(400);
      await as(ownerCookie).patch(`/api/v1/channels/${randomUUID()}`, { name: 'x' }).expect(404);
      await as(agentCookie).patch(`/api/v1/channels/${channel.id}`, { name: 'x' }).expect(403);
    });

    it('las credenciales se devuelven una vez; en la base, sha256 y secreto cifrado', async () => {
      const { channel, apiKey, hmacSecret, previousValidUntil } = await channelWithCredentials();
      expect(previousValidUntil).toBeNull();

      const credential = await prisma.integrationCredential.findFirstOrThrow({
        where: { channelId: channel.id },
      });
      expect(credential.keyHash).toBe(sha256Hex(apiKey));
      const row = await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } });
      expect(row.hmacSecretEnc).not.toBeNull();
      expect(Buffer.from(row.hmacSecretEnc!).includes(Buffer.from(hmacSecret))).toBe(false);

      const list = await as(ownerCookie).get('/api/v1/channels').expect(200);
      const raw = JSON.stringify(list.body);
      expect(raw).not.toContain(apiKey);
      expect(raw).not.toContain(hmacSecret);
      expect(list.body.items.find((c: { id: string }) => c.id === channel.id)).toMatchObject({
        hasCredentials: true,
      });
    });

    it('rotar mantiene válidas 24 h la key y el secreto anteriores', async () => {
      const first = await channelWithCredentials();
      const rotated = ChannelCredentialsResponseSchema.parse(
        (await as(ownerCookie).post(`/api/v1/channels/${first.channel.id}/credentials`).expect(201))
          .body,
      );
      const until = new Date(rotated.previousValidUntil!).getTime();
      expect(Math.abs(until - (Date.now() + CREDENTIALS_GRACE_MS))).toBeLessThan(60_000);

      for (const [key, secret] of [
        [first.apiKey, first.hmacSecret],
        [rotated.apiKey, rotated.hmacSecret],
      ] as const) {
        await signedPost(
          '/api/v1/integrations/messages/inbound',
          {
            externalMessageId: randomUUID(),
            from: { externalId: phone() },
            text: 'Hola',
            sentAt: new Date().toISOString(),
          },
          key,
          secret,
        ).expect(201);
      }
    });

    it('probar conexión: ping firmado; con el webhook caído, el error', async () => {
      const { channel, hmacSecret } = await channelWithCredentials();
      const ok = await as(ownerCookie).post(`/api/v1/channels/${channel.id}/test`).expect(200);
      expect(ok.body).toMatchObject({ ok: true, httpStatus: 200, error: null });
      expect(ok.body.latencyMs).toBeGreaterThanOrEqual(0);
      const [ping] = received as [Received];
      expect(JSON.parse(ping.body)).toMatchObject({ type: 'ping', channelId: channel.id });
      expect(
        verifySignature(
          ping.headers['x-omnidesk-signature'] as string,
          ping.body,
          [hmacSecret],
          nowSec(),
        ),
      ).toBe('ok');

      await as(ownerCookie)
        .patch(`/api/v1/channels/${channel.id}`, { webhookUrl: 'http://127.0.0.1:1/caido' })
        .expect(200);
      const down = await as(ownerCookie).post(`/api/v1/channels/${channel.id}/test`).expect(200);
      expect(down.body).toMatchObject({ ok: false, httpStatus: null });
      expect(down.body.error).toBeTruthy();
    });
  });

  describe('envío por n8n', () => {
    it('un mensaje de agente se envía firmado con Idempotency-Key y queda SENT', async () => {
      const { channel, apiKey, hmacSecret } = await channelWithCredentials();
      const conversationId = await ownedConversation(apiKey, hmacSecret);
      const message = await sendAgentMessage(conversationId);

      const sent = await eventually(async () => {
        const row = await messageRow(message.id);
        return row.status === 'SENT' ? row : null;
      }, 5_000);
      expect(sent.externalId).toBe(`wamid.${message.id}`);

      const call = received.find((r) => r.body.includes(message.id))!;
      expect(call.headers['idempotency-key']).toBe(message.id);
      expect(
        verifySignature(
          call.headers['x-omnidesk-signature'] as string,
          call.body,
          [hmacSecret],
          nowSec(),
        ),
      ).toBe('ok');
      expect(JSON.parse(call.body)).toMatchObject({
        type: 'message.send',
        messageId: message.id,
        conversationId,
        channel: { id: channel.id, externalId: channel.externalId },
        text: 'Hola desde la PWA',
      });

      // n8n reporta DELIVERED firmado.
      await signedPost(
        '/api/v1/integrations/messages/status',
        {
          messageId: message.id,
          providerMessageId: `wamid.${message.id}`,
          status: 'DELIVERED',
          occurredAt: new Date().toISOString(),
        },
        apiKey,
        hmacSecret,
      ).expect(200);
      expect((await messageRow(message.id)).status).toBe('DELIVERED');
    });

    it('un canal N8N sin secreto deja el mensaje FAILED (CHANNEL_NOT_CONFIGURED) sin llamar al webhook', async () => {
      const { channel, apiKey, hmacSecret } = await channelWithCredentials();
      const conversationId = await ownedConversation(apiKey, hmacSecret);
      await prisma.channel.update({ where: { id: channel.id }, data: { hmacSecretEnc: null } });
      received = [];

      const message = await sendAgentMessage(conversationId);
      const failed = await eventually(async () => {
        const row = await messageRow(message.id);
        return row.status === 'FAILED' ? row : null;
      }, 5_000);

      expect(failed.failureReason).toBe('CHANNEL_NOT_CONFIGURED');
      expect(received).toHaveLength(0);
    });

    it('si el webhook responde 500 cinco veces queda FAILED; Reintentar vuelve a llamar al webhook', async () => {
      const { apiKey, hmacSecret } = await channelWithCredentials();
      const conversationId = await ownedConversation(apiKey, hmacSecret);
      reply = (res) => res.writeHead(500).end('n8n caído');

      const message = await sendAgentMessage(conversationId);
      const failed = await eventually(async () => {
        const row = await messageRow(message.id);
        return row.status === 'FAILED' ? row : null;
      }, 45_000);
      expect(failed.failureReason).toContain('HTTP 500');
      // Intento inicial + 5 reintentos.
      expect(received.filter((r) => r.body.includes(message.id))).toHaveLength(6);

      reply = (res, body) =>
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ providerMessageId: `wamid.${JSON.parse(body).messageId}` }));
      await as(ownerCookie)
        .post(`/api/v1/conversations/${conversationId}/messages/${message.id}/retry`)
        .expect(200);
      await eventually(
        async () => ((await messageRow(message.id)).status === 'SENT' ? true : null),
        5_000,
      );
      expect(received.filter((r) => r.body.includes(message.id))).toHaveLength(7);
    }, 70_000);
  });
});
