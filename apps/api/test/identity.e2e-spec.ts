import 'reflect-metadata';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  CreateInvitationResponseSchema,
  InvitationPreviewSchema,
  ListConversationsResponseSchema,
  ListInvitationsResponseSchema,
  ListMembersResponseSchema,
  ListTimelineResponseSchema,
  MeResponseSchema,
  SESSION_COOKIE,
} from '@omnidesk/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { sha256Hex } from '../src/shared/infrastructure/crypto/sha256';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { devLogin, sessionCookieFrom, sessionFor, WEB_ORIGIN } from './support/session';
import { testEnv } from './support/test-env';

async function createApp(overrides: Record<string, string> = {}): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(testEnv(overrides))],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    rawBody: true,
  });
  configureApp(app, testEnv(overrides));
  await app.init();
  return app;
}

const unique = () => randomUUID().slice(0, 8);
const phone = () => `+57300${randomInt(1_000_000, 9_999_999)}`;

describe('Identidad y tenancy (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let laura: string;
  const http = () => request(app.getHttpServer());

  /** Peticiones de la web con una cookie de sesión (y el Origin que exige `OriginGuard`). */
  const as = (cookie: string) => ({
    get: (path: string) => http().get(path).set('Cookie', cookie),
    post: (path: string, body?: object) =>
      http().post(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN).send(body),
    patch: (path: string, body: object) =>
      http().patch(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN).send(body),
    delete: (path: string) => http().delete(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN),
  });

  const newUser = (name = 'Persona') =>
    prisma.user.create({
      data: { email: `user-${unique()}@e2e.local`, displayName: name },
    });

  /** Usuario sin empresas con su sesión. */
  async function signedUpUser(name?: string) {
    const user = await newUser(name);
    const cookie = await sessionFor(app, user.id);
    return { user, cookie, client: as(cookie) };
  }

  /** La plataforma aprueba la empresa (SPEC 18), directo en la base. */
  const approve = (tenantId: string) =>
    prisma.tenant.update({ where: { id: tenantId }, data: { approval: 'APPROVED' } });

  /** Empresa nueva creada por un usuario nuevo (OWNER) y aprobada, con su sesión. */
  async function newCompany(ownerName = 'Dueña') {
    const owner = await signedUpUser(ownerName);
    const slug = `acme-${unique()}`;
    const res = await owner.client
      .post('/api/v1/tenants', { name: 'Acme', slug, contactPhone: phone() })
      .expect(201);
    await approve(res.body.id as string);
    return { ...owner, tenantId: res.body.id as string, slug };
  }

  /** Invita a un usuario nuevo con `role` y acepta: devuelve su sesión en la empresa. */
  async function join(
    inviter: ReturnType<typeof as>,
    role: 'ADMIN' | 'AGENT',
    name = role === 'ADMIN' ? 'Admin' : 'Agente',
  ) {
    const member = await signedUpUser(name);
    const invite = await inviter
      .post('/api/v1/invitations', { email: member.user.email, role })
      .expect(201);
    const token = new URL(invite.body.url).pathname.split('/').pop()!;
    await member.client.post(`/api/v1/invitations/by-token/${token}/accept`).expect(204);
    const memberId = (
      await prisma.tenantMember.findFirstOrThrow({ where: { userId: member.user.id } })
    ).id;
    return { ...member, memberId };
  }

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    laura = (
      await prisma.tenantMember.findFirstOrThrow({ where: { email: 'laura@demo.omnidesk.local' } })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('sesión y login', () => {
    it('dev-login crea una cookie HttpOnly y SameSite=Lax; GET /me devuelve a Laura en el tenant demo', async () => {
      const res = await http()
        .post('/api/v1/auth/dev-login')
        .set('Origin', WEB_ORIGIN)
        .send({ memberId: laura })
        .expect(200);

      const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join('\n');
      expect(setCookie).toMatch(new RegExp(`${SESSION_COOKIE}=[^;]+;`));
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
      expect(setCookie).toMatch(/Path=\/omnidesk(;|$)/m);

      const me = MeResponseSchema.parse(
        (await as(sessionCookieFrom(res.headers['set-cookie'])).get('/api/v1/me').expect(200)).body,
      );
      expect(me.user.displayName).toBe('Laura');
      expect(me.memberships).toEqual([
        expect.objectContaining({ memberId: laura, tenantSlug: 'demo', role: 'AGENT' }),
      ]);
      expect(me.activeTenantId).toBe(me.memberships[0]!.tenantId);
    });

    it('la tabla sessions guarda el sha256 del token, nunca el token', async () => {
      const cookie = await devLogin(app, laura);
      const token = cookie.slice(SESSION_COOKIE.length + 1);

      const hash = createHash('sha256').update(token).digest('hex');
      expect(await prisma.session.count({ where: { tokenHash: hash } })).toBe(1);
      expect(await prisma.session.count({ where: { tokenHash: token } })).toBe(0);
    });

    it('logout invalida la sesión: GET /me posterior responde 401', async () => {
      const client = as(await devLogin(app, laura));

      await client.post('/api/v1/auth/logout').expect(204);

      const res = await client.get('/api/v1/me').expect(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('una sesión vencida responde 401', async () => {
      const cookie = await devLogin(app, laura);
      const hash = sha256Hex(cookie.slice(SESSION_COOKIE.length + 1));
      await prisma.session.update({
        where: { tokenHash: hash },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      await as(cookie).get('/api/v1/conversations').expect(401);
    });

    it('un POST con un Origin ajeno o sin Origin responde 403', async () => {
      const cookie = await devLogin(app, laura);

      await http()
        .post('/api/v1/auth/logout')
        .set('Cookie', cookie)
        .set('Origin', 'https://otro.com')
        .expect(403);
      await http().post('/api/v1/tenants').set('Cookie', cookie).send({}).expect(403);
      await as(cookie).get('/api/v1/me').expect(200);
    });

    it('providers lista los miembros demo y no ofrece Google sin cliente OAuth', async () => {
      const res = await http().get('/api/v1/auth/providers').expect(200);

      expect(res.body.google).toBe(false);
      expect(res.body.demoMembers.map((m: { displayName: string }) => m.displayName)).toEqual(
        expect.arrayContaining(['Sup. Demo', 'Laura', 'Mateo']),
      );
      await http().get('/api/v1/auth/google').expect(404);
    });
  });

  describe('Google OAuth', () => {
    let google: NestExpressApplication;

    beforeAll(async () => {
      google = await createApp({
        GOOGLE_CLIENT_ID: 'e2e-client-id',
        GOOGLE_CLIENT_SECRET: 'e2e-client-secret',
      });
    });

    afterAll(async () => {
      await google.close();
    });

    it('redirige a Google con un state firmado; next externo se descarta', async () => {
      const res = await request(google.getHttpServer())
        .get('/api/v1/auth/google')
        .query({ next: 'https://evil.com' })
        .expect(302);

      const location = new URL(res.headers.location!);
      expect(location.hostname).toBe('accounts.google.com');
      expect(location.searchParams.get('client_id')).toBe('e2e-client-id');
      const payload = location.searchParams.get('state')!.split('.')[0]!;
      expect(JSON.parse(Buffer.from(payload, 'base64url').toString()).next).toBeNull();
      expect(([] as string[]).concat(res.headers['set-cookie'] ?? []).join()).toMatch(
        /omnidesk_oauth=.+Path=\/omnidesk\/api\/v1\/auth\/google.+HttpOnly/i,
      );
    });

    it('un callback con un state inválido vuelve a /login?error=oauth sin sesión', async () => {
      const res = await request(google.getHttpServer())
        .get('/api/v1/auth/google/callback')
        .query({ state: 'falso', code: 'x' })
        .expect(302);

      expect(res.headers.location).toBe('http://localhost:8080/omnidesk/login?error=oauth');
      expect(([] as string[]).concat(res.headers['set-cookie'] ?? []).join()).not.toContain(
        `${SESSION_COOKIE}=`,
      );
    });
  });

  describe('dev-login sin DEMO_MODE', () => {
    it('responde 404', async () => {
      const closed = await createApp({ DEMO_MODE: 'false' });
      try {
        await request(closed.getHttpServer())
          .post('/api/v1/auth/dev-login')
          .set('Origin', WEB_ORIGIN)
          .send({ memberId: laura })
          .expect(404);
      } finally {
        await closed.close();
      }
    });
  });

  describe('empresas', () => {
    it('sin empresas: /me vacío y la bandeja responde 403 NO_ACTIVE_TENANT', async () => {
      const { client } = await signedUpUser();

      expect((await client.get('/api/v1/me').expect(200)).body).toMatchObject({
        memberships: [],
        activeTenantId: null,
      });
      const res = await client.get('/api/v1/conversations').expect(403);
      expect(res.body.code).toBe('NO_ACTIVE_TENANT');
    });

    it('quien crea la empresa queda OWNER y la ve activa; un slug repetido responde 409 SLUG_TAKEN', async () => {
      const { client, tenantId, slug } = await newCompany();

      const me = MeResponseSchema.parse((await client.get('/api/v1/me').expect(200)).body);
      expect(me.activeTenantId).toBe(tenantId);
      expect(me.memberships).toEqual([
        expect.objectContaining({ tenantId, tenantName: 'Acme', tenantSlug: slug, role: 'OWNER' }),
      ]);

      const other = await signedUpUser();
      const res = await other.client
        .post('/api/v1/tenants', { name: 'Otra', slug, contactPhone: phone() })
        .expect(409);
      expect(res.body.code).toBe('SLUG_TAKEN');
    });

    it('un AGENT o ADMIN de una empresa ajena no crea empresas (403 TENANT_CREATION_FORBIDDEN)', async () => {
      const { client } = await newCompany();
      const agent = await join(client, 'AGENT');
      const admin = await join(client, 'ADMIN');

      for (const member of [agent, admin]) {
        const res = await member.client
          .post('/api/v1/tenants', {
            name: 'Propia',
            slug: `propia-${unique()}`,
            contactPhone: phone(),
          })
          .expect(403);
        expect(res.body.code).toBe('TENANT_CREATION_FORBIDDEN');
      }
    });

    it('GET /conversations/counts cuenta por bandeja con los permisos del rol y el canal', async () => {
      const company = await newCompany();
      const key = `e2e-counts-key-${randomUUID()}`;
      const channel = await prisma.channel.create({
        data: {
          tenantId: company.tenantId,
          name: 'WhatsApp Conteo',
          type: 'WHATSAPP',
          provider: 'N8N',
          externalId: `counts-${unique()}`,
        },
      });
      await prisma.integrationCredential.create({
        data: { tenantId: company.tenantId, channelId: channel.id, keyHash: sha256Hex(key) },
      });
      const agent = await join(company.client, 'AGENT');

      const inbound = [];
      for (let index = 0; index < 3; index++) {
        const res = await http()
          .post('/api/v1/integrations/messages/inbound')
          .set('Authorization', `Bearer ${key}`)
          .send({
            externalMessageId: randomUUID(),
            from: { externalId: phone(), displayName: 'Cliente' },
            text: 'Hola',
            sentAt: new Date().toISOString(),
          })
          .expect(201);
        inbound.push(res.body as { conversationId: string; controlVersion: number });
      }
      await company.client
        .post(`/api/v1/conversations/${inbound[0]!.conversationId}/assign`, {
          memberId: agent.memberId,
          controlVersion: inbound[0]!.controlVersion,
        })
        .expect(200);

      const owner = await company.client.get('/api/v1/conversations/counts').expect(200);
      expect(owner.body).toEqual({ ai: 2, mine: 0, all: 3 });
      const mine = await agent.client.get('/api/v1/conversations/counts').expect(200);
      expect(mine.body).toEqual({ ai: 2, mine: 1 });
      const other = await company.client
        .get(`/api/v1/conversations/counts?channelId=${randomUUID()}`)
        .expect(200);
      expect(other.body).toEqual({ ai: 0, mine: 0, all: 0 });
    });

    it('cambia de empresa activa y la bandeja muestra solo la nueva', async () => {
      const { client, tenantId: first } = await newCompany();
      const second = (
        await client
          .post('/api/v1/tenants', {
            name: 'Segunda',
            slug: `seg-${unique()}`,
            contactPhone: phone(),
          })
          .expect(201)
      ).body.id as string;
      await approve(second);

      await client.post('/api/v1/me/active-tenant', { tenantId: first }).expect(200);
      expect((await client.get('/api/v1/me').expect(200)).body.activeTenantId).toBe(first);
      await client.post('/api/v1/me/active-tenant', { tenantId: second }).expect(200);
      expect((await client.get('/api/v1/me').expect(200)).body.activeTenantId).toBe(second);

      const demoTenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'demo' } });
      await client.post('/api/v1/me/active-tenant', { tenantId: demoTenant.id }).expect(403);
      const list = ListConversationsResponseSchema.parse(
        (await client.get('/api/v1/conversations?inbox=all').expect(200)).body,
      );
      expect(list.items).toEqual([]);
    });
  });

  describe('invitaciones', () => {
    it('OWNER invita ADMIN; un ADMIN no invita ADMIN (403) pero sí AGENT', async () => {
      const { client } = await newCompany();
      const admin = await join(client, 'ADMIN');

      await admin.client
        .post('/api/v1/invitations', { email: 'otro@e2e.local', role: 'ADMIN' })
        .expect(403);
      const res = await admin.client
        .post('/api/v1/invitations', { email: 'Nuevo@E2E.local', role: 'AGENT' })
        .expect(201);
      const invitation = CreateInvitationResponseSchema.parse(res.body);
      expect(invitation.url).toMatch(/^http:\/\/localhost:8080\/omnidesk\/invite\/[\w-]{43}$/);
      expect(new Date(invitation.expiresAt).getTime() - Date.now()).toBeGreaterThan(
        6.9 * 24 * 3600 * 1000,
      );

      const pending = ListInvitationsResponseSchema.parse(
        (await client.get('/api/v1/invitations').expect(200)).body,
      );
      expect(pending.items).toEqual([
        expect.objectContaining({ email: 'nuevo@e2e.local', role: 'AGENT' }),
      ]);
    });

    it('aceptar con la sesión de otro email responde 409 INVITATION_EMAIL_MISMATCH', async () => {
      const { client } = await newCompany();
      const invite = await client
        .post('/api/v1/invitations', { email: 'destinataria@e2e.local', role: 'AGENT' })
        .expect(201);
      const token = invite.body.url.split('/').pop();
      const intruder = await signedUpUser('Intrusa');

      const res = await intruder.client
        .post(`/api/v1/invitations/by-token/${token}/accept`)
        .expect(409);
      expect(res.body.code).toBe('INVITATION_EMAIL_MISMATCH');
    });

    it('es de un solo uso y vence a los 7 días: 410 INVITATION_EXPIRED', async () => {
      const { client } = await newCompany();
      const guest = await signedUpUser('Invitada');
      const accept = async (role: 'AGENT' | 'ADMIN') => {
        const invite = await client
          .post('/api/v1/invitations', { email: guest.user.email, role })
          .expect(201);
        return { id: invite.body.id as string, token: invite.body.url.split('/').pop() as string };
      };

      const first = await accept('AGENT');
      await guest.client.post(`/api/v1/invitations/by-token/${first.token}/accept`).expect(204);
      const again = await guest.client
        .post(`/api/v1/invitations/by-token/${first.token}/accept`)
        .expect(410);
      expect(again.body.code).toBe('INVITATION_EXPIRED');

      const other = await signedUpUser('Tardía');
      const late = await client
        .post('/api/v1/invitations', { email: other.user.email, role: 'AGENT' })
        .expect(201);
      await prisma.invitation.update({
        where: { id: late.body.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      const expired = await other.client
        .post(`/api/v1/invitations/by-token/${late.body.url.split('/').pop()}/accept`)
        .expect(410);
      expect(expired.body.code).toBe('INVITATION_EXPIRED');
    });

    it('la vista previa es pública y enmascara el email; revocar la deja como no válida', async () => {
      const { client } = await newCompany();
      const invite = await client
        .post('/api/v1/invitations', { email: 'laura.gomez@e2e.local', role: 'AGENT' })
        .expect(201);
      const token = invite.body.url.split('/').pop();

      expect(
        InvitationPreviewSchema.parse(
          (await http().get(`/api/v1/invitations/by-token/${token}`).expect(200)).body,
        ),
      ).toEqual({
        tenantName: 'Acme',
        role: 'AGENT',
        emailMasked: 'la***@e2e.local',
        expired: false,
        tenantLogoUrl: null,
      });

      await client.delete(`/api/v1/invitations/${invite.body.id}`).expect(204);

      expect(
        (await http().get(`/api/v1/invitations/by-token/${token}`).expect(200)).body.expired,
      ).toBe(true);
      await http().get('/api/v1/invitations/by-token/desconocido').expect(404);
    });

    it('invitar a quien ya es miembro responde 409 ALREADY_MEMBER', async () => {
      const { client, user } = await newCompany();

      const res = await client
        .post('/api/v1/invitations', { email: user.email, role: 'AGENT' })
        .expect(409);
      expect(res.body.code).toBe('ALREADY_MEMBER');
    });

    it('un AGENT recibe 403 en GET /invitations', async () => {
      const agent = as(await devLogin(app, laura));

      await agent.get('/api/v1/invitations').expect(403);
    });
  });

  describe('miembros', () => {
    it('el único OWNER que intenta degradarse recibe 409 LAST_OWNER', async () => {
      const { client, tenantId, user } = await newCompany();
      const ownerMember = await prisma.tenantMember.findFirstOrThrow({
        where: { tenantId, userId: user.id },
      });

      const res = await client
        .patch(`/api/v1/members/${ownerMember.id}`, { role: 'ADMIN' })
        .expect(409);
      expect(res.body.code).toBe('LAST_OWNER');
      const removal = await client.delete(`/api/v1/members/${ownerMember.id}`).expect(409);
      expect(removal.body.code).toBe('LAST_OWNER');
    });

    it('solo un OWNER cambia roles', async () => {
      const { client } = await newCompany();
      const admin = await join(client, 'ADMIN');
      const agent = await join(client, 'AGENT');

      await admin.client.patch(`/api/v1/members/${agent.memberId}`, { role: 'ADMIN' }).expect(403);
      const res = await client
        .patch(`/api/v1/members/${agent.memberId}`, { role: 'ADMIN' })
        .expect(200);
      expect(res.body).toMatchObject({ id: agent.memberId, role: 'ADMIN' });
    });

    it('quitar a un agente libera sus conversaciones, revoca su sesión y conserva su nombre en el historial', async () => {
      const company = await newCompany('Supervisora');
      // Canal y credencial propios: las conversaciones entran a esta empresa.
      const key = `e2e-acme-key-${randomUUID()}`;
      const channel = await prisma.channel.create({
        data: {
          tenantId: company.tenantId,
          name: 'WhatsApp Acme',
          type: 'WHATSAPP',
          provider: 'N8N',
          externalId: `acme-${unique()}`,
        },
      });
      await prisma.integrationCredential.create({
        data: { tenantId: company.tenantId, channelId: channel.id, keyHash: sha256Hex(key) },
      });
      const agent = await join(company.client, 'AGENT', 'Laura');

      const conversations: string[] = [];
      for (let index = 0; index < 2; index++) {
        const inbound = await http()
          .post('/api/v1/integrations/messages/inbound')
          .set('Authorization', `Bearer ${key}`)
          .send({
            externalMessageId: randomUUID(),
            from: { externalId: phone(), displayName: 'Cliente' },
            text: 'Hola',
            sentAt: new Date().toISOString(),
          })
          .expect(201);
        await company.client
          .post(`/api/v1/conversations/${inbound.body.conversationId}/assign`, {
            memberId: agent.memberId,
            controlVersion: inbound.body.controlVersion,
          })
          .expect(200);
        conversations.push(inbound.body.conversationId);
      }
      await agent.client
        .post(`/api/v1/conversations/${conversations[0]}/messages`, {
          text: 'Hola, soy Laura',
          clientMessageId: randomUUID(),
        })
        .expect(201);

      await company.client.delete(`/api/v1/members/${agent.memberId}`).expect(204);

      // Su sesión activa en esta empresa ya no vale.
      await agent.client.get('/api/v1/conversations').expect(401);
      // Las dos vuelven a la IA con el evento de liberación de quien la quitó.
      const ai = ListConversationsResponseSchema.parse(
        (await company.client.get('/api/v1/conversations?inbox=ai').expect(200)).body,
      );
      expect(ai.items.map((item) => item.id).sort()).toEqual([...conversations].sort());
      const timeline = ListTimelineResponseSchema.parse(
        (await company.client.get(`/api/v1/conversations/${conversations[0]}/timeline`).expect(200))
          .body,
      );
      expect(timeline.items).toContainEqual(
        expect.objectContaining({
          kind: 'event',
          type: 'RELEASED',
          actor: expect.objectContaining({ displayName: 'Supervisora' }),
        }),
      );
      expect(timeline.items).toContainEqual(
        expect.objectContaining({
          kind: 'message',
          sender: expect.objectContaining({ displayName: 'Laura' }),
        }),
      );
      // Ya no aparece entre los miembros ni se le puede asignar.
      const members = ListMembersResponseSchema.parse(
        (await company.client.get('/api/v1/members').expect(200)).body,
      );
      expect(members.items.map((m) => m.id)).not.toContain(agent.memberId);
    });

    it('volver a invitar a un miembro quitado reactiva la misma fila con el rol nuevo', async () => {
      const { client, tenantId } = await newCompany();
      const agent = await join(client, 'AGENT');
      await client.delete(`/api/v1/members/${agent.memberId}`).expect(204);

      const invite = await client
        .post('/api/v1/invitations', { email: agent.user.email, role: 'ADMIN' })
        .expect(201);
      const fresh = as(await sessionFor(app, agent.user.id));
      await fresh
        .post(`/api/v1/invitations/by-token/${invite.body.url.split('/').pop()}/accept`)
        .expect(204);

      const rows = await prisma.tenantMember.findMany({
        where: { tenantId, userId: agent.user.id },
      });
      expect(rows).toEqual([
        expect.objectContaining({ id: agent.memberId, role: 'ADMIN', removedAt: null }),
      ]);
    });

    it('ADMIN no puede quitar a un OWNER ni a otro ADMIN', async () => {
      const { client, tenantId, user } = await newCompany();
      const admin = await join(client, 'ADMIN');
      const other = await join(client, 'ADMIN', 'Otro');
      const ownerId = (
        await prisma.tenantMember.findFirstOrThrow({ where: { tenantId, userId: user.id } })
      ).id;

      await admin.client.delete(`/api/v1/members/${ownerId}`).expect(403);
      await admin.client.delete(`/api/v1/members/${other.memberId}`).expect(403);
    });
  });
});
