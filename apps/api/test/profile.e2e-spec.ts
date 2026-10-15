import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  AuthProvidersResponseSchema,
  ListConversationsResponseSchema,
  ListMembersResponseSchema,
  ListTimelineResponseSchema,
  MeResponseSchema,
} from '@omnidesk/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from '../src/modules/attachments/application/ports/attachment-storage';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../src/modules/identity/application/ports/user.repository';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { sessionFor, WEB_ORIGIN } from './support/session';
import { testEnv } from './support/test-env';

const GOOGLE_PHOTO = 'https://lh3.googleusercontent.com/a/e2e';
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(64, 2),
]);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

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

describe('Foto de perfil (e2e)', () => {
  let app: NestExpressApplication;
  let db: PrismaService;
  let storage: AttachmentStorage;
  let tenantId: string;
  let owner: { userId: string; memberId: string; cookie: string };
  let agent: { userId: string; memberId: string; cookie: string };
  const http = () => request(app.getHttpServer());

  const addMember = async (role: 'OWNER' | 'AGENT', name: string, tenant = tenantId) => {
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@e2e.local`,
        displayName: name,
        googleSub: `g-${randomUUID()}`,
        googleAvatarUrl: GOOGLE_PHOTO,
      },
    });
    const member = await db.tenantMember.create({
      data: { tenantId: tenant, userId: user.id, email: user.email, displayName: name, role },
    });
    return { userId: user.id, memberId: member.id, cookie: await sessionFor(app, user.id, tenant) };
  };
  const upload = (cookie: string, bytes: Buffer, name = 'avatar.webp') =>
    http()
      .put('/api/v1/me/avatar')
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .attach('file', bytes, name);
  const keyOf = async (userId: string) =>
    (await db.user.findUniqueOrThrow({ where: { id: userId } })).avatarKey;
  const exists = (key: string) =>
    storage.get(key).then(
      () => true,
      () => false,
    );

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
    storage = app.get(ATTACHMENT_STORAGE);
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    tenantId = (
      await db.tenant.create({
        data: { approval: 'APPROVED', name: 'Fotos', slug: `fotos-${randomUUID()}` },
      })
    ).id;
    owner = await addMember('OWNER', 'Owner');
    agent = await addMember('AGENT', 'Agente');
  });

  describe('lecturas con foto', () => {
    it('la foto de Google aparece en /me, miembros, asignado, remitente y eventos', async () => {
      const channel = await db.channel.create({
        data: {
          tenantId,
          name: 'WA',
          type: 'WHATSAPP',
          provider: 'SIMULATED',
          externalId: randomUUID(),
        },
      });
      const contact = await db.contact.create({ data: { tenantId, displayName: 'Ana' } });
      const conversation = await db.conversation.create({
        data: {
          tenantId,
          channelId: channel.id,
          contactId: contact.id,
          assignedAgentId: agent.memberId,
          lastSequence: 2,
          lastMessageAt: new Date(),
          lastMessagePreview: 'Hola',
        },
      });
      await db.message.create({
        data: {
          tenantId,
          channelId: channel.id,
          conversationId: conversation.id,
          sequence: 1,
          direction: 'OUTBOUND',
          senderType: 'AGENT',
          senderMemberId: agent.memberId,
          text: 'Hola',
          status: 'SENT',
        },
      });
      await db.conversationEvent.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          sequence: 2,
          type: 'ASSIGNED',
          actorMemberId: owner.memberId,
          targetMemberId: agent.memberId,
        },
      });

      const me = MeResponseSchema.parse(
        (await http().get('/api/v1/me').set('Cookie', agent.cookie).expect(200)).body,
      );
      expect(me.user.avatarUrl).toBe(GOOGLE_PHOTO);

      const members = ListMembersResponseSchema.parse(
        (await http().get('/api/v1/members').set('Cookie', owner.cookie).expect(200)).body,
      );
      expect(members.items.find((item) => item.id === agent.memberId)?.avatarUrl).toBe(
        GOOGLE_PHOTO,
      );

      const list = ListConversationsResponseSchema.parse(
        (
          await http()
            .get('/api/v1/conversations?inbox=all')
            .set('Cookie', owner.cookie)
            .expect(200)
        ).body,
      );
      expect(list.items[0]?.assignedAgent?.avatarUrl).toBe(GOOGLE_PHOTO);

      const timeline = ListTimelineResponseSchema.parse(
        (
          await http()
            .get(`/api/v1/conversations/${conversation.id}/timeline`)
            .set('Cookie', owner.cookie)
            .expect(200)
        ).body,
      );
      const message = timeline.items.find((item) => item.kind === 'message');
      const event = timeline.items.find((item) => item.kind === 'event');
      expect(message?.kind === 'message' && message.sender?.avatarUrl).toBe(GOOGLE_PHOTO);
      expect(event?.kind === 'event' && event.target?.avatarUrl).toBe(GOOGLE_PHOTO);
    });

    it('un miembro sin usuario enlazado no tiene foto', async () => {
      const legacy = await db.tenantMember.create({
        data: {
          tenantId,
          email: `${randomUUID()}@e2e.local`,
          displayName: 'Antiguo',
          role: 'AGENT',
        },
      });
      const members = ListMembersResponseSchema.parse(
        (await http().get('/api/v1/members').set('Cookie', owner.cookie).expect(200)).body,
      );
      expect(members.items.find((item) => item.id === legacy.id)?.avatarUrl).toBeNull();
    });
  });

  describe('subir, ver, cambiar y quitar', () => {
    it('la foto subida gana a la de Google y se sirve con caché larga', async () => {
      const res = await upload(agent.cookie, webp).expect(200);
      const user = MeResponseSchema.shape.user.parse(res.body);
      expect(user.avatarUrl).toMatch(new RegExp(`^/api/v1/users/${agent.userId}/avatar\\?v=\\d+$`));

      const me = MeResponseSchema.parse(
        (await http().get('/api/v1/me').set('Cookie', agent.cookie).expect(200)).body,
      );
      expect(me.user.avatarUrl).toBe(user.avatarUrl);

      const photo = await http().get(user.avatarUrl!).set('Cookie', owner.cookie).expect(200);
      expect(photo.headers['content-type']).toBe('image/webp');
      expect(photo.headers['x-content-type-options']).toBe('nosniff');
      expect(photo.headers['content-security-policy']).toContain('sandbox');
      expect(photo.headers['cache-control']).toBe('private, max-age=31536000, immutable');
      expect(Buffer.compare(photo.body as Buffer, webp)).toBe(0);
    });

    it('cambiar borra el objeto anterior', async () => {
      await upload(agent.cookie, webp).expect(200);
      const first = (await keyOf(agent.userId))!;
      await upload(agent.cookie, jpeg, 'avatar.jpg').expect(200);
      const second = (await keyOf(agent.userId))!;
      expect(second).not.toBe(first);
      expect(second.startsWith(`users/${agent.userId}/avatar-`)).toBe(true);
      expect(await exists(first)).toBe(false);
      expect(await exists(second)).toBe(true);
      const photo = await http()
        .get(`/api/v1/users/${agent.userId}/avatar`)
        .set('Cookie', agent.cookie)
        .expect(200);
      expect(photo.headers['content-type']).toBe('image/jpeg');
    });

    it('quitar vuelve a la foto de Google y borra el objeto', async () => {
      await upload(agent.cookie, webp).expect(200);
      const key = (await keyOf(agent.userId))!;
      const res = await http()
        .delete('/api/v1/me/avatar')
        .set('Cookie', agent.cookie)
        .set('Origin', WEB_ORIGIN)
        .expect(200);
      expect(res.body.avatarUrl).toBe(GOOGLE_PHOTO);
      expect(await keyOf(agent.userId)).toBeNull();
      expect(await exists(key)).toBe(false);
      await http()
        .get(`/api/v1/users/${agent.userId}/avatar`)
        .set('Cookie', agent.cookie)
        .expect(404);
    });

    it('un nuevo login con Google no pisa la foto subida', async () => {
      const uploaded = MeResponseSchema.shape.user.parse(
        (await upload(agent.cookie, webp).expect(200)).body,
      );
      const { googleSub, email } = await db.user.findUniqueOrThrow({
        where: { id: agent.userId },
      });
      const user = await app.get<UserRepository>(USER_REPOSITORY).upsertFromGoogle({
        googleSub: googleSub!,
        email,
        displayName: 'Agente',
        avatarUrl: 'https://lh3.googleusercontent.com/a/otra',
      });
      expect(user.avatarUrl).toBe(uploaded.avatarUrl);
      const row = await db.user.findUniqueOrThrow({ where: { id: agent.userId } });
      expect(row.googleAvatarUrl).toBe('https://lh3.googleusercontent.com/a/otra');
      expect(row.avatarKey).not.toBeNull();
    });

    it('rechaza PNG (415), más de 1 MB (413), sin archivo (400) y sin sesión (401)', async () => {
      await upload(agent.cookie, png, 'avatar.png').expect(415);
      await upload(agent.cookie, Buffer.from('no es una imagen'), 'avatar.webp').expect(415);
      const big = Buffer.concat([jpeg, Buffer.alloc(1024 * 1024)]);
      await upload(agent.cookie, big, 'avatar.jpg').expect(413);
      await http()
        .put('/api/v1/me/avatar')
        .set('Cookie', agent.cookie)
        .set('Origin', WEB_ORIGIN)
        .expect(400);
      await http()
        .put('/api/v1/me/avatar')
        .set('Origin', WEB_ORIGIN)
        .attach('file', webp, 'avatar.webp')
        .expect(401);
      expect(await keyOf(agent.userId)).toBeNull();
    });
  });

  describe('quién ve la foto', () => {
    it('404 a quien no comparte la empresa activa; la baja se sigue viendo', async () => {
      await upload(agent.cookie, webp).expect(200);
      const path = `/api/v1/users/${agent.userId}/avatar`;

      const otherTenant = (
        await db.tenant.create({
          data: { approval: 'APPROVED', name: 'Otra', slug: `otra-${randomUUID()}` },
        })
      ).id;
      const stranger = await addMember('OWNER', 'Ajeno', otherTenant);
      await http().get(path).set('Cookie', stranger.cookie).expect(404);

      await db.tenantMember.update({
        where: { id: agent.memberId },
        data: { removedAt: new Date() },
      });
      await http().get(path).set('Cookie', owner.cookie).expect(200);
    });

    it('404 sin foto subida y 401 sin sesión para un usuario de Google', async () => {
      await http()
        .get(`/api/v1/users/${owner.userId}/avatar`)
        .set('Cookie', agent.cookie)
        .expect(404);
      await upload(agent.cookie, webp).expect(200);
      await http().get(`/api/v1/users/${agent.userId}/avatar`).expect(401);
    });

    it('con DEMO_MODE, un usuario demo se ve sin sesión y aparece en el login', async () => {
      const demoUser = await db.user.update({
        where: { id: agent.userId },
        data: { googleSub: null, googleAvatarUrl: null },
      });
      await upload(agent.cookie, webp).expect(200);
      await http().get(`/api/v1/users/${demoUser.id}/avatar`).expect(200);

      const demoMember = await db.tenantMember.findFirstOrThrow({
        where: { tenant: { slug: 'demo' }, removedAt: null, userId: { not: null } },
        select: { userId: true },
      });
      const demoUserId = demoMember.userId!;
      await db.user.update({
        where: { id: demoUserId },
        data: { avatarKey: (await keyOf(agent.userId))!, avatarUpdatedAt: new Date() },
      });
      try {
        const providers = AuthProvidersResponseSchema.parse(
          (await http().get('/api/v1/auth/providers').expect(200)).body,
        );
        expect(providers.demoMembers.some((member) => member.avatarUrl?.startsWith('/api/'))).toBe(
          true,
        );
      } finally {
        await db.user.update({
          where: { id: demoUserId },
          data: { avatarKey: null, avatarUpdatedAt: null },
        });
      }

      // Quitar la foto de un usuario demo deja las iniciales (sin foto de Google).
      const removed = await http()
        .delete('/api/v1/me/avatar')
        .set('Cookie', agent.cookie)
        .set('Origin', WEB_ORIGIN)
        .expect(200);
      expect(removed.body.avatarUrl).toBeNull();
    });
  });
});

describe('Foto de perfil sin DEMO_MODE (e2e)', () => {
  let app: NestExpressApplication;
  let db: PrismaService;

  beforeAll(async () => {
    app = await createApp({ DEMO_MODE: 'false' });
    db = app.get(PrismaService);
  });
  afterAll(() => app.close());

  it('la foto de un usuario demo sin sesión responde 401', async () => {
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@e2e.local`,
        displayName: 'Demo',
        avatarKey: 'users/x/avatar-y',
        avatarUpdatedAt: new Date(),
      },
    });
    await request(app.getHttpServer()).get(`/api/v1/users/${user.id}/avatar`).expect(401);
  });
});
