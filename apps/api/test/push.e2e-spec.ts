import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import webpush from 'web-push';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { devLogin, WEB_ORIGIN } from './support/session';
import { E2E_DEMO_KEY, testEnv } from './support/test-env';

const phone = () => `+57300${randomInt(1_000_000, 9_999_999)}`;
const subscription = (suffix: string) => ({
  endpoint: `https://push.example/${suffix}`,
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
});

async function boot(overrides: Record<string, string> = {}) {
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

describe('Web Push (e2e)', () => {
  describe('sin claves VAPID', () => {
    let app: NestExpressApplication;
    let prisma: PrismaService;
    let owner: string;
    let cookie: string;

    beforeAll(async () => {
      app = await boot();
      prisma = app.get(PrismaService);
      owner = (await prisma.tenantMember.findFirstOrThrow({ where: { email: 'supervisor@demo.omnidesk.local' } })).id;
      cookie = await devLogin(app, owner);
    });

    afterAll(async () => {
      await app.close();
    });

    it('GET /push/config responde 404 y asignar no encola notification.requested', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/push/config')
        .set('Cookie', cookie)
        .expect(404);

      const inbound = await request(app.getHttpServer())
        .post('/api/v1/integrations/messages/inbound')
        .set('Authorization', `Bearer ${E2E_DEMO_KEY}`)
        .send({
          externalMessageId: randomUUID(),
          from: { externalId: phone(), displayName: 'Cliente' },
          text: 'hola',
          sentAt: new Date().toISOString(),
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/conversations/${inbound.body.conversationId}/assign`)
        .set('Cookie', cookie)
        .set('Origin', WEB_ORIGIN)
        .send({ memberId: owner, controlVersion: inbound.body.controlVersion })
        .expect(200);

      const events = await prisma.outboxEvent.findMany({
        where: { type: 'notification.requested' },
      });
      expect(
        events.filter(
          (event) =>
            (event.payload as { conversationId?: string }).conversationId ===
            inbound.body.conversationId,
        ),
      ).toHaveLength(0);
    });
  });

  describe('con claves VAPID', () => {
    let app: NestExpressApplication;
    let prisma: PrismaService;
    let owner: string;
    let laura: string;
    const cookies = new Map<string, string>();
    const keys = webpush.generateVAPIDKeys();

    const http = () => request(app.getHttpServer());
    const as = (memberId: string, method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
      http()[method](path).set('Cookie', cookies.get(memberId)!).set('Origin', WEB_ORIGIN);

    beforeAll(async () => {
      app = await boot({
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
        VAPID_SUBJECT: 'mailto:soporte@gastromesa.com',
      });
      prisma = app.get(PrismaService);
      const member = async (email: string) =>
        (await prisma.tenantMember.findFirstOrThrow({ where: { email } })).id;
      owner = await member('supervisor@demo.omnidesk.local');
      laura = await member('laura@demo.omnidesk.local');
      cookies.set(owner, await devLogin(app, owner));
      cookies.set(laura, await devLogin(app, laura));
    });

    afterAll(async () => {
      await app.close();
    });

    it('suscribe, repite el alta, borra y guarda preferencias', async () => {
      const config = await as(laura, 'get', '/api/v1/push/config').expect(200);
      expect(config.body.vapidPublicKey).toBe(keys.publicKey);

      const endpoint = subscription(randomUUID());
      await as(laura, 'post', '/api/v1/push/subscriptions').send(endpoint).expect(201);
      await as(laura, 'post', '/api/v1/push/subscriptions').send(endpoint).expect(200);
      await as(laura, 'delete', '/api/v1/push/subscriptions')
        .send({ endpoint: endpoint.endpoint })
        .expect(204);
      await as(laura, 'delete', '/api/v1/push/subscriptions')
        .send({ endpoint: endpoint.endpoint })
        .expect(204);

      const prefs = await as(laura, 'get', '/api/v1/me/notification-preferences').expect(200);
      expect(prefs.body).toMatchObject({
        assigned: true,
        customerMessage: true,
        sendFailed: true,
        newAiConversation: false,
      });
      const updated = await as(laura, 'patch', '/api/v1/me/notification-preferences')
        .send({ ...prefs.body, customerMessage: false })
        .expect(200);
      expect(updated.body.customerMessage).toBe(false);
    });

    it('asignar a otra persona encola el aviso y autoasignarse no', async () => {
      const created = await http()
        .post('/api/v1/integrations/messages/inbound')
        .set('Authorization', `Bearer ${E2E_DEMO_KEY}`)
        .send({
          externalMessageId: randomUUID(),
          from: { externalId: phone(), displayName: 'Cliente' },
          text: 'hola',
          sentAt: new Date().toISOString(),
        })
        .expect(201);

      await as(owner, 'post', `/api/v1/conversations/${created.body.conversationId}/assign`)
        .send({ memberId: laura, controlVersion: created.body.controlVersion })
        .expect(200);

      const taken = await http()
        .post('/api/v1/integrations/messages/inbound')
        .set('Authorization', `Bearer ${E2E_DEMO_KEY}`)
        .send({
          externalMessageId: randomUUID(),
          from: { externalId: phone(), displayName: 'Cliente' },
          text: 'otra',
          sentAt: new Date().toISOString(),
        })
        .expect(201);
      await as(laura, 'post', `/api/v1/conversations/${taken.body.conversationId}/assign`)
        .send({ memberId: laura, controlVersion: taken.body.controlVersion })
        .expect(200);

      const events = await prisma.outboxEvent.findMany({ where: { type: 'notification.requested' } });
      const forConversation = (id: string) =>
        events.filter((event) => (event.payload as { conversationId?: string }).conversationId === id);

      expect(forConversation(created.body.conversationId)).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({ kind: 'assigned', recipientMemberIds: [laura] }),
        }),
      ]);
      expect(forConversation(taken.body.conversationId)).toHaveLength(0);
    });

    it('la prueba sin dispositivos responde 503', async () => {
      await as(owner, 'post', '/api/v1/push/test').expect(503);
    });
  });
});
