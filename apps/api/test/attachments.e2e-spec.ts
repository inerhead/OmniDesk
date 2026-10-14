import 'reflect-metadata';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OutboxDispatcher } from '../src/modules/realtime/infrastructure/outbox-dispatcher';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { sessionFor, WEB_ORIGIN } from './support/session';
import { testEnv } from './support/test-env';

const appSecret = 'meta-app-secret-for-e2e';
const verifyToken = 'meta-verify-token-for-e2e-123456';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const sha256B64 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('base64');

describe('Adjuntos de WhatsApp (e2e)', () => {
  let app: NestExpressApplication;
  let db: PrismaService;
  let cookie: string;
  let tenantId: string;
  let channelId: string;
  let externalId: string;
  const http = () => request(app.getHttpServer());

  const envelope = (message: Record<string, unknown>, wamid = `wamid.${randomUUID()}`) => ({
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
                  id: wamid,
                  from: '573001234567',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  ...message,
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
  const imageMessage = (caption?: string) => ({
    type: 'image',
    image: {
      id: 'media-1',
      mime_type: 'image/jpeg',
      sha256: sha256B64(jpeg),
      ...(caption && { caption }),
    },
  });
  const enableAi = async () => {
    const manage = (path: string) =>
      http().patch(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN);
    await manage(`/api/v1/channels/${channelId}`)
      .send({ webhookUrl: 'https://n8n.example.com/webhook/ai' })
      .expect(200);
    await http()
      .post(`/api/v1/channels/${channelId}/credentials`)
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .send({})
      .expect(201);
    await manage(`/api/v1/channels/${channelId}/whatsapp`).send({ aiEnabled: true }).expect(200);
  };
  const countEvents = (type: string) => db.outboxEvent.count({ where: { tenantId, type } });

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
      data: { name: 'Adjuntos', slug: `att-${randomUUID()}` },
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
    channelId = (
      await http()
        .post('/api/v1/channels')
        .set('Cookie', cookie)
        .set('Origin', WEB_ORIGIN)
        .send({
          name: 'Ventas',
          phoneNumber: '+573009999999',
          externalId,
          provider: 'WHATSAPP_CLOUD',
        })
        .expect(201)
    ).body.id;
    await http()
      .patch(`/api/v1/channels/${channelId}/whatsapp`)
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .send({ accessToken: 'meta-access-token', appSecret, verifyToken })
      .expect(200);
  });
  afterEach(async () => {
    await db.outboxEvent.updateMany({
      where: { tenantId, publishedAt: null },
      data: { publishedAt: new Date() },
    });
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('registra la imagen PENDING con su pie, encola la descarga y no llama a la IA', async () => {
    await enableAi();
    await post(envelope(imageMessage('Mi factura'))).expect(200);

    const message = await db.message.findFirstOrThrow({
      where: { tenantId },
      include: { attachment: true },
    });
    expect(message.text).toBe('Mi factura');
    expect(message.attachment).toMatchObject({
      kind: 'IMAGE',
      status: 'PENDING',
      providerMediaId: 'media-1',
    });
    const conversation = await db.conversation.findFirstOrThrow({ where: { tenantId } });
    expect(conversation.lastMessagePreview).toBe('Foto · Mi factura');
    expect(await countEvents('attachment.download_requested')).toBe(1);
    expect(await countEvents('ai.reply_requested')).toBe(0);
  });

  it('no duplica el mensaje ni la descarga si Meta repite el webhook', async () => {
    const body = envelope(imageMessage(), 'wamid.repetido');
    await post(body).expect(200);
    await post(body).expect(200);

    expect(await db.message.count({ where: { tenantId } })).toBe(1);
    expect(await countEvents('attachment.download_requested')).toBe(1);
  });

  it('un tipo no soportado queda como texto, sin IA ni descarga; una reacción no crea mensajes', async () => {
    await enableAi();
    await post(envelope({ type: 'location', location: { latitude: 4.6, longitude: -74 } })).expect(
      200,
    );
    await post(
      envelope({ type: 'reaction', reaction: { message_id: 'wamid.x', emoji: '👍' } }),
    ).expect(200);

    const messages = await db.message.findMany({ where: { tenantId } });
    expect(messages.map((m) => m.text)).toEqual(['[Mensaje de WhatsApp no soportado: location]']);
    expect(await countEvents('ai.reply_requested')).toBe(0);
    expect(await countEvents('attachment.download_requested')).toBe(0);
  });
});
