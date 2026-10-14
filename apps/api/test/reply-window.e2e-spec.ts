import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ListConversationsResponseSchema } from '@omnidesk/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { devLogin, WEB_ORIGIN } from './support/session';
import { E2E_DEMO_KEY, testEnv } from './support/test-env';

const phone = () => `+57300${randomInt(1_000_000, 9_999_999)}`;
const HOURS = 3_600_000;

describe('Ventana de respuesta de 18 h (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: string;
  let laura: string;
  const http = () => request(app.getHttpServer());
  const cookies = new Map<string, string>();

  const integrationPost = (path: string, body: object) =>
    http().post(path).set('Authorization', `Bearer ${E2E_DEMO_KEY}`).send(body);

  const inbound = async () =>
    (
      await integrationPost('/api/v1/integrations/messages/inbound', {
        externalMessageId: randomUUID(),
        from: { externalId: phone(), displayName: 'Cliente e2e' },
        text: 'Hola',
        sentAt: new Date().toISOString(),
      })
    ).body as { conversationId: string; controlVersion: number };

  const post = (actor: string, path: string, body: object = {}) =>
    http().post(path).set('Cookie', cookies.get(actor)!).set('Origin', WEB_ORIGIN).send(body);

  const sendEvents = async (conversationId: string) => {
    const messages = await prisma.message.findMany({
      where: { conversationId },
      select: { id: true },
    });
    const ids = new Set(messages.map((message) => message.id));
    const events = await prisma.outboxEvent.findMany({
      where: { type: 'message.send_requested' },
      select: { payload: true },
    });
    return events.filter((event) => ids.has((event.payload as { messageId?: string }).messageId ?? ''))
      .length;
  };

  const expire = (conversationId: string) =>
    prisma.conversation.update({
      where: { id: conversationId },
      data: { lastInboundAt: new Date(Date.now() - 19 * HOURS) },
    });

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
    const member = async (email: string) =>
      (await prisma.tenantMember.findFirstOrThrow({ where: { email } })).id;
    owner = await member('supervisor@demo.omnidesk.local');
    laura = await member('laura@demo.omnidesk.local');
    for (const id of [owner, laura]) cookies.set(id, await devLogin(app, id));
  });

  afterAll(async () => {
    await app.close();
  });

  it('a las 19 h no envía texto, adjunto ni reintento, y un mensaje del cliente reabre la ventana', async () => {
    const { conversationId, controlVersion } = await inbound();
    await post(owner, `/api/v1/conversations/${conversationId}/assign`, {
      memberId: laura,
      controlVersion,
    }).expect(200);

    const sent = await post(laura, `/api/v1/conversations/${conversationId}/messages`, {
      text: 'Te respondo',
      clientMessageId: randomUUID(),
    }).expect(201);
    await prisma.message.update({
      where: { id: sent.body.id as string },
      data: { status: 'FAILED', failureReason: 'sin red' },
    });

    await expire(conversationId);
    const before = await sendEvents(conversationId);

    const text = await post(laura, `/api/v1/conversations/${conversationId}/messages`, {
      text: '¿Sigues ahí?',
      clientMessageId: randomUUID(),
    }).expect(409);
    expect(text.body).toEqual({ reason: 'WINDOW_CLOSED' });

    const file = await http()
      .post(`/api/v1/conversations/${conversationId}/messages/attachments`)
      .set('Cookie', cookies.get(laura)!)
      .set('Origin', WEB_ORIGIN)
      .field('clientMessageId', randomUUID())
      .field('caption', 'el pdf')
      .attach('file', Buffer.from('%PDF-1.4 prueba'), {
        filename: 'nota.pdf',
        contentType: 'application/pdf',
      })
      .expect(409);
    expect(file.body).toEqual({ reason: 'WINDOW_CLOSED' });

    const retry = await post(
      laura,
      `/api/v1/conversations/${conversationId}/messages/${sent.body.id}/retry`,
    ).expect(409);
    expect(retry.body).toEqual({ reason: 'WINDOW_CLOSED' });
    expect(await sendEvents(conversationId)).toBe(before);
  });

  it('un mensaje del mismo cliente reabre la ventana y el listado trae lastInboundAt', async () => {
    const from = phone();
    const first = await integrationPost('/api/v1/integrations/messages/inbound', {
      externalMessageId: randomUUID(),
      from: { externalId: from, displayName: 'Cliente e2e' },
      text: 'Hola',
      sentAt: new Date().toISOString(),
    });
    const conversationId = first.body.conversationId as string;
    await post(owner, `/api/v1/conversations/${conversationId}/assign`, {
      memberId: laura,
      controlVersion: first.body.controlVersion,
    }).expect(200);
    await expire(conversationId);

    await integrationPost('/api/v1/integrations/messages/inbound', {
      externalMessageId: randomUUID(),
      from: { externalId: from, displayName: 'Cliente e2e' },
      text: 'Sigo aquí',
      sentAt: new Date().toISOString(),
    }).expect(201);

    const again = await post(laura, `/api/v1/conversations/${conversationId}/messages`, {
      text: 'Te leo',
      clientMessageId: randomUUID(),
    }).expect(201);
    expect(again.body.status).toBe('PENDING');

    const listed = await http()
      .get('/api/v1/conversations?inbox=mine')
      .set('Cookie', cookies.get(laura)!)
      .expect(200);
    const page = ListConversationsResponseSchema.parse(listed.body);
    const summary = page.items.find((item) => item.id === conversationId);
    expect(summary?.lastInboundAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('la IA tampoco responde fuera de la ventana', async () => {
    const opened = await inbound();
    await expire(opened.conversationId);

    const res = await integrationPost('/api/v1/integrations/messages/outbound', {
      conversationId: opened.conversationId,
      controlVersion: opened.controlVersion,
      idempotencyKey: randomUUID(),
      text: 'Respuesta tardía',
    }).expect(409);

    expect(res.body).toEqual({ sendAllowed: false, reason: 'WINDOW_CLOSED' });
  });
});
