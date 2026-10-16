import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ChannelSchema, ListChannelsResponseSchema, type Message } from '@omnidesk/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { MetricsRegistry } from '../src/modules/observability/infrastructure/metrics-registry';
import { signPayload } from '../src/shared/infrastructure/crypto/hmac-signature';
import { sha256Hex } from '../src/shared/infrastructure/crypto/sha256';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { issueLegacyCredentials } from './support/legacy-credentials';
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

  /** API key + secreto nuevos de un canal N8N existente (la API ya no los emite, SPEC 22). */
  async function rotate(): Promise<{ apiKey: string; secret: string }> {
    const issued = await issueLegacyCredentials(app, tenantId, channelId);
    return { apiKey: issued.apiKey, secret: issued.hmacSecret };
  }

  let tenantId: string;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    const tenant = await prisma.tenant.create({
      data: { approval: 'APPROVED', slug: `firma-${randomUUID().slice(0, 8)}`, name: 'Firma e2e' },
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

  it('las métricas cuentan la firma inválida, la credencial ausente y el ok (SPEC 11)', async () => {
    const counter = app
      .get(MetricsRegistry)
      .registry.getSingleMetric('omnidesk_integration_requests_total')!;
    const value = async (result: string) =>
      (await counter.get()).values.find(
        (sample) => sample.labels.endpoint === 'inbound' && sample.labels.result === result,
      )?.value ?? 0;
    const before = {
      invalid: await value('invalid_signature'),
      unauthorized: await value('unauthorized'),
      ok: await value('ok'),
    };

    await postInbound(inboundBody()).expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/integrations/messages/inbound')
      .send({})
      .expect(401);
    const raw = inboundBody();
    await postInbound(raw, signPayload(secret, raw, nowSec())).expect(201);

    expect(await value('invalid_signature')).toBe(before.invalid + 1);
    expect(await value('unauthorized')).toBe(before.unauthorized + 1);
    expect(await value('ok')).toBe(before.ok + 1);
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
    put: (path: string, body: object) =>
      http().put(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN).send(body),
    delete: (path: string) => http().delete(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN),
  });

  const CLIENT_SECRET = 'client-secret-0123456789';

  const newChannel = (overrides: object = {}) => ({
    name: 'WhatsApp Ventas',
    phoneNumber: phone(),
    externalId: `pnid-${randomUUID().slice(0, 12)}`,
    provider: 'WHATSAPP_CLOUD',
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

  /**
   * Canal N8N existente (ya no se crean por la API, SPEC 22): API key y HMAC de entrada en la base y
   * credenciales de cliente configuradas por la API.
   */
  async function channelWithCredentials() {
    const row = await prisma.channel.create({
      data: {
        tenantId,
        name: 'WhatsApp n8n',
        type: 'WHATSAPP',
        provider: 'N8N',
        externalId: `pnid-${randomUUID().slice(0, 12)}`,
        phoneNumber: phone(),
        webhookUrl,
      },
    });
    const legacy = await issueLegacyCredentials(app, tenantId, row.id);
    const clientId = `acme-${randomUUID().slice(0, 8)}`;
    const channel = ChannelSchema.parse(
      (
        await as(ownerCookie)
          .put(`/api/v1/channels/${row.id}/n8n-client`, { clientId, clientSecret: CLIENT_SECRET })
          .expect(200)
      ).body,
    );
    return { channel, clientId, ...legacy };
  }

  /** Cabeceras de cliente presentes y sin firma saliente (SPEC 22). */
  function expectClientHeaders(headers: IncomingMessage['headers'], clientId: string) {
    expect(headers['x-client-id']).toBe(clientId);
    expect(headers['x-client-secret']).toBe(CLIENT_SECRET);
    expect(headers['x-omnidesk-signature']).toBeUndefined();
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
        data: {
          approval: 'APPROVED',
          slug: `canales-${randomUUID().slice(0, 8)}`,
          name: 'Canales e2e',
        },
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

    it('el OWNER crea un canal WhatsApp Cloud: aparece en la lista sin credenciales de cliente', async () => {
      const body = newChannel();
      const created = ChannelSchema.parse(
        (await as(ownerCookie).post('/api/v1/channels', body).expect(201)).body,
      );
      expect(created).toMatchObject({
        name: body.name,
        provider: 'WHATSAPP_CLOUD',
        phoneNumber: body.phoneNumber,
        externalId: body.externalId,
        webhookUrl: null,
        n8nClientId: null,
        hasN8nClientSecret: false,
        aiEnabled: false,
      });
      expect(created).not.toHaveProperty('hasCredentials');

      const list = ListChannelsResponseSchema.parse(
        (await as(ownerCookie).get('/api/v1/channels').expect(200)).body,
      );
      expect(list.items.map((c) => c.id)).toContain(created.id);
    });

    it('ya no se crean canales N8N: 400', async () => {
      await as(ownerCookie)
        .post('/api/v1/channels', newChannel({ provider: 'N8N', webhookUrl }))
        .expect(400);
    });

    it('un externalId repetido en la empresa responde 409', async () => {
      const body = newChannel();
      await as(ownerCookie).post('/api/v1/channels', body).expect(201);
      const res = await as(ownerCookie).post('/api/v1/channels', body).expect(409);
      expect(res.body.code).toBe('CHANNEL_EXTERNAL_ID_TAKEN');
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
      const invalid = await as(ownerCookie)
        .patch(`/api/v1/channels/${channel.id}`, { webhookUrl: 'http://192.168.1.2/x' })
        .expect(400);
      expect(invalid.body.code).toBe('INVALID_WEBHOOK_URL');
      // Host permitido por N8N_WEBHOOK_ALLOWED_HOSTS: vale por http.
      await as(ownerCookie)
        .patch(`/api/v1/channels/${channel.id}`, { webhookUrl: 'http://n8n:5678/webhook/x' })
        .expect(200);
      await as(ownerCookie).patch(`/api/v1/channels/${randomUUID()}`, { name: 'x' }).expect(404);
      await as(agentCookie).patch(`/api/v1/channels/${channel.id}`, { name: 'x' }).expect(403);
    });

    it('POST /channels/:id/credentials ya no existe: 404', async () => {
      const { channel } = await channelWithCredentials();
      await as(ownerCookie).post(`/api/v1/channels/${channel.id}/credentials`).expect(404);
    });
  });

  describe('credenciales de cliente de n8n (SPEC 22)', () => {
    const cloudChannel = async () =>
      ChannelSchema.parse(
        (await as(ownerCookie).post('/api/v1/channels', newChannel()).expect(201)).body,
      );
    const putClient = (cookie: string, id: string, body: object) =>
      as(cookie).put(`/api/v1/channels/${id}/n8n-client`, body);

    it('el OWNER las guarda; el secreto no sale de la API y se guarda cifrado', async () => {
      const channel = await cloudChannel();
      const res = await putClient(ownerCookie, channel.id, {
        clientId: 'acme',
        clientSecret: '0123456789abcdef',
      }).expect(200);
      expect(res.body).toMatchObject({ n8nClientId: 'acme', hasN8nClientSecret: true });

      const list = await as(ownerCookie).get('/api/v1/channels').expect(200);
      expect(JSON.stringify(list.body)).not.toContain('0123456789abcdef');
      const row = await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } });
      expect(row.n8nClientSecretEnc).not.toBeNull();
      expect(Buffer.from(row.n8nClientSecretEnc!).includes(Buffer.from('0123456789abcdef'))).toBe(
        false,
      );
    });

    it('un AGENT recibe 403; un canal de otra empresa, 404', async () => {
      const channel = await cloudChannel();
      const body = { clientId: 'acme', clientSecret: '0123456789abcdef' };
      await putClient(agentCookie, channel.id, body).expect(403);
      await as(agentCookie).delete(`/api/v1/channels/${channel.id}/n8n-client`).expect(403);
      await putClient(ownerCookie, randomUUID(), body).expect(404);
    });

    it('valida el formato y exige el secreto la primera vez', async () => {
      const channel = await cloudChannel();
      await putClient(ownerCookie, channel.id, {
        clientId: 'acme',
        clientSecret: 'x'.repeat(15),
      }).expect(400);
      await putClient(ownerCookie, channel.id, {
        clientId: 'x'.repeat(201),
        clientSecret: '0123456789abcdef',
      }).expect(400);
      const res = await putClient(ownerCookie, channel.id, { clientId: 'acme' }).expect(400);
      expect(res.body.code).toBe('N8N_CLIENT_SECRET_REQUIRED');
    });

    it('omitir el secreto cambia el id y conserva el secreto: el ping lleva el anterior', async () => {
      const { channel } = await channelWithCredentials();
      await putClient(ownerCookie, channel.id, { clientId: 'otro' }).expect(200);
      await as(ownerCookie).post(`/api/v1/channels/${channel.id}/test`).expect(200);
      const [ping] = received as [Received];
      expectClientHeaders(ping.headers, 'otro');
    });

    it('activar la IA exige webhook y credenciales; el HMAC ya no hace falta', async () => {
      const channel = await cloudChannel();
      await as(ownerCookie)
        .patch(`/api/v1/channels/${channel.id}`, { webhookUrl: 'https://n8n.example.com/w' })
        .expect(200);
      await as(ownerCookie)
        .patch(`/api/v1/channels/${channel.id}/whatsapp`, { aiEnabled: true })
        .expect(400);
      await putClient(ownerCookie, channel.id, {
        clientId: 'acme',
        clientSecret: '0123456789abcdef',
      }).expect(200);
      await as(ownerCookie)
        .patch(`/api/v1/channels/${channel.id}/whatsapp`, { aiEnabled: true })
        .expect(200);
      const row = await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } });
      expect(row).toMatchObject({ aiEnabled: true, hmacSecretEnc: null });
    });

    it('DELETE las quita y apaga la IA; repetirlo responde 200', async () => {
      const channel = await cloudChannel();
      await as(ownerCookie)
        .patch(`/api/v1/channels/${channel.id}`, { webhookUrl: 'https://n8n.example.com/w' })
        .expect(200);
      await putClient(ownerCookie, channel.id, {
        clientId: 'acme',
        clientSecret: '0123456789abcdef',
      }).expect(200);
      await as(ownerCookie)
        .patch(`/api/v1/channels/${channel.id}/whatsapp`, { aiEnabled: true })
        .expect(200);

      const res = await as(ownerCookie)
        .delete(`/api/v1/channels/${channel.id}/n8n-client`)
        .expect(200);
      expect(res.body).toMatchObject({
        n8nClientId: null,
        hasN8nClientSecret: false,
        aiEnabled: false,
      });
      await as(ownerCookie).delete(`/api/v1/channels/${channel.id}/n8n-client`).expect(200);
    });

    it('probar conexión: ping con credenciales de cliente y sin firma; con el webhook caído, el error', async () => {
      const { channel, clientId } = await channelWithCredentials();
      const ok = await as(ownerCookie).post(`/api/v1/channels/${channel.id}/test`).expect(200);
      expect(ok.body).toMatchObject({ ok: true, httpStatus: 200, error: null });
      expect(ok.body.latencyMs).toBeGreaterThanOrEqual(0);
      const [ping] = received as [Received];
      expect(JSON.parse(ping.body)).toMatchObject({ type: 'ping', channelId: channel.id });
      expectClientHeaders(ping.headers, clientId);

      await as(ownerCookie)
        .patch(`/api/v1/channels/${channel.id}`, { webhookUrl: 'http://127.0.0.1:1/caido' })
        .expect(200);
      const down = await as(ownerCookie).post(`/api/v1/channels/${channel.id}/test`).expect(200);
      expect(down.body).toMatchObject({ ok: false, httpStatus: null });
      expect(down.body.error).toBeTruthy();
    });

    it('probar conexión sin credenciales de cliente: error y ninguna petición', async () => {
      const { channel } = await channelWithCredentials();
      await as(ownerCookie).delete(`/api/v1/channels/${channel.id}/n8n-client`).expect(200);
      const res = await as(ownerCookie).post(`/api/v1/channels/${channel.id}/test`).expect(200);
      expect(res.body).toMatchObject({
        ok: false,
        httpStatus: null,
        error: 'El canal no tiene credenciales de cliente de n8n',
      });
      expect(received).toHaveLength(0);
    });
  });

  describe('envío por n8n', () => {
    it('un mensaje de agente se envía con credenciales de cliente e Idempotency-Key y queda SENT', async () => {
      const { channel, clientId, apiKey, hmacSecret } = await channelWithCredentials();
      const conversationId = await ownedConversation(apiKey, hmacSecret);
      const message = await sendAgentMessage(conversationId);

      const sent = await eventually(async () => {
        const row = await messageRow(message.id);
        return row.status === 'SENT' ? row : null;
      }, 5_000);
      expect(sent.externalId).toBe(`wamid.${message.id}`);

      const call = received.find((r) => r.body.includes(message.id))!;
      expect(call.headers['idempotency-key']).toBe(message.id);
      expectClientHeaders(call.headers, clientId);
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

    it('un canal N8N sin credenciales de cliente deja el mensaje FAILED (CHANNEL_NOT_CONFIGURED) sin llamar al webhook', async () => {
      const { channel, apiKey, hmacSecret } = await channelWithCredentials();
      const conversationId = await ownedConversation(apiKey, hmacSecret);
      await as(ownerCookie).delete(`/api/v1/channels/${channel.id}/n8n-client`).expect(200);
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
