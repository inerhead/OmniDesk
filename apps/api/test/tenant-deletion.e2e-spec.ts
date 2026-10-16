import 'reflect-metadata';
import { createHmac, randomInt, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  MeResponseSchema,
  PlatformTenantDeletionsResponseSchema,
  PlatformTenantsResponseSchema,
  TenantDeletionPreviewSchema,
} from '@omnidesk/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { ATTACHMENT_STORAGE } from '../src/modules/attachments/application/ports/attachment-storage';
import { MemoryAttachmentStorage } from '../src/modules/attachments/infrastructure/memory-attachment-storage';
import { TenantPurgeJob } from '../src/modules/platform/application/tenant-purge.job';
import { TenantPurgeScheduler } from '../src/modules/platform/infrastructure/tenant-purge-scheduler';
import { OutboxDispatcher } from '../src/modules/realtime/infrastructure/outbox-dispatcher';
import { DEMO_PLATFORM_ADMIN_EMAIL } from '../src/shared/application/platform-admins';
import { sha256Hex } from '../src/shared/infrastructure/crypto/sha256';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { sessionFor, WEB_ORIGIN } from './support/session';
import { testEnv } from './support/test-env';

const unique = () => randomUUID().slice(0, 8);
const phone = () => `+57300${randomInt(1_000_000, 9_999_999)}`;
const appSecret = 'meta-app-secret-for-deletion-e2e';

