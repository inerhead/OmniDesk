import 'reflect-metadata';
import { createHmac, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { OutboxDispatcher } from '../src/modules/realtime/infrastructure/outbox-dispatcher';
import { AiReplyWorker } from '../src/modules/whatsapp/ai-reply-worker';
import { DispatchOutboundMessageUseCase } from '../src/modules/messaging/application/dispatch-outbound-message.use-case';
import { sessionFor, WEB_ORIGIN } from './support/session';
import { testEnv } from './support/test-env';

const appSecret = 'meta-app-secret-for-e2e';
const verifyToken = 'meta-verify-token-for-e2e-123456';
describe('WhatsApp directo e IA opcional (e2e)', () => {
  let app: NestExpressApplication;
  let db: PrismaService;
  let cookie: string;
  let tenantId: string;
  let channelId: string;
  let externalId: string;
  const http = () => request(app.getHttpServer());
  const manage = (path: string) =>
    http().patch(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN);
  const envelope = (text = 'Hola') => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: externalId },
              contacts: [{ wa_id: '573001234567', profile: { name: 'Ana' } }],
              messages: [
                {
                  id: `wamid.${randomUUID()}`,
                  from: '573001234567',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const post = (body: unknown) => {
    const raw = JSON.stringify(body);
    return http()
      .post(`/api/v1/integrations/whatsapp/${channelId}`)
      .set('Content-Type', 'application/json')
      .set(
        'X-Hub-Signature-256',
        `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}`,
      )
      .send(raw);
  };
  const enableAi = async () => {
    await manage(`/api/v1/channels/${channelId}`)
      .send({ webhookUrl: 'https://n8n.example.com/webhook/ai' })
      .expect(200);
    const client = await http()
      .post(`/api/v1/channels/${channelId}/n8n-client`)
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .expect(201);
    await manage(`/api/v1/channels/${channelId}/whatsapp`).send({ aiEnabled: true }).expect(200);
    return client.body.clientSecret as string;
  };
  const aiEvent = () =>
    db.outboxEvent.findFirstOrThrow({ where: { tenantId, type: 'ai.reply_requested' } });
  beforeAll(async () => {
    const env = testEnv();
    const module = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = module.createNestApplication<NestExpressApplication>({ rawBody: true, bufferLogs: true });
    configureApp(app, env);
    await app.init();
    await app.get(OutboxDispatcher).onModuleDestroy();
    db = app.get(PrismaService);
  });
  beforeEach(async () => {
    const tenant = await db.tenant.create({
      data: { approval: 'APPROVED', name: 'WhatsApp test', slug: `wa-${randomUUID()}` },
    });
    tenantId = tenant.id;
    const user = await db.user.create({
      data: { email: `${randomUUID()}@test.local`, displayName: 'Owner' },
    });
    await db.tenantMember.create({
      data: { tenantId, userId: user.id, email: user.email, displayName: 'Owner', role: 'OWNER' },
    });
    cookie = await sessionFor(app, user.id, tenantId);
    externalId = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
    const created = await http()
      .post('/api/v1/channels')
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .send({
        name: 'Ventas',
        phoneNumber: '+573009999999',
        externalId,
        provider: 'WHATSAPP_CLOUD',
      })
      .expect(201);
    channelId = created.body.id;
    await manage(`/api/v1/channels/${channelId}/whatsapp`)
      .send({ accessToken: 'meta-access-token', appSecret, verifyToken })
      .expect(200);
  });
  afterEach(async () => {
    // Otros archivos arrancan su dispatcher sobre la misma base: no dejar envíos de prueba vivos.
    await db.outboxEvent.updateMany({
      where: { tenantId, publishedAt: null },
      data: { publishedAt: new Date() },
    });
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('expone callback con subruta, cifra secretos y no los devuelve', async () => {
    const res = await http().get('/api/v1/channels').set('Cookie', cookie).expect(200);
    expect(res.body.items[0]).toMatchObject({
      aiEnabled: false,
      hasWhatsAppCredentials: true,
      whatsappWebhookUrl: `http://localhost:8080/omnidesk/api/v1/integrations/whatsapp/${channelId}`,
    });
    expect(JSON.stringify(res.body)).not.toContain(appSecret);
    expect(JSON.stringify(res.body)).not.toContain('meta-access-token');
    const row = await db.channel.findUniqueOrThrow({ where: { id: channelId } });
    expect(Buffer.from(row.whatsappAppSecretEnc!).toString()).not.toContain(appSecret);
    expect(row.whatsappVerifyTokenHash).not.toBe(verifyToken);
  });
  it('valida el handshake y acepta el mensaje sin firma de Meta', async () => {
    const url = `/api/v1/integrations/whatsapp/${channelId}`;
    const res = await http()
      .get(url)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': verifyToken, 'hub.challenge': '12345' })
      .expect(200);
    expect(res.text).toBe('12345');
    await http()
      .get(url)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '12345' })
      .expect(403);
    await http().post(url).send(envelope()).expect(200);
  });
  it('sin IA guarda una sola vez, aparece sin IA activa y no encola n8n', async () => {
    const body = envelope();
    await post(body).expect(200);
    await post(body).expect(200);
    expect(await db.message.count({ where: { tenantId, senderType: 'CUSTOMER' } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { tenantId, type: 'ai.reply_requested' } })).toBe(0);
    const res = await http()
      .get('/api/v1/conversations?inbox=ai')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.items[0].aiActive).toBe(false);
  });
  it('aísla phone_number_id y empresa; AGENT no gestiona canales', async () => {
    const body = envelope();
    body.entry[0]!.changes[0]!.value.metadata.phone_number_id = 'otro';
    await post(body).expect(200);
    expect(await db.message.count({ where: { tenantId } })).toBe(0);
    const user = await db.user.create({
      data: { email: `${randomUUID()}@test.local`, displayName: 'Agente' },
    });
    await db.tenantMember.create({
      data: { tenantId, userId: user.id, email: user.email, displayName: 'Agente', role: 'AGENT' },
    });
    const agent = await sessionFor(app, user.id, tenantId);
    await http().get('/api/v1/channels').set('Cookie', agent).expect(403);
    await http()
      .patch(`/api/v1/channels/${channelId}/whatsapp`)
      .set('Cookie', agent)
      .set('Origin', WEB_ORIGIN)
      .send({ aiEnabled: true })
      .expect(403);
    const foreign = await db.tenant.create({
      data: { approval: 'APPROVED', name: 'Otra', slug: randomUUID() },
    });
    const foreignChannel = await db.channel.create({
      data: {
        tenantId: foreign.id,
        name: 'Otro',
        type: 'WHATSAPP',
        provider: 'WHATSAPP_CLOUD',
        externalId: randomUUID(),
      },
    });
    await manage(`/api/v1/channels/${foreignChannel.id}/whatsapp`)
      .send({ aiEnabled: false })
      .expect(404);
  });
  it('exige URL y secreto de cliente para activar la IA', async () => {
    await manage(`/api/v1/channels/${channelId}/whatsapp`).send({ aiEnabled: true }).expect(400);
  });
  it('envía inbound a n8n con credenciales de cliente, registra la respuesta completa y la envía por Graph', async () => {
    const clientSecret = await enableAi();
    const body = envelope();
    await post(body).expect(200);
    await post(body).expect(200);
    expect(await db.outboxEvent.count({ where: { tenantId, type: 'ai.reply_requested' } })).toBe(1);
    const event = await aiEvent();
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const payload = JSON.parse(init.body as string) as Record<string, unknown>;
      calls.push({ url, body: payload });
      if (url.includes('n8n')) {
        const headers = init.headers as Record<string, string>;
        expect(headers['X-Client-Id']).toBe(channelId);
        expect(headers['X-Client-Secret']).toBe(clientSecret);
        expect(headers['X-OmniDesk-Signature']).toBeUndefined();
        expect(headers['Idempotency-Key']).toBe(payload.messageId);
        return Response.json({ text: 'Hola Ana. Esta es la respuesta completa.' });
      }
      expect((init.headers as Record<string, string>).authorization).toBe(
        'Bearer meta-access-token',
      );
      return Response.json({ messages: [{ id: 'wamid.ai-response' }] });
    });
    await app.get(AiReplyWorker).process(tenantId, event.payload);
    await app.get(AiReplyWorker).process(tenantId, event.payload);
    const reply = await db.message.findFirstOrThrow({ where: { tenantId, senderType: 'AI' } });
    expect(reply.text).toBe('Hola Ana. Esta es la respuesta completa.');
    expect(await db.message.count({ where: { tenantId, senderType: 'AI' } })).toBe(1);
    await app.get(DispatchOutboundMessageUseCase).send(tenantId, { messageId: reply.id });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toContain('https://graph.facebook.com/');
    expect(calls[1]!.body).toMatchObject({
      messaging_product: 'whatsapp',
      text: { body: reply.text },
      biz_opaque_callback_data: reply.id,
    });
    await post({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: externalId },
                statuses: [
                  {
                    id: 'wamid.ai-response',
                    status: 'delivered',
                    timestamp: '1791800001',
                    biz_opaque_callback_data: reply.id,
                  },
                ],
              },
            },
          ],
        },
      ],
    }).expect(200);
    expect((await db.message.findUniqueOrThrow({ where: { id: reply.id } })).status).toBe(
      'DELIVERED',
    );
  });
  it.each(['disabled', 'assigned', 'closed'] as const)(
    'descarta la respuesta tardía si cambia el control: %s',
    async (mode) => {
      await enableAi();
      await post(envelope()).expect(200);
      const event = await aiEvent();
      vi.stubGlobal('fetch', async () => {
        if (mode === 'disabled')
          await manage(`/api/v1/channels/${channelId}/whatsapp`)
            .send({ aiEnabled: false })
            .expect(200);
        else {
          const member = await db.tenantMember.findFirstOrThrow({ where: { tenantId } });
          await db.conversation.updateMany({
            where: { tenantId },
            data: {
              ...(mode === 'closed' ? { status: 'CLOSED' } : { assignedAgentId: member.id }),
              controlVersion: { increment: 1 },
            },
          });
        }
        return Response.json({ text: 'No se debe publicar' });
      });
      await app.get(AiReplyWorker).process(tenantId, event.payload);
      expect(await db.message.count({ where: { tenantId, senderType: 'AI' } })).toBe(0);
    },
  );
  it('un fallo de IA conserva inbound y programa un reintento durable', async () => {
    await enableAi();
    await post(envelope()).expect(200);
    vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
    await app.get(OutboxDispatcher).tick();
    const event = await aiEvent();
    expect(event.attempts).toBe(1);
    expect(event.publishedAt).toBeNull();
    expect(await db.message.count({ where: { tenantId, senderType: 'CUSTOMER' } })).toBe(1);
    expect(await db.message.count({ where: { tenantId, senderType: 'AI' } })).toBe(0);
  });
  it('dos entregas concurrentes del mismo inbound crean un solo mensaje y trabajo IA', async () => {
    await enableAi();
    const body = envelope();
    await Promise.all([post(body).expect(200), post(body).expect(200)]);
    expect(await db.message.count({ where: { tenantId, senderType: 'CUSTOMER' } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { tenantId, type: 'ai.reply_requested' } })).toBe(1);
  });
  it.each(['invalid', 'timeout'] as const)('no crea respuesta si n8n falla: %s', async (mode) => {
    await enableAi();
    await post(envelope()).expect(200);
    const event = await aiEvent();
    vi.stubGlobal('fetch', async () => {
      if (mode === 'timeout') throw new DOMException('Timeout', 'TimeoutError');
      return Response.json({ text: '' });
    });
    await expect(app.get(AiReplyWorker).process(tenantId, event.payload)).rejects.toThrow();
    expect(await db.message.count({ where: { tenantId, senderType: 'AI' } })).toBe(0);
    expect(await db.message.count({ where: { tenantId, senderType: 'CUSTOMER' } })).toBe(1);
  });
  it('envía un mensaje humano por Graph sin configurar IA ni n8n', async () => {
    await post(envelope()).expect(200);
    const conversation = await db.conversation.findFirstOrThrow({ where: { tenantId } });
    const member = await db.tenantMember.findFirstOrThrow({ where: { tenantId } });
    await db.conversation.update({
      where: { id: conversation.id },
      data: { assignedAgentId: member.id },
    });
    const res = await http()
      .post(`/api/v1/conversations/${conversation.id}/messages`)
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .send({ text: 'Te atiende una persona', clientMessageId: randomUUID() })
      .expect(201);
    const message = await db.message.findFirstOrThrow({ where: { tenantId, senderType: 'AGENT' } });
    expect(res.body).toBeTruthy();
    vi.stubGlobal('fetch', async (url: string) => {
      expect(url).toContain('https://graph.facebook.com/');
      return Response.json({ messages: [{ id: 'wamid.human' }] });
    });
    await app.get(DispatchOutboundMessageUseCase).send(tenantId, { messageId: message.id });
    expect((await db.message.findUniqueOrThrow({ where: { id: message.id } })).status).toBe('SENT');
  });
  it('una IA que tarda más de 5 s se procesa sin vencer la transacción de Outbox', async () => {
    await enableAi();
    await post(envelope()).expect(200);
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('n8n')) {
        await new Promise((resolve) => setTimeout(resolve, 5200));
        return Response.json({ text: 'Respuesta lenta válida' });
      }
      return Response.json({ messages: [{ id: `wamid.${randomUUID()}` }] });
    });
    // Evita trabajos pendientes de otros casos de este archivo.
    await db.outboxEvent.updateMany({
      where: { tenantId: { not: tenantId }, publishedAt: null },
      data: { publishedAt: new Date() },
    });
    await app.get(OutboxDispatcher).tick();
    expect((await aiEvent()).publishedAt).not.toBeNull();
    expect(await db.message.count({ where: { tenantId, senderType: 'AI' } })).toBe(1);
  });
  it('un estado huérfano no impide recibir el resto del lote', async () => {
    const body = envelope();
    const mixed = {
      ...body,
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: externalId },
                statuses: [
                  { id: 'wamid.external-send', status: 'delivered', timestamp: '1791800000' },
                ],
              },
            },
          ],
        },
        ...body.entry,
      ],
    };
    await post(mixed).expect(200);
    expect(await db.message.count({ where: { tenantId, senderType: 'CUSTOMER' } })).toBe(1);
  });
  it('conserva inbound aunque un estado correlacionado requiera reintento', async () => {
    const body = envelope();
    const mixed = {
      ...body,
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: externalId },
                statuses: [
                  {
                    id: 'wamid.pending-send',
                    biz_opaque_callback_data: randomUUID(),
                    status: 'delivered',
                    timestamp: '1791800000',
                  },
                ],
              },
            },
          ],
        },
        ...body.entry,
      ],
    };
    await post(mixed).expect(503);
    expect(await db.message.count({ where: { tenantId, senderType: 'CUSTOMER' } })).toBe(1);
  });
});
