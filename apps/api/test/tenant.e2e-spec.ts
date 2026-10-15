import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  AuthProvidersResponseSchema,
  InvitationPreviewSchema,
  MeResponseSchema,
  TenantDetailsSchema,
} from '@omnidesk/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from '../src/modules/attachments/application/ports/attachment-storage';
import { OutboxDispatcher } from '../src/modules/realtime/infrastructure/outbox-dispatcher';
import { sha256Hex } from '../src/shared/infrastructure/crypto/sha256';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { devLogin, sessionFor, WEB_ORIGIN } from './support/session';
import { testEnv } from './support/test-env';

const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(64, 3),
]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 4)]);
const HOUR = 60 * 60 * 1000;

describe('Empresa: editar, logo, inactivar y reactivar (e2e)', () => {
  let app: NestExpressApplication;
  let db: PrismaService;
  let storage: AttachmentStorage;
  let dispatcher: OutboxDispatcher;
  let tenantId: string;
  let tenantName: string;
  let channelKey: string;
  let owner: { memberId: string; cookie: string };
  let admin: { memberId: string; cookie: string };
  let agent: { memberId: string; cookie: string };
  const http = () => request(app.getHttpServer());

  const as = (cookie: string) => ({
    get: (path: string) => http().get(path).set('Cookie', cookie),
    patch: (path: string, body: object) =>
      http().patch(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN).send(body),
    post: (path: string, body: object = {}) =>
      http().post(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN).send(body),
    delete: (path: string) => http().delete(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN),
    put: (path: string, bytes: Buffer, name: string) =>
      http().put(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN).attach('file', bytes, name),
  });

  const addMember = async (role: 'OWNER' | 'ADMIN' | 'AGENT', tenant = tenantId) => {
    const user = await db.user.create({
      data: { email: `${randomUUID()}@e2e.local`, displayName: `${role} e2e` },
    });
    const member = await db.tenantMember.create({
      data: {
        tenantId: tenant,
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        role,
      },
    });
    return { memberId: member.id, cookie: await sessionFor(app, user.id, tenant) };
  };

  const integration = (path: string, body: object) =>
    http().post(path).set('Authorization', `Bearer ${channelKey}`).send(body);
  const inbound = async (phone = `+57300${Date.now() % 10_000_000}`) =>
    (
      await integration('/api/v1/integrations/messages/inbound', {
        externalMessageId: randomUUID(),
        from: { externalId: phone, displayName: 'Cliente' },
        text: 'Hola',
        sentAt: new Date().toISOString(),
      }).expect((res) => expect([200, 201]).toContain(res.status))
    ).body as { conversationId: string; controlVersion: number; aiAllowed: boolean };

  const deactivate = (confirmName = tenantName) =>
    as(owner.cookie).post('/api/v1/tenants/current/deactivate', { confirmName });
  const reactivate = () => as(owner.cookie).post('/api/v1/tenants/current/reactivate');
  const countEvents = (type: string) => db.outboxEvent.count({ where: { tenantId, type } });
  const exists = (key: string) =>
    storage.get(key).then(
      () => true,
      () => false,
    );

  beforeAll(async () => {
    const env = testEnv();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bufferLogs: true,
      rawBody: true,
    });
    configureApp(app, env);
    await app.init();
    dispatcher = app.get(OutboxDispatcher);
    // El dispatcher se ejecuta a mano (`tick`) para controlar qué sale y cuándo.
    await dispatcher.onModuleDestroy();
    db = app.get(PrismaService);
    storage = app.get(ATTACHMENT_STORAGE);
  });
  afterAll(() => app.close());

  beforeEach(async () => {
    tenantName = `Acme ${randomUUID().slice(0, 6)}`;
    tenantId = (
      await db.tenant.create({ data: { name: tenantName, slug: `acme-${randomUUID()}` } })
    ).id;
    owner = await addMember('OWNER');
    admin = await addMember('ADMIN');
    agent = await addMember('AGENT');
    channelKey = `acme-key-${randomUUID()}`;
    const channel = await db.channel.create({
      data: {
        tenantId,
        name: 'Ventas',
        type: 'WHATSAPP',
        provider: 'SIMULATED',
        externalId: `acme-${randomUUID()}`,
      },
    });
    await db.integrationCredential.create({
      data: { tenantId, channelId: channel.id, keyHash: sha256Hex(channelKey) },
    });
  });

  describe('editar', () => {
    it('el Owner ve y edita la empresa; Admin y Agent reciben 403', async () => {
      const details = TenantDetailsSchema.parse(
        (await as(owner.cookie).get('/api/v1/tenants/current').expect(200)).body,
      );
      expect(details).toMatchObject({ id: tenantId, name: tenantName, logoUrl: null });
      expect(details.deactivatedAt).toBeNull();
      expect(details.slugLocked).toBe(false);

      await as(admin.cookie).get('/api/v1/tenants/current').expect(403);
      await as(agent.cookie).patch('/api/v1/tenants/current', { name: 'Otra' }).expect(403);

      const slug = `nuevo-${randomUUID().slice(0, 8)}`;
      const updated = await as(owner.cookie)
        .patch('/api/v1/tenants/current', { name: 'Acme Renombrada', slug })
        .expect(200);
      expect(updated.body).toMatchObject({ name: 'Acme Renombrada', slug });

      const me = MeResponseSchema.parse((await as(agent.cookie).get('/api/v1/me')).body);
      expect(me.memberships[0]).toMatchObject({ tenantName: 'Acme Renombrada', tenantSlug: slug });
    });

    it('un slug ocupado responde 409 SLUG_TAKEN y el de la demo 409 DEMO_SLUG_LOCKED', async () => {
      const taken = await as(owner.cookie)
        .patch('/api/v1/tenants/current', { slug: 'demo' })
        .expect(409);
      expect(taken.body.code).toBe('SLUG_TAKEN');

      const demo = await db.tenant.findUniqueOrThrow({ where: { slug: 'demo' } });
      const demoOwner = await addMember('OWNER', demo.id);
      const locked = await as(demoOwner.cookie)
        .patch('/api/v1/tenants/current', { slug: `demo-${randomUUID().slice(0, 6)}` })
        .expect(409);
      expect(locked.body.code).toBe('DEMO_SLUG_LOCKED');
      await as(demoOwner.cookie).patch('/api/v1/tenants/current', { slug: 'demo' }).expect(200);
      await db.tenantMember.update({
        where: { id: demoOwner.memberId },
        data: { removedAt: new Date() },
      });
    });
  });

  describe('logo', () => {
    it('subir, cambiar y quitar; el anterior se borra y /me lleva la URL', async () => {
      const first = await as(owner.cookie)
        .put('/api/v1/tenants/current/logo', webp, 'logo.webp')
        .expect(200);
      const firstKey = (await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).logoKey!;
      expect(first.body.logoUrl).toMatch(new RegExp(`^/api/v1/tenants/${tenantId}/logo\\?v=\\d+$`));
      expect(firstKey.startsWith(`tenants/${tenantId}/logo-`)).toBe(true);

      const me = MeResponseSchema.parse((await as(agent.cookie).get('/api/v1/me')).body);
      expect(me.memberships[0]?.tenantLogoUrl).toBe(first.body.logoUrl);

      const photo = await as(agent.cookie).get(first.body.logoUrl).expect(200);
      expect(photo.headers['content-type']).toBe('image/webp');
      expect(photo.headers['cache-control']).toBe('private, max-age=31536000, immutable');

      await as(owner.cookie).put('/api/v1/tenants/current/logo', jpeg, 'logo.jpg').expect(200);
      expect(await exists(firstKey)).toBe(false);
      const secondKey = (await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).logoKey!;

      const removed = await as(owner.cookie).delete('/api/v1/tenants/current/logo').expect(200);
      expect(removed.body.logoUrl).toBeNull();
      expect(await exists(secondKey)).toBe(false);
    });

    it('con la empresa inactiva, el logo lo ve su Owner y no su Admin', async () => {
      const res = await as(owner.cookie)
        .put('/api/v1/tenants/current/logo', webp, 'logo.webp')
        .expect(200);
      await deactivate().expect(200);
      await as(owner.cookie).get(res.body.logoUrl).expect(200);
      await as(admin.cookie).get(res.body.logoUrl).expect(404);
    });

    it('rechaza PNG (415) y a quien no es Owner (403)', async () => {
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(32)]);
      await as(owner.cookie).put('/api/v1/tenants/current/logo', png, 'logo.png').expect(415);
      await as(admin.cookie).put('/api/v1/tenants/current/logo', webp, 'logo.webp').expect(403);
    });

    it('404 a quien no es miembro; por token, solo con una invitación vigente', async () => {
      const res = await as(owner.cookie)
        .put('/api/v1/tenants/current/logo', webp, 'logo.webp')
        .expect(200);
      const otherTenant = (
        await db.tenant.create({ data: { name: 'Otra', slug: `otra-${randomUUID()}` } })
      ).id;
      const stranger = await addMember('OWNER', otherTenant);
      await as(stranger.cookie).get(res.body.logoUrl).expect(404);

      const invite = await as(owner.cookie)
        .post('/api/v1/invitations', { email: `${randomUUID()}@e2e.local`, role: 'AGENT' })
        .expect(201);
      const token = new URL(invite.body.url).pathname.split('/').pop()!;
      const preview = InvitationPreviewSchema.parse(
        (await http().get(`/api/v1/invitations/by-token/${token}`).expect(200)).body,
      );
      expect(preview.tenantLogoUrl).toMatch(/^\/api\/v1\/invitations\/.+\/logo\?v=\d+$/);
      await http().get(preview.tenantLogoUrl!).expect(200);

      await as(owner.cookie).delete(`/api/v1/invitations/${invite.body.id}`).expect(204);
      await http().get(preview.tenantLogoUrl!).expect(404);
      await http().get(`/api/v1/invitations/desconocido/logo`).expect(404);
    });
  });

  describe('inactivar', () => {
    it('un nombre distinto responde 400 CONFIRMATION_MISMATCH y no cambia nada', async () => {
      const res = await deactivate('otro nombre').expect(400);
      expect(res.body.code).toBe('CONFIRMATION_MISMATCH');
      expect(
        (await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).deactivatedAt,
      ).toBeNull();
      await as(admin.cookie)
        .post('/api/v1/tenants/current/deactivate', {
          confirmName: tenantName,
        })
        .expect(403);
    });

    it('corta el acceso de Admin y Agent, revoca invitaciones y avisa una sola vez', async () => {
      const invite = await as(owner.cookie)
        .post('/api/v1/invitations', { email: `${randomUUID()}@e2e.local`, role: 'AGENT' })
        .expect(201);
      const token = new URL(invite.body.url).pathname.split('/').pop()!;

      const res = await deactivate().expect(200);
      expect(TenantDetailsSchema.parse(res.body)).toMatchObject({
        deactivatedBy: { id: owner.memberId },
      });
      await deactivate().expect(200);
      expect(await countEvents('tenant.status_changed')).toBe(1);

      const invitation = await db.invitation.findUniqueOrThrow({ where: { id: invite.body.id } });
      expect(invitation.revokedAt).not.toBeNull();

      // Agent con esa única empresa: sale de ella y va a /onboarding.
      const agentMe = MeResponseSchema.parse((await as(agent.cookie).get('/api/v1/me')).body);
      expect(agentMe.memberships).toEqual([]);
      expect(agentMe.activeTenantId).toBeNull();
      await as(admin.cookie).get('/api/v1/conversations').expect(403);

      // Owner: la ve inactiva y solo entra a la empresa.
      const ownerMe = MeResponseSchema.parse((await as(owner.cookie).get('/api/v1/me')).body);
      expect(ownerMe.memberships).toEqual([
        expect.objectContaining({ tenantId, tenantActive: false }),
      ]);
      expect(ownerMe.activeTenantId).toBe(tenantId);
      await as(owner.cookie).get('/api/v1/tenants/current').expect(200);
      const blocked = await as(owner.cookie).get('/api/v1/conversations').expect(403);
      expect(blocked.body.code).toBe('TENANT_INACTIVE');

      // Aceptar una invitación de la empresa inactiva: 409.
      const invitee = await db.user.create({
        data: { email: invitation.email, displayName: 'Invitada' },
      });
      const accepted = await http()
        .post(`/api/v1/invitations/by-token/${token}/accept`)
        .set('Cookie', await sessionFor(app, invitee.id))
        .set('Origin', WEB_ORIGIN)
        .expect(409);
      expect(accepted.body.code).toBe('TENANT_INACTIVE');
    });

    it('un Admin que cambia de empresa no puede elegir la inactiva', async () => {
      await deactivate().expect(200);
      await as(admin.cookie).post('/api/v1/me/active-tenant', { tenantId }).expect(403);
    });

    it('el entrante se guarda sin IA ni avisos; la IA recibe 409 TENANT_INACTIVE', async () => {
      const { conversationId, controlVersion } = await inbound();
      await deactivate().expect(200);
      const notificationsBefore = await countEvents('notification.requested');

      const again = await inbound(`+57311${Date.now() % 10_000_000}`);
      expect(again.aiAllowed).toBe(false);
      expect(await db.message.count({ where: { conversationId: again.conversationId } })).toBe(1);
      expect(await countEvents('notification.requested')).toBe(notificationsBefore);

      const ai = await integration('/api/v1/integrations/messages/outbound', {
        conversationId,
        controlVersion,
        idempotencyKey: randomUUID(),
        text: 'Respuesta',
      }).expect(409);
      expect(ai.body).toEqual({ sendAllowed: false, reason: 'TENANT_INACTIVE' });
    });
  });

  describe('envíos y reactivación', () => {
    /** Conversación asignada al Owner con un mensaje suyo en cola. */
    async function queuedMessage(): Promise<{ conversationId: string; messageId: string }> {
      const { conversationId, controlVersion } = await inbound(
        `+57312${Math.floor(Math.random() * 10_000_000)}`,
      );
      await as(owner.cookie)
        .post(`/api/v1/conversations/${conversationId}/assign`, {
          memberId: owner.memberId,
          controlVersion,
        })
        .expect(200);
      const sent = await as(owner.cookie)
        .post(`/api/v1/conversations/${conversationId}/messages`, {
          text: 'Hola',
          clientMessageId: randomUUID(),
        })
        .expect(201);
      return { conversationId, messageId: sent.body.id };
    }
    const messageOf = (id: string) => db.message.findUniqueOrThrow({ where: { id } });
    const sendEventsFor = (messageId: string) =>
      db.outboxEvent.count({
        where: { tenantId, type: 'message.send_requested', payload: { equals: { messageId } } },
      });

    it('lo encolado falla con TENANT_INACTIVE y al reactivar vuelve a la cola si la ventana sigue abierta', async () => {
      const open = await queuedMessage();
      const stale = await queuedMessage();
      await deactivate().expect(200);

      for (let round = 0; round < 5; round += 1) await dispatcher.tick();
      for (const { messageId } of [open, stale]) {
        expect(await messageOf(messageId)).toMatchObject({
          status: 'FAILED',
          failureReason: 'TENANT_INACTIVE',
        });
      }

      // Ventana cerrada en la segunda: 19 h desde el último mensaje del cliente.
      await db.conversation.update({
        where: { id: stale.conversationId },
        data: { lastInboundAt: new Date(Date.now() - 19 * HOUR) },
      });

      const res = await reactivate().expect(200);
      expect(res.body.deactivatedAt).toBeNull();
      await reactivate().expect(200);
      expect(await countEvents('tenant.status_changed')).toBe(2);

      expect(await messageOf(open.messageId)).toMatchObject({
        status: 'PENDING',
        failureReason: null,
      });
      expect(await sendEventsFor(open.messageId)).toBe(2);
      expect(await messageOf(stale.messageId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'TENANT_INACTIVE',
      });

      const agentMe = MeResponseSchema.parse((await as(agent.cookie).get('/api/v1/me')).body);
      expect(agentMe.memberships).toEqual([
        expect.objectContaining({ tenantId, tenantActive: true }),
      ]);
    });
  });

  describe('demo inactiva', () => {
    it('el login de desarrollo no lista sus miembros y dev-login responde 404', async () => {
      const demo = await db.tenant.findUniqueOrThrow({ where: { slug: 'demo' } });
      const member = await db.tenantMember.findFirstOrThrow({
        where: { tenantId: demo.id, removedAt: null, userId: { not: null } },
      });
      await db.tenant.update({ where: { id: demo.id }, data: { deactivatedAt: new Date() } });
      try {
        const providers = AuthProvidersResponseSchema.parse(
          (await http().get('/api/v1/auth/providers').expect(200)).body,
        );
        expect(providers.demoMembers).toEqual([]);
        await http()
          .post('/api/v1/auth/dev-login')
          .set('Origin', WEB_ORIGIN)
          .send({ memberId: member.id })
          .expect(404);
      } finally {
        await db.tenant.update({ where: { id: demo.id }, data: { deactivatedAt: null } });
      }
      await devLogin(app, member.id);
    });
  });
});