describe('Plataforma: borrado de empresas (e2e)', () => {
  let app: NestExpressApplication;
  let db: PrismaService;
  let storage: MemoryAttachmentStorage;
  let job: TenantPurgeJob;
  let admin: Client;
  let adminUserId: string;
  const http = () => request(app.getHttpServer());

  type Client = ReturnType<typeof as>;
  const as = (cookie: string) => ({
    cookie,
    get: (path: string) => http().get(path).set('Cookie', cookie),
    post: (path: string, body: object = {}) =>
      http().post(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN).send(body),
  });

  const newUser = (label: string, email = `${label}-${unique()}@e2e.local`) =>
    db.user.upsert({ where: { email }, create: { email, displayName: label }, update: {} });

  const me = async (client: Client) =>
    MeResponseSchema.parse((await client.get('/api/v1/me').expect(200)).body);

  const put = (key: string) =>
    storage.put(key, Buffer.from('x'), { contentType: 'text/plain', contentLength: 1 });

  const deleteTenant = (tenantId: string, confirmSlug: string) =>
    admin.post(`/api/v1/platform/tenants/${tenantId}/delete`, { confirmSlug });
  const suspend = (tenantId: string) =>
    admin.post(`/api/v1/platform/tenants/${tenantId}/suspend`, { reason: 'Baja definitiva' });
  const preview = async (tenantId: string) =>
    TenantDeletionPreviewSchema.parse(
      (await admin.get(`/api/v1/platform/tenants/${tenantId}/deletion-preview`).expect(200)).body,
    );
  const deletions = async () =>
    PlatformTenantDeletionsResponseSchema.parse(
      (await admin.get('/api/v1/platform/tenant-deletions').expect(200)).body,
    );

  /** Empresa aprobada y activa con un Owner que solo pertenece a ella. */
  async function activeTenant(overrides: { approval?: 'PENDING'; deactivated?: boolean } = {}) {
    const slug = `borrar-${unique()}`;
    const tenant = await db.tenant.create({
      data: { name: 'Acme', slug, approval: overrides.approval ?? 'APPROVED' },
    });
    const owner = await newUser('owner');
    const ownerMember = await db.tenantMember.create({
      data: {
        tenantId: tenant.id,
        userId: owner.id,
        email: owner.email,
        displayName: 'Owner',
        role: 'OWNER',
      },
    });
    if (overrides.deactivated) {
      await db.tenant.update({
        where: { id: tenant.id },
        data: { deactivatedAt: new Date(), deactivatedByMemberId: ownerMember.id },
      });
    }
    const ownerClient = as(await sessionFor(app, owner.id, tenant.id));
    return { tenant, slug, owner, ownerMember, ownerClient };
  }

  /**
   * Empresa suspendida con datos en todas las tablas y en el bucket, y cuatro cuentas:
   * - `solo`: solo pertenece a ella (se borra, con su foto, sesiones y push);
   * - `both`: también es miembro activo de `other` (se conserva);
   * - `removedElsewhere`: en `other` solo tiene una baja (se borra);
   * - el admin de plataforma (se conserva).
   */
  async function seededTenant() {
    const base = await activeTenant({ deactivated: true });
    const { tenant, owner: solo, ownerMember: soloMember } = base;
    const tenantId = tenant.id;

    const other = await db.tenant.create({
      data: { name: 'Otra', slug: `otra-${unique()}`, approval: 'APPROVED' },
    });
    const both = await newUser('both');
    const removedElsewhere = await newUser('removed');
    const member = (
      tenantId: string,
      user: { id: string; email: string },
      role: 'ADMIN' | 'AGENT',
    ) =>
      db.tenantMember.create({
        data: { tenantId, userId: user.id, email: user.email, displayName: 'Miembro', role },
      });
    const bothMember = await member(tenantId, both, 'AGENT');
    await member(tenantId, removedElsewhere, 'ADMIN');
    await member(tenantId, { id: adminUserId, email: DEMO_PLATFORM_ADMIN_EMAIL }, 'AGENT');
    await member(other.id, both, 'AGENT');
    const removedRow = await db.tenantMember.create({
      data: {
        tenantId: other.id,
        userId: removedElsewhere.id,
        email: removedElsewhere.email,
        displayName: 'Dado de baja',
        role: 'AGENT',
        removedAt: new Date(),
      },
    });

    const logoKey = `tenants/${tenantId}/logo-${unique()}`;
    const soloAvatar = `users/${solo.id}/avatar-${unique()}`;
    const bothAvatar = `users/${both.id}/avatar-${unique()}`;
    await db.tenant.update({ where: { id: tenantId }, data: { logoKey } });
    await db.user.update({
      where: { id: solo.id },
      data: { avatarKey: soloAvatar, avatarUpdatedAt: new Date() },
    });
    await db.pushSubscription.create({
      data: {
        userId: solo.id,
        endpoint: `https://push.example.com/${unique()}`,
        p256dh: 'p',
        auth: 'a',
      },
    });

    const channel = await db.channel.create({
      data: {
        tenantId,
        name: 'Ventas',
        type: 'WHATSAPP',
        provider: 'N8N',
        externalId: `ext-${unique()}`,
      },
    });
    // Canal sin secreto HMAC: la integración entra sin firma, solo con la API key.
    const apiKey = `odk_${unique()}${unique()}`;
    await db.integrationCredential.create({
      data: { tenantId, channelId: channel.id, keyHash: sha256Hex(apiKey) },
    });
    await db.eventInbox.create({ data: { channelId: channel.id, externalId: `m:${unique()}` } });
    const contact = await db.contact.create({ data: { tenantId, displayName: 'Cliente' } });
    await db.contactIdentity.create({
      data: { tenantId, contactId: contact.id, channelId: channel.id, externalId: phone() },
    });
    const conversation = await db.conversation.create({
      data: {
        tenantId,
        channelId: channel.id,
        contactId: contact.id,
        assignedAgentId: bothMember.id,
        lastSequence: 3,
        lastMessageAt: new Date(),
        lastMessagePreview: 'Hola',
      },
    });
    const inbound = await db.message.create({
      data: {
        tenantId,
        channelId: channel.id,
        conversationId: conversation.id,
        sequence: 1,
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        text: 'Hola',
        status: 'RECEIVED',
      },
    });
    await db.message.create({
      data: {
        tenantId,
        channelId: channel.id,
        conversationId: conversation.id,
        sequence: 2,
        direction: 'OUTBOUND',
        senderType: 'AGENT',
        senderMemberId: soloMember.id,
        text: 'Buenas',
        status: 'SENT',
      },
    });
    const attachmentKey = `tenants/${tenantId}/attachments/${randomUUID()}`;
    await db.messageAttachment.create({
      data: {
        tenantId,
        messageId: inbound.id,
        kind: 'IMAGE',
        mimeType: 'image/png',
        storageKey: attachmentKey,
        status: 'READY',
      },
    });
    await db.conversationEvent.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        sequence: 3,
        type: 'ASSIGNED',
        actorMemberId: soloMember.id,
        targetMemberId: bothMember.id,
      },
    });
    await db.invitation.create({
      data: {
        tenantId,
        email: `invitado-${unique()}@e2e.local`,
        role: 'AGENT',
        tokenHash: randomUUID(),
        invitedById: soloMember.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await db.outboxEvent.create({
      data: { tenantId, type: 'conversation.changed', payload: {}, publishedAt: new Date() },
    });
    await db.deletionLog.create({
      data: { tenantId, kind: 'contact', conversationsDeleted: 1, messagesDeleted: 1 },
    });

    const orphanOutbound = `tenants/${tenantId}/attachments/out-${unique()}`;
    const otherLogo = `tenants/${other.id}/logo-${unique()}`;
    for (const key of [logoKey, attachmentKey, orphanOutbound, otherLogo, soloAvatar, bothAvatar]) {
      await put(key);
    }

    const soloClient = base.ownerClient;
    const bothClient = as(await sessionFor(app, both.id, tenantId));
    await suspend(tenantId).expect(200);

    return {
      ...base,
      apiKey,
      tenantId,
      other,
      solo,
      both,
      bothClient,
      soloClient,
      removedElsewhere,
      removedRow,
      otherLogo,
      bothAvatar,
    };
  }

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
    // El dispatcher y el job se ejecutan a mano para controlar qué pasa y cuándo.
    await app.get(OutboxDispatcher).onModuleDestroy();
    await app.get(TenantPurgeScheduler).onModuleDestroy();
    db = app.get(PrismaService);
    storage = app.get<MemoryAttachmentStorage>(ATTACHMENT_STORAGE);
    job = app.get(TenantPurgeJob);
    const adminUser = await newUser('admin', DEMO_PLATFORM_ADMIN_EMAIL);
    adminUserId = adminUser.id;
    admin = as(await sessionFor(app, adminUserId));
  });

  afterAll(async () => {
    // No dejar empresas en borrado para el job de los demás archivos.
    if (job) await job.run();
    await app?.close();
  });

  describe('pedir el borrado', () => {
    it.each([
      ['activa', {}],
      ['inactiva', { deactivated: true }],
      ['en revisión', { approval: 'PENDING' as const }],
    ])('una empresa %s responde 409 NOT_SUSPENDED y no cambia nada', async (_label, options) => {
      const { tenant, slug } = await activeTenant(options);

      const res = await deleteTenant(tenant.id, slug).expect(409);

      expect(res.body.code).toBe('NOT_SUSPENDED');
      const row = await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
      expect(row.deletionRequestedAt).toBeNull();
      expect(await db.tenantDeletion.count({ where: { tenantId: tenant.id } })).toBe(0);
    });

    it('con DEMO_MODE=true, la empresa demo responde 409 DEMO_TENANT_LOCKED', async () => {
      const demo = await db.tenant.findUniqueOrThrow({ where: { slug: 'demo' } });

      const res = await deleteTenant(demo.id, 'demo').expect(409);

      expect(res.body.code).toBe('DEMO_TENANT_LOCKED');
      expect(
        (await db.tenant.findUniqueOrThrow({ where: { id: demo.id } })).deletionRequestedAt,
      ).toBeNull();
    });

    it('un slug distinto responde 400 CONFIRMATION_MISMATCH y no cambia nada', async () => {
      const { tenant, slug } = await activeTenant();
      await suspend(tenant.id).expect(200);

      for (const confirmSlug of [`${slug}x`, ` ${slug}`, slug.toUpperCase(), '']) {
        const res = await deleteTenant(tenant.id, confirmSlug).expect(400);
        expect(res.body.code).toBe('CONFIRMATION_MISMATCH');
      }
      expect(
        (await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).deletionRequestedAt,
      ).toBeNull();
    });

    it('quien no es admin recibe 404 en el borrado, la vista previa y las constancias', async () => {
      const { tenant, slug, ownerClient } = await activeTenant();
      await suspend(tenant.id).expect(200);

      await ownerClient
        .post(`/api/v1/platform/tenants/${tenant.id}/delete`, { confirmSlug: slug })
        .expect(404);
      await ownerClient.get(`/api/v1/platform/tenants/${tenant.id}/deletion-preview`).expect(404);
      await ownerClient.get('/api/v1/platform/tenant-deletions').expect(404);
      expect(
        (await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).deletionRequestedAt,
      ).toBeNull();
    });

    it('una empresa que no existe responde 404', async () => {
      await deleteTenant(randomUUID(), 'nada').expect(404);
      await admin.get(`/api/v1/platform/tenants/${randomUUID()}/deletion-preview`).expect(404);
    });

    it('responde 202, y repetirlo responde 202 sin crear otra constancia', async () => {
      const { tenantId, slug } = await seededTenant();

      await deleteTenant(tenantId, slug).expect(202);
      await deleteTenant(tenantId, slug).expect(202);

      const row = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(row.deletionRequestedAt).not.toBeNull();
      expect(await db.tenantDeletion.findMany({ where: { tenantId } })).toEqual([
        expect.objectContaining({
          tenantSlug: slug,
          requestedByUserId: adminUserId,
          requestedByEmail: DEMO_PLATFORM_ADMIN_EMAIL,
          completedAt: null,
        }),
      ]);
    });

    it('al instante la empresa sale de /me, de Aprobadas y de las sesiones, y no se suspende más', async () => {
      const { tenantId, slug, other, soloClient, bothClient } = await seededTenant();

      await deleteTenant(tenantId, slug).expect(202);

      const soloMe = await me(soloClient);
      expect(soloMe.memberships).toEqual([]);
      expect(soloMe.activeTenantId).toBeNull();
      const bothMe = await me(bothClient);
      expect(bothMe.memberships.map((m) => m.tenantId)).toEqual([other.id]);
      expect(bothMe.activeTenantId).toBe(other.id);
      expect(await db.session.count({ where: { activeTenantId: tenantId } })).toBe(0);
      await soloClient.get('/api/v1/conversations').expect(403);

      const approved = PlatformTenantsResponseSchema.parse(
        (await admin.get('/api/v1/platform/tenants?status=approved').expect(200)).body,
      );
      expect(approved.map((row) => row.id)).not.toContain(tenantId);

      for (const res of [
        await suspend(tenantId),
        await admin.post(`/api/v1/platform/tenants/${tenantId}/unsuspend`),
      ]) {
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('TENANT_DELETING');
      }
    });

    it('un WhatsApp entrante a un canal de la empresa en borrado no crea ninguna fila', async () => {
      const { tenant, slug, ownerClient } = await activeTenant();
      const externalId = `${Date.now()}${randomInt(100_000)}`;
      const created = await ownerClient
        .post('/api/v1/channels', {
          name: 'Ventas',
          phoneNumber: '+573009999999',
          externalId,
          provider: 'WHATSAPP_CLOUD',
        })
        .expect(201);
      const channelId = created.body.id as string;
      await http()
        .patch(`/api/v1/channels/${channelId}/whatsapp`)
        .set('Cookie', ownerClient.cookie)
        .set('Origin', WEB_ORIGIN)
        .send({
          accessToken: 'meta-access-token',
          appSecret,
          verifyToken: 'meta-verify-token-for-e2e-123456',
        })
        .expect(200);
      await suspend(tenant.id).expect(200);
      await deleteTenant(tenant.id, slug).expect(202);
      // La suspensión dejó su `tenant.status_changed` en el Outbox: se compara antes y después.
      const outboxBefore = await db.outboxEvent.count({ where: { tenantId: tenant.id } });

      const raw = JSON.stringify({
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
                      text: { body: 'Hola' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
      await http()
        .post(`/api/v1/integrations/whatsapp/${channelId}`)
        .set('Content-Type', 'application/json')
        .set(
          'X-Hub-Signature-256',
          `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}`,
        )
        .send(raw)
        .expect(404);

      expect(await db.contact.count({ where: { tenantId: tenant.id } })).toBe(0);
      expect(await db.message.count({ where: { tenantId: tenant.id } })).toBe(0);
      expect(await db.outboxEvent.count({ where: { tenantId: tenant.id } })).toBe(outboxBefore);
    });
  });

  it('la integración (n8n) de un canal de la empresa en borrado recibe 401 y no guarda nada', async () => {
    const { tenantId, slug, apiKey } = await seededTenant();
    const inbound = () =>
      http()
        .post('/api/v1/integrations/messages/inbound')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          externalMessageId: randomUUID(),
          from: { externalId: phone(), displayName: 'Cliente' },
          text: 'Hola',
          sentAt: new Date().toISOString(),
        });
    // Suspendida, lo entrante se guarda (SPEC 18); en borrado, el canal es desconocido.
    await inbound().expect(201);
    const messages = await db.message.count({ where: { tenantId } });

    await deleteTenant(tenantId, slug).expect(202);
    await inbound().expect(401);

    expect(await db.message.count({ where: { tenantId } })).toBe(messages);
  });

  describe('vista previa', () => {
    it('cuenta miembros, cuentas huérfanas, conversaciones, mensajes y adjuntos', async () => {
      const { tenantId } = await seededTenant();

      // `solo` y `removedElsewhere` se borrarían; `both` tiene otra empresa y el admin nunca.
      expect(await preview(tenantId)).toEqual({
        members: 4,
        accountsToDelete: 2,
        conversations: 1,
        messages: 2,
        attachments: 1,
      });
    });
  });

  describe('job de borrado', () => {
    it('borra filas, bucket y cuentas huérfanas; la constancia coincide con la vista previa', async () => {
      const seeded = await seededTenant();
      const { tenantId, slug, solo, both, removedElsewhere, removedRow, other } = seeded;
      const expected = await preview(tenantId);
      await deleteTenant(tenantId, slug).expect(202);

      const before = (await deletions()).find((row) => row.tenantSlug === slug);
      expect(before).toMatchObject({ completedAt: null, conversationsDeleted: 0 });

      const results = await job.run();
      expect(results?.find((result) => result.tenantId === tenantId)?.failed).toBe(false);

      const scope = { where: { tenantId } };
      const leftovers = {
        tenants: await db.tenant.count({ where: { id: tenantId } }),
        channels: await db.channel.count(scope),
        credentials: await db.integrationCredential.count(scope),
        contacts: await db.contact.count(scope),
        identities: await db.contactIdentity.count(scope),
        conversations: await db.conversation.count(scope),
        messages: await db.message.count(scope),
        attachments: await db.messageAttachment.count(scope),
        events: await db.conversationEvent.count(scope),
        invitations: await db.invitation.count(scope),
        members: await db.tenantMember.count(scope),
        outbox: await db.outboxEvent.count(scope),
        deletionLog: await db.deletionLog.count(scope),
      };
      expect(Object.values(leftovers).every((count) => count === 0)).toBe(true);
      expect(storage.keys().filter((key) => key.startsWith(`tenants/${tenantId}/`))).toEqual([]);
      expect(storage.keys()).toEqual(expect.arrayContaining([seeded.otherLogo, seeded.bothAvatar]));

      // Cuentas huérfanas: fila, sesiones, push y foto.
      for (const user of [solo, removedElsewhere]) {
        expect(await db.user.count({ where: { id: user.id } })).toBe(0);
        expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
        expect(await db.pushSubscription.count({ where: { userId: user.id } })).toBe(0);
        expect(storage.keys().some((key) => key.startsWith(`users/${user.id}/`))).toBe(false);
      }
      await seeded.soloClient.get('/api/v1/me').expect(401);
      // La baja de `removedElsewhere` en la otra empresa conserva nombre y email, sin cuenta.
      expect(
        await db.tenantMember.findUniqueOrThrow({ where: { id: removedRow.id } }),
      ).toMatchObject({ userId: null, email: removedElsewhere.email });

      // Se conservan: quien tiene otra empresa y el admin de plataforma.
      expect(await db.user.count({ where: { id: both.id } })).toBe(1);
      expect((await me(seeded.bothClient)).activeTenantId).toBe(other.id);
      expect(await db.user.count({ where: { id: adminUserId } })).toBe(1);

      const after = (await deletions()).find((row) => row.tenantSlug === slug);
      expect(after).toMatchObject({
        completedAt: expect.any(String),
        membersDeleted: expected.members,
        usersDeleted: expected.accountsToDelete,
        conversationsDeleted: expected.conversations,
        messagesDeleted: expected.messages,
        attachmentsDeleted: expected.attachments,
      });

      // El slug queda libre.
      const newcomer = as(await sessionFor(app, (await newUser('nuevo')).id));
      await newcomer
        .post('/api/v1/tenants', { name: 'Acme otra vez', slug, contactPhone: phone() })
        .expect(201);
    });

    it('si el bucket falla, guarda el error, la empresa sigue en borrado y la siguiente pasada termina', async () => {
      const { tenantId, slug } = await seededTenant();
      await deleteTenant(tenantId, slug).expect(202);
      const original = storage.deletePrefix.bind(storage);
      storage.deletePrefix = async () => {
        throw new Error('MinIO caído');
      };
      try {
        await job.run();
      } finally {
        storage.deletePrefix = original;
      }

      const failed = await db.tenantDeletion.findUniqueOrThrow({ where: { tenantId } });
      expect(failed).toMatchObject({ lastError: 'MinIO caído', completedAt: null });
      expect(await db.tenant.count({ where: { id: tenantId } })).toBe(1);

      await job.run();

      expect(await db.tenant.count({ where: { id: tenantId } })).toBe(0);
      expect(await db.tenantDeletion.findUniqueOrThrow({ where: { tenantId } })).toMatchObject({
        lastError: null,
        completedAt: expect.any(Date),
        conversationsDeleted: 1,
        messagesDeleted: 2,
        attachmentsDeleted: 1,
        objectsDeleted: 3,
        membersDeleted: 4,
        usersDeleted: 2,
      });
    });
  });
});
