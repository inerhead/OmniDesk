import 'reflect-metadata';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DispatchOutboundMessageUseCase } from '../src/modules/messaging/application/dispatch-outbound-message.use-case';
import { AttachmentDownloadWorker } from '../src/modules/whatsapp/attachment-download-worker';
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
  let ownerMemberId: string;
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
      .put(`/api/v1/channels/${channelId}/n8n-client`)
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .send({ clientId: 'acme-omnidesk', clientSecret: 'n8n-client-secret-for-e2e' })
      .expect(200);
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
      data: { approval: 'APPROVED', name: 'Adjuntos', slug: `att-${randomUUID()}` },
    });
    tenantId = tenant.id;
    const user = await db.user.create({
      data: { email: `${randomUUID()}@test.local`, displayName: 'Owner' },
    });
    ownerMemberId = (
      await db.tenantMember.create({
        data: { tenantId, userId: user.id, email: user.email, displayName: 'Owner', role: 'OWNER' },
      })
    ).id;
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

  const stubGraphDownload = (bytes: Buffer) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) =>
        String(url).includes('graph.facebook.com')
          ? Response.json({
              url: 'https://lookaside.fbsbx.com/x',
              mime_type: 'image/jpeg',
              sha256: sha256B64(bytes),
              file_size: bytes.length,
            })
          : new Response(new Uint8Array(bytes)),
      ),
    );
  const downloadPending = async () => {
    const event = await db.outboxEvent.findFirstOrThrow({
      where: { tenantId, type: 'attachment.download_requested' },
    });
    await app.get(AttachmentDownloadWorker).process(tenantId, event.payload);
  };

  it('descarga la imagen, la marca READY y la timeline la expone sin storageKey', async () => {
    await post(envelope(imageMessage())).expect(200);
    stubGraphDownload(jpeg);
    await downloadPending();

    const conversation = await db.conversation.findFirstOrThrow({ where: { tenantId } });
    const timeline = await http()
      .get(`/api/v1/conversations/${conversation.id}/timeline`)
      .set('Cookie', cookie)
      .expect(200);
    expect(timeline.body.items[0].attachment).toMatchObject({
      kind: 'IMAGE',
      status: 'READY',
      sizeBytes: jpeg.length,
    });
    expect(JSON.stringify(timeline.body)).not.toContain('storageKey');
  });

  const readyImage = async () => {
    await post(envelope(imageMessage())).expect(200);
    stubGraphDownload(jpeg);
    await downloadPending();
    vi.unstubAllGlobals();
    return db.messageAttachment.findFirstOrThrow({ where: { tenantId } });
  };
  const binary = (req: request.Test) =>
    req.buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });

  it('sirve el contenido con cabeceras seguras', async () => {
    const attachment = await readyImage();
    const res = await binary(
      http().get(`/api/v1/attachments/${attachment.id}/content`).set('Cookie', cookie),
    ).expect(200);

    expect(res.body).toEqual(jpeg);
    expect(res.headers).toMatchObject({
      'content-type': 'image/jpeg',
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
      'accept-ranges': 'bytes',
    });
  });

  it('responde 206 con Content-Range (Safari) y 416 fuera de rango', async () => {
    const attachment = await readyImage();
    const url = `/api/v1/attachments/${attachment.id}/content`;
    const partial = await binary(
      http().get(url).set('Cookie', cookie).set('Range', 'bytes=0-1'),
    ).expect(206);
    expect(partial.headers['content-range']).toBe(`bytes 0-1/${jpeg.length}`);
    expect(partial.headers['content-length']).toBe('2');
    expect(partial.body).toEqual(jpeg.subarray(0, 2));
    await http().get(url).set('Cookie', cookie).set('Range', `bytes=${jpeg.length}-`).expect(416);
  });

  it('404 a otra empresa, sin sesión 401 y 404 mientras está PENDING', async () => {
    const attachment = await readyImage();
    const other = await db.tenant.create({
      data: { approval: 'APPROVED', name: 'Otra', slug: `other-${randomUUID()}` },
    });
    const user = await db.user.create({
      data: { email: `${randomUUID()}@test.local`, displayName: 'X' },
    });
    await db.tenantMember.create({
      data: {
        tenantId: other.id,
        userId: user.id,
        email: user.email,
        displayName: 'X',
        role: 'OWNER',
      },
    });
    const otherCookie = await sessionFor(app, user.id, other.id);

    await http()
      .get(`/api/v1/attachments/${attachment.id}/content`)
      .set('Cookie', otherCookie)
      .expect(404);
    await http().get(`/api/v1/attachments/${attachment.id}/content`).expect(401);
    await post(envelope(imageMessage())).expect(200);
    const pending = await db.messageAttachment.findFirstOrThrow({
      where: { tenantId, status: 'PENDING' },
    });
    await http().get(`/api/v1/attachments/${pending.id}/content`).set('Cookie', cookie).expect(404);
  });

  const openAssigned = async () => {
    await post(envelope({ type: 'text', text: { body: 'Hola' } })).expect(200);
    const conversation = await db.conversation.findFirstOrThrow({ where: { tenantId } });
    await http()
      .post(`/api/v1/conversations/${conversation.id}/assign`)
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .send({ memberId: ownerMemberId, controlVersion: conversation.controlVersion })
      .expect(200);
    return conversation.id;
  };
  const upload = (
    conversationId: string,
    file: { bytes: Buffer; name: string; type: string },
    fields: Record<string, string> = {},
  ) => {
    let req = http()
      .post(`/api/v1/conversations/${conversationId}/messages/attachments`)
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .field('clientMessageId', fields.clientMessageId ?? randomUUID());
    if (fields.caption !== undefined) req = req.field('caption', fields.caption);
    return req.attach('file', file.bytes, { filename: file.name, contentType: file.type });
  };
  const pdf = {
    bytes: Buffer.from('%PDF-1.4 prueba'),
    name: 'cotización.pdf',
    type: 'application/pdf',
  };

  it('el agente asignado envía un PDF con pie; conserva el nombre UTF-8; es idempotente', async () => {
    const conversationId = await openAssigned();
    const clientMessageId = randomUUID();
    const first = await upload(conversationId, pdf, {
      clientMessageId,
      caption: 'Te paso la cotización',
    }).expect(201);

    expect(first.body).toMatchObject({
      status: 'PENDING',
      text: 'Te paso la cotización',
      attachment: {
        kind: 'DOCUMENT',
        fileName: 'cotización.pdf',
        status: 'READY',
        sizeBytes: pdf.bytes.length,
      },
    });
    const again = await upload(conversationId, pdf, { clientMessageId }).expect(200);
    expect(again.body.id).toBe(first.body.id);
    expect(
      await db.messageAttachment.count({ where: { tenantId, message: { direction: 'OUTBOUND' } } }),
    ).toBe(1);
  });

  it('valida tipo, tamaño, pie de audio y archivo ausente', async () => {
    const conversationId = await openAssigned();
    await upload(conversationId, {
      bytes: Buffer.from('PK'),
      name: 'a.zip',
      type: 'application/zip',
    }).expect(415);
    await upload(conversationId, {
      bytes: Buffer.alloc(5 * 1024 * 1024 + 1),
      name: 'g.png',
      type: 'image/png',
    }).expect(413);
    await upload(conversationId, {
      bytes: Buffer.alloc(17 * 1024 * 1024),
      name: 'v.mp4',
      type: 'video/mp4',
    }).expect(413);
    await upload(
      conversationId,
      { bytes: Buffer.from('ID3'), name: 'a.mp3', type: 'audio/mpeg' },
      { caption: 'hola' },
    ).expect(400);
    await http()
      .post(`/api/v1/conversations/${conversationId}/messages/attachments`)
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .field('clientMessageId', randomUUID())
      .expect(400);
  });

  it('403 si no es el agente asignado y 409 si la conversación está cerrada', async () => {
    await post(envelope({ type: 'text', text: { body: 'Hola' } })).expect(200);
    const conversation = await db.conversation.findFirstOrThrow({ where: { tenantId } });
    await upload(conversation.id, pdf).expect(403);
    const conversationId = await openAssigned();
    const current = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    await http()
      .post(`/api/v1/conversations/${conversationId}/close`)
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .send({ controlVersion: current.controlVersion })
      .expect(200);
    await upload(conversationId, pdf).expect(409);
  });

  it('el dispatcher sube el PDF a Graph y lo envía con media id; queda SENT', async () => {
    const conversationId = await openAssigned();
    const sent = await upload(conversationId, pdf, { caption: 'Cotización' }).expect(201);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: 'media-up-1' }))
      .mockResolvedValueOnce(Response.json({ messages: [{ id: 'wamid.OUT' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await app.get(DispatchOutboundMessageUseCase).send(tenantId, { messageId: sent.body.id });

    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({
      type: 'document',
      document: { id: 'media-up-1', caption: 'Cotización', filename: 'cotización.pdf' },
    });
    const message = await db.message.findUniqueOrThrow({ where: { id: sent.body.id } });
    expect(message).toMatchObject({ status: 'SENT', externalId: 'wamid.OUT' });
  });
});
