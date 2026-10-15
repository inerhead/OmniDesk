import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  AuthProvidersResponseSchema,
  MeResponseSchema,
  PlatformTenantsResponseSchema,
  TenantDetailsSchema,
} from '@omnidesk/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OutboxDispatcher } from '../src/modules/realtime/infrastructure/outbox-dispatcher';
import { DEMO_PLATFORM_ADMIN_EMAIL } from '../src/shared/application/platform-admins';
import { sha256Hex } from '../src/shared/infrastructure/crypto/sha256';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { sessionFor, WEB_ORIGIN } from './support/session';
import { testEnv } from './support/test-env';

const unique = () => randomUUID().slice(0, 8);
const phone = () => `+57300${randomInt(1_000_000, 9_999_999)}`;
const HOUR = 60 * 60 * 1000;

describe('Plataforma: aprobación y suspensión de empresas (e2e)', () => {
  let app: NestExpressApplication;
  let db: PrismaService;
  let admin: Client;
  let dispatcher: OutboxDispatcher;
  const http = () => request(app.getHttpServer());

  type Client = ReturnType<typeof as>;
  const as = (cookie: string) => ({
    cookie,
    get: (path: string) => http().get(path).set('Cookie', cookie),
    post: (path: string, body: object = {}) =>
      http().post(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN).send(body),
  });

  async function signedUpUser(email = `user-${unique()}@e2e.local`) {
    const user = await db.user.upsert({
      where: { email },
      create: { email, displayName: 'Persona' },
      update: {},
    });
    return { user, client: as(await sessionFor(app, user.id)) };
  }

  /** Solicitud de empresa de un usuario nuevo. */
  async function request_(name = 'Acme') {
    const requester = await signedUpUser();
    const slug = `acme-${unique()}`;
    const contactPhone = phone();
    const res = await requester.client
      .post('/api/v1/tenants', { name, slug, contactPhone })
      .expect(201);
    return { ...requester, tenantId: res.body.id as string, slug, contactPhone, body: res.body };
  }

  const me = async (client: Client) =>
    MeResponseSchema.parse((await client.get('/api/v1/me').expect(200)).body);

  const list = async (status: 'pending' | 'approved' | 'rejected') =>
    PlatformTenantsResponseSchema.parse(
      (await admin.get(`/api/v1/platform/tenants?status=${status}`).expect(200)).body,
    );
  const approve = (tenantId: string) => admin.post(`/api/v1/platform/tenants/${tenantId}/approve`);
  const reject = (tenantId: string, reason = 'Datos de contacto falsos') =>
    admin.post(`/api/v1/platform/tenants/${tenantId}/reject`, { reason });
  const suspend = (tenantId: string, reason = 'Impago de la suscripción') =>
    admin.post(`/api/v1/platform/tenants/${tenantId}/suspend`, { reason });
  const unsuspend = (tenantId: string) =>
    admin.post(`/api/v1/platform/tenants/${tenantId}/unsuspend`);

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
    admin = (await signedUpUser(DEMO_PLATFORM_ADMIN_EMAIL)).client;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('alta en revisión', () => {
    it('crea la empresa PENDING con el teléfono y el email de login, y la deja activa', async () => {
      const { user, client, tenantId, contactPhone, body } = await request_();

      expect(body.approval).toBe('PENDING');
      const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(tenant).toMatchObject({ approval: 'PENDING', contactPhone, contactEmail: user.email });

      const view = await me(client);
      expect(view.activeTenantId).toBe(tenantId);
      expect(view.memberships).toEqual([
        expect.objectContaining({ tenantId, role: 'OWNER', tenantState: 'pending' }),
      ]);
      expect(view.isPlatformAdmin).toBe(false);
      expect(view.platformPendingCount).toBeNull();
    });

    it('con la empresa en revisión, el API de empresa responde 403 TENANT_PENDING', async () => {
      const { client } = await request_();

      for (const path of ['/api/v1/conversations', '/api/v1/tenants/current']) {
        const res = await client.get(path).expect(403);
        expect(res.body.code).toBe('TENANT_PENDING');
      }
    });

    it('sin teléfono o con uno que no es E.164 responde 400 y no crea nada', async () => {
      const { client } = await signedUpUser();

      for (const contactPhone of [undefined, '3001234567', '+57 300 123 4567']) {
        const slug = `sin-tel-${unique()}`;
        await client.post('/api/v1/tenants', { name: 'Acme', slug, contactPhone }).expect(400);
        expect(await db.tenant.count({ where: { slug } })).toBe(0);
      }
    });

    it('una segunda solicitud con una en revisión responde 409 REQUEST_PENDING', async () => {
      const { client } = await request_();

      const res = await client
        .post('/api/v1/tenants', { name: 'Otra', slug: `otra-${unique()}`, contactPhone: phone() })
        .expect(409);
      expect(res.body.code).toBe('REQUEST_PENDING');
    });

    it('el slug de una empresa en revisión queda reservado (409 SLUG_TAKEN)', async () => {
      const { slug } = await request_();
      const other = await signedUpUser();

      const res = await other.client
        .post('/api/v1/tenants', { name: 'Otra', slug, contactPhone: phone() })
        .expect(409);
      expect(res.body.code).toBe('SLUG_TAKEN');
    });

    it('la empresa de un admin de plataforma nace APPROVED y sin aviso a los admins', async () => {
      const owner = await signedUpUser(DEMO_PLATFORM_ADMIN_EMAIL);
      // El admin ya pudo crear otras en pruebas anteriores: se las quitamos para empezar de cero.
      await db.tenantMember.updateMany({
        where: { userId: owner.user.id },
        data: { removedAt: new Date() },
      });
      const slug = `plataforma-${unique()}`;

      const res = await owner.client
        .post('/api/v1/tenants', { name: 'De la plataforma', slug, contactPhone: phone() })
        .expect(201);

      expect(res.body.approval).toBe('APPROVED');
      await owner.client.get('/api/v1/conversations').expect(200);
      expect(
        await db.outboxEvent.count({
          where: { tenantId: res.body.id, type: 'platform.push_requested' },
        }),
      ).toBe(0);
    });

    it('una solicitud encola el push a los admins de plataforma', async () => {
      const { tenantId } = await request_('Con aviso');
      const adminUser = await db.user.findUniqueOrThrow({
        where: { email: DEMO_PLATFORM_ADMIN_EMAIL },
      });

      const event = await db.outboxEvent.findFirstOrThrow({
        where: { tenantId, type: 'platform.push_requested' },
      });
      expect(event.payload).toMatchObject({
        userIds: [adminUser.id],
        title: 'Nueva solicitud de empresa',
        url: '/platform',
      });
    });

    it('GET /tenants/current devuelve el contacto a un Owner de una empresa aprobada', async () => {
      const { client, tenantId, contactPhone, user } = await request_();
      await db.tenant.update({ where: { id: tenantId }, data: { approval: 'APPROVED' } });

      const details = TenantDetailsSchema.parse(
        (await client.get('/api/v1/tenants/current').expect(200)).body,
      );
      expect(details).toMatchObject({ contactPhone, contactEmail: user.email });
    });
  });

  it('el admin de plataforma ve el contador de pendientes en /me', async () => {
    await request_();

    const view = await me(admin);
    expect(view.isPlatformAdmin).toBe(true);
    expect(view.platformPendingCount).toBeGreaterThan(0);
  });

  describe('panel y guard', () => {
    it('quien no es admin recibe 404 en /platform; sin sesión, 401', async () => {
      const { client, tenantId } = await request_();

      await client.get('/api/v1/platform/tenants').expect(404);
      await client.post(`/api/v1/platform/tenants/${tenantId}/approve`).expect(404);
      await http().get('/api/v1/platform/tenants').expect(401);
    });

    it('Pendientes muestra la solicitud con el solicitante y el contacto', async () => {
      const { user, tenantId, slug, contactPhone } = await request_('Panel');

      expect((await list('pending')).find((row) => row.id === tenantId)).toMatchObject({
        name: 'Panel',
        slug,
        requester: { email: user.email },
        contactPhone,
        contactEmail: user.email,
        state: null,
      });
    });
  });

  describe('aprobar y rechazar', () => {
    it('aprobar da acceso al solicitante, avisa por push y repetirlo responde 409 NOT_PENDING', async () => {
      const { client, tenantId, user } = await request_();

      await approve(tenantId).expect(200);

      await client.get('/api/v1/conversations').expect(200);
      expect((await me(client)).memberships[0]).toMatchObject({ tenantState: 'active' });
      expect((await list('approved')).find((row) => row.id === tenantId)).toMatchObject({
        state: 'active',
      });
      const push = await db.outboxEvent.findFirstOrThrow({
        where: {
          tenantId,
          type: 'platform.push_requested',
          payload: { path: ['title'], equals: 'Empresa aprobada' },
        },
      });
      expect(push.payload).toMatchObject({ userIds: [user.id], url: '/conversations' });

      expect((await approve(tenantId).expect(409)).body.code).toBe('NOT_PENDING');
      expect((await reject(tenantId).expect(409)).body.code).toBe('NOT_PENDING');
    });

    it('rechazar sin motivo o con menos de 5 caracteres responde 400 y no cambia nada', async () => {
      const { tenantId } = await request_();

      await admin.post(`/api/v1/platform/tenants/${tenantId}/reject`, {}).expect(400);
      await reject(tenantId, 'abc').expect(400);

      expect(await db.tenant.findUnique({ where: { id: tenantId } })).toMatchObject({
        approval: 'PENDING',
      });
    });

    it('rechazar borra la empresa y su membresía, libera el slug y deja el aviso', async () => {
      const { user, client, tenantId, slug, contactPhone } = await request_('Rechazada');

      await reject(tenantId).expect(200);

      expect(await db.tenant.count({ where: { id: tenantId } })).toBe(0);
      expect(await db.tenantMember.count({ where: { tenantId } })).toBe(0);
      const view = await me(client);
      expect(view.memberships).toEqual([]);
      expect(view.activeTenantId).toBeNull();
      expect(view.tenantRejection).toMatchObject({
        tenantName: 'Rechazada',
        reason: 'Datos de contacto falsos',
      });
      expect((await list('rejected')).find((row) => row.slug === slug)).toMatchObject({
        name: 'Rechazada',
        requester: { email: user.email },
        contactPhone,
        rejectionReason: 'Datos de contacto falsos',
      });
      expect(
        await db.outboxEvent.count({ where: { tenantId, type: 'platform.push_requested' } }),
      ).toBe(2);

      // El slug queda libre; enviar otra solicitud cierra el aviso.
      await client
        .post('/api/v1/tenants', { name: 'Otra vez', slug, contactPhone: phone() })
        .expect(201);
      expect((await me(client)).tenantRejection).toBeNull();
    });

    it('un rechazado con otra empresa cae a ella y cierra el aviso con dismiss', async () => {
      const company = await request_('Primera');
      await approve(company.tenantId).expect(200);
      const second = (
        await company.client
          .post('/api/v1/tenants', {
            name: 'Segunda',
            slug: `seg-${unique()}`,
            contactPhone: phone(),
          })
          .expect(201)
      ).body.id as string;
      expect((await me(company.client)).activeTenantId).toBe(second);

      await reject(second).expect(200);

      const view = await me(company.client);
      expect(view.activeTenantId).toBe(company.tenantId);
      expect(view.tenantRejection).not.toBeNull();
      await company.client.post('/api/v1/me/tenant-rejection/dismiss').expect(204);
      expect((await me(company.client)).tenantRejection).toBeNull();
    });

    it('la pestaña Rechazadas no muestra rechazos de más de 20 días', async () => {
      const { user } = await signedUpUser();
      const slug = `vieja-${unique()}`;
      await db.tenantRejection.create({
        data: {
          userId: user.id,
          tenantName: 'Vieja',
          tenantSlug: slug,
          reason: 'Duplicada',
          requestedAt: new Date(Date.now() - 22 * 24 * HOUR),
          rejectedAt: new Date(Date.now() - 21 * 24 * HOUR),
        },
      });

      expect((await list('rejected')).some((row) => row.slug === slug)).toBe(false);
    });
  });

  describe('suspender y levantar', () => {
    let tenantId: string;
    let channelKey: string;
    let owner: { memberId: string; client: Client };
    let agent: { memberId: string; client: Client };

    const addMember = async (role: 'OWNER' | 'AGENT') => {
      const user = await db.user.create({
        data: { email: `${randomUUID()}@e2e.local`, displayName: `${role} e2e` },
      });
      const member = await db.tenantMember.create({
        data: { tenantId, userId: user.id, email: user.email, displayName: user.displayName, role },
      });
      return { memberId: member.id, client: as(await sessionFor(app, user.id, tenantId)) };
    };
    const integration = (path: string, body: object) =>
      http().post(path).set('Authorization', `Bearer ${channelKey}`).send(body);
    const inbound = async () =>
      (
        await integration('/api/v1/integrations/messages/inbound', {
          externalMessageId: randomUUID(),
          from: { externalId: phone(), displayName: 'Cliente' },
          text: 'Hola',
          sentAt: new Date().toISOString(),
        }).expect(201)
      ).body as { conversationId: string; controlVersion: number; aiAllowed: boolean };
    /** Conversación asignada al Owner con un mensaje suyo en cola. */
    async function queuedMessage() {
      const { conversationId, controlVersion } = await inbound();
      await owner.client
        .post(`/api/v1/conversations/${conversationId}/assign`, {
          memberId: owner.memberId,
          controlVersion,
        })
        .expect(200);
      const sent = await owner.client
        .post(`/api/v1/conversations/${conversationId}/messages`, {
          text: 'Hola',
          clientMessageId: randomUUID(),
        })
        .expect(201);
      return { conversationId, messageId: sent.body.id as string };
    }
    const messageOf = (id: string) => db.message.findUniqueOrThrow({ where: { id } });
    const countEvents = (type: string) => db.outboxEvent.count({ where: { tenantId, type } });
    const drain = async () => {
      for (let round = 0; round < 5; round += 1) await dispatcher.tick();
    };

    beforeAll(async () => {
      tenantId = (
        await db.tenant.create({
          data: { approval: 'APPROVED', name: 'Suspensiones', slug: `susp-${unique()}` },
        })
      ).id;
      owner = await addMember('OWNER');
      agent = await addMember('AGENT');
      channelKey = `susp-key-${randomUUID()}`;
      const channel = await db.channel.create({
        data: {
          tenantId,
          name: 'Ventas',
          type: 'WHATSAPP',
          provider: 'SIMULATED',
          externalId: `susp-${randomUUID()}`,
        },
      });
      await db.integrationCredential.create({
        data: { tenantId, channelId: channel.id, keyHash: sha256Hex(channelKey) },
      });
    });

    it('suspender exige motivo (400) y una empresa aprobada (409 NOT_APPROVED)', async () => {
      const pending = await request_();

      await admin.post(`/api/v1/platform/tenants/${tenantId}/suspend`, {}).expect(400);
      expect((await suspend(pending.tenantId).expect(409)).body.code).toBe('NOT_APPROVED');
      expect((await unsuspend(pending.tenantId).expect(409)).body.code).toBe('NOT_APPROVED');
    });

    it('corta todo, al Owner incluido; levantarla reencola lo que tiene la ventana abierta', async () => {
      const open = await queuedMessage();
      const stale = await queuedMessage();
      const { conversationId, controlVersion } = await inbound();
      const statusBefore = await countEvents('tenant.status_changed');

      await suspend(tenantId).expect(200);
      await suspend(tenantId).expect(200);
      expect(await countEvents('tenant.status_changed')).toBe(statusBefore + 1);

      // Acceso: todo el API de empresa responde 403, incluso /tenants/current para el Owner.
      for (const client of [owner.client, agent.client]) {
        const view = await me(client);
        expect(view.activeTenantId).toBe(tenantId);
        expect(view.memberships[0]).toMatchObject({
          tenantState: 'suspended',
          suspensionReason: 'Impago de la suscripción',
        });
        for (const path of ['/api/v1/conversations', '/api/v1/tenants/current']) {
          expect((await client.get(path).expect(403)).body.code).toBe('TENANT_SUSPENDED');
        }
      }

      // Envíos: lo encolado falla con TENANT_SUSPENDED sin llamar al proveedor.
      await drain();
      for (const { messageId } of [open, stale]) {
        expect(await messageOf(messageId)).toMatchObject({
          status: 'FAILED',
          failureReason: 'TENANT_SUSPENDED',
        });
      }

      // Entrante: se guarda sin IA ni avisos; la IA recibe 409 TENANT_SUSPENDED.
      const aiBefore = await countEvents('ai.reply_requested');
      const notificationsBefore = await countEvents('notification.requested');
      const again = await inbound();
      expect(again.aiAllowed).toBe(false);
      expect(await db.message.count({ where: { conversationId: again.conversationId } })).toBe(1);
      expect(await countEvents('ai.reply_requested')).toBe(aiBefore);
      expect(await countEvents('notification.requested')).toBe(notificationsBefore);
      const ai = await integration('/api/v1/integrations/messages/outbound', {
        conversationId,
        controlVersion,
        idempotencyKey: randomUUID(),
        text: 'Respuesta',
      }).expect(409);
      expect(ai.body).toEqual({ sendAllowed: false, reason: 'TENANT_SUSPENDED' });

      // Levantar: vuelve el acceso y se reencola solo lo que tiene la ventana de 18 h abierta.
      await db.conversation.update({
        where: { id: stale.conversationId },
        data: { lastInboundAt: new Date(Date.now() - 19 * HOUR) },
      });
      await unsuspend(tenantId).expect(200);
      await unsuspend(tenantId).expect(200);
      expect(await countEvents('tenant.status_changed')).toBe(statusBefore + 2);

      await agent.client.get('/api/v1/conversations').expect(200);
      expect(await messageOf(open.messageId)).toMatchObject({
        status: 'PENDING',
        failureReason: null,
      });
      expect(await messageOf(stale.messageId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'TENANT_SUSPENDED',
      });
    });

    it('levantarla con la empresa inactiva la deja inactiva y pasa los cortes a TENANT_INACTIVE', async () => {
      const queued = await queuedMessage();
      await suspend(tenantId).expect(200);
      await drain();
      await db.tenant.update({
        where: { id: tenantId },
        data: { deactivatedAt: new Date(), deactivatedByMemberId: owner.memberId },
      });

      await unsuspend(tenantId).expect(200);

      expect((await me(owner.client)).memberships[0]).toMatchObject({ tenantState: 'inactive' });
      expect(await messageOf(queued.messageId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'TENANT_INACTIVE',
      });

      await owner.client.post('/api/v1/tenants/current/reactivate').expect(200);
      expect(await messageOf(queued.messageId)).toMatchObject({
        status: 'PENDING',
        failureReason: null,
      });
    });

    it('aceptar una invitación de una empresa suspendida responde 409 TENANT_SUSPENDED', async () => {
      const invited = await signedUpUser();
      const invite = await owner.client
        .post('/api/v1/invitations', { email: invited.user.email, role: 'AGENT' })
        .expect(201);
      const token = new URL(invite.body.url).pathname.split('/').pop()!;
      await suspend(tenantId).expect(200);

      const res = await invited.client
        .post(`/api/v1/invitations/by-token/${token}/accept`)
        .expect(409);
      expect(res.body.code).toBe('TENANT_SUSPENDED');
      await unsuspend(tenantId).expect(200);
    });

    it('un Agent con otra empresa activa pasa a ella al suspender', async () => {
      const otherTenant = await db.tenant.create({
        data: { approval: 'APPROVED', name: 'AAA Otra', slug: `otra-${unique()}` },
      });
      const user = await db.user.create({
        data: { email: `${randomUUID()}@e2e.local`, displayName: 'Doble' },
      });
      for (const id of [tenantId, otherTenant.id]) {
        await db.tenantMember.create({
          data: {
            tenantId: id,
            userId: user.id,
            email: user.email,
            displayName: 'Doble',
            role: 'AGENT',
          },
        });
      }
      const client = as(await sessionFor(app, user.id, tenantId));

      await suspend(tenantId).expect(200);

      expect((await me(client)).activeTenantId).toBe(otherTenant.id);
      await unsuspend(tenantId).expect(200);
    });
  });

  describe('login de desarrollo', () => {
    it('lista los usuarios demo y entra como usuario nuevo y como admin de plataforma', async () => {
      const providers = AuthProvidersResponseSchema.parse(
        (await http().get('/api/v1/auth/providers').expect(200)).body,
      );
      expect(providers.demoUsers.map((user) => user.demoUser)).toEqual([
        'platform-admin',
        'new-user',
      ]);

      for (const demoUser of ['platform-admin', 'new-user'] as const) {
        const res = await http()
          .post('/api/v1/auth/dev-login')
          .set('Origin', WEB_ORIGIN)
          .send({ demoUser })
          .expect(200);
        expect(MeResponseSchema.parse(res.body).isPlatformAdmin).toBe(
          demoUser === 'platform-admin',
        );
      }
    });
  });
});
