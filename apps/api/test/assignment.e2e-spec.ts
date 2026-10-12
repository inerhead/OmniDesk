import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  ConversationSummarySchema,
  ListConversationsResponseSchema,
  ListMembersResponseSchema,
  ListTimelineResponseSchema,
  type Inbox,
} from '@omnidesk/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { devLogin, WEB_ORIGIN } from './support/session';
import { E2E_DEMO_KEY, testEnv } from './support/test-env';

const phone = () => `+57300${randomInt(1_000_000, 9_999_999)}`;

describe('Asignación y control de IA (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: string;
  let laura: string;
  let mateo: string;
  let foreignMember: string;
  const http = () => request(app.getHttpServer());

  const inbound = async (from = phone(), text = 'Hola') =>
    (
      await http()
        .post('/api/v1/integrations/messages/inbound')
        .set('Authorization', `Bearer ${E2E_DEMO_KEY}`)
        .send({
          externalMessageId: randomUUID(),
          from: { externalId: from, displayName: 'Cliente e2e' },
          text,
          sentAt: new Date().toISOString(),
        })
    ).body as {
      conversationId: string;
      aiAllowed: boolean;
      controlVersion: number;
      duplicate: boolean;
    };

  const outbound = (body: object) =>
    http()
      .post('/api/v1/integrations/messages/outbound')
      .set('Authorization', `Bearer ${E2E_DEMO_KEY}`)
      .send(body);

  /** Cookie de sesión de cada miembro demo (dev-login en `beforeAll`). */
  const cookies = new Map<string, string>();
  const get = (actor: string, path: string) => http().get(path).set('Cookie', cookies.get(actor)!);
  const post = (actor: string, path: string, body: object) =>
    http().post(path).set('Cookie', cookies.get(actor)!).set('Origin', WEB_ORIGIN).send(body);

  const assign = (actor: string, id: string, memberId: string, controlVersion: number) =>
    post(actor, `/api/v1/conversations/${id}/assign`, { memberId, controlVersion });
  const command = (
    actor: string,
    id: string,
    name: 'release' | 'close' | 'reopen',
    controlVersion: number,
  ) => post(actor, `/api/v1/conversations/${id}/${name}`, { controlVersion });

  const version = async (id: string) =>
    (await prisma.conversation.findUniqueOrThrow({ where: { id } })).controlVersion;

  /** Todos los ids de una bandeja, recorriendo las páginas. */
  async function inboxIds(actor: string, inbox: Inbox): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await get(actor, '/api/v1/conversations')
        .query({ inbox, limit: 100, ...(cursor && { cursor }) })
        .expect(200);
      const page = ListConversationsResponseSchema.parse(res.body);
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return ids;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(testEnv())],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app, testEnv());
    await app.init();
    prisma = app.get(PrismaService);

    const member = async (email: string) =>
      (await prisma.tenantMember.findFirstOrThrow({ where: { email } })).id;
    owner = await member('supervisor@demo.omnidesk.local');
    laura = await member('laura@demo.omnidesk.local');
    mateo = await member('mateo@demo.omnidesk.local');
    for (const id of [owner, laura, mateo]) cookies.set(id, await devLogin(app, id));

    const otherTenant = await prisma.tenant.create({
      data: { slug: `otro-${randomUUID()}`, name: 'Otro tenant' },
    });
    foreignMember = (
      await prisma.tenantMember.create({
        data: {
          tenantId: otherTenant.id,
          displayName: 'Ajeno',
          email: 'ajeno@otro.local',
          role: 'OWNER',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /members', () => {
    it('lista los 3 miembros demo con id, nombre y rol, sin email', async () => {
      const res = await get(owner, '/api/v1/members').expect(200);
      const { items } = ListMembersResponseSchema.parse(res.body);

      expect(items.map((m) => [m.displayName, m.role])).toEqual([
        ['Sup. Demo', 'OWNER'],
        ['Laura', 'AGENT'],
        ['Mateo', 'AGENT'],
      ]);
      expect(JSON.stringify(res.body)).not.toContain('@');
    });
  });

  describe('sesión', () => {
    it('responde 401 UNAUTHENTICATED sin sesión', async () => {
      const res = await http().get('/api/v1/conversations').expect(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('la cabecera X-Demo-Member-Id ya no tiene efecto', async () => {
      await http().get('/api/v1/conversations').set('X-Demo-Member-Id', owner).expect(401);
    });

    it('el login de desarrollo rechaza ids desconocidos y miembros de otro tenant', async () => {
      const devLoginAs = (memberId: string) =>
        http().post('/api/v1/auth/dev-login').set('Origin', WEB_ORIGIN).send({ memberId });
      await devLoginAs(randomUUID()).expect(404);
      await devLoginAs('laura').expect(400);
      await devLoginAs(foreignMember).expect(404);
    });

    it('protege también los comandos', async () => {
      const { conversationId } = await inbound();

      await http()
        .post(`/api/v1/conversations/${conversationId}/close`)
        .set('Origin', WEB_ORIGIN)
        .send({ controlVersion: 0 })
        .expect(401);
    });
  });

  describe('comandos y control de IA', () => {
    it('assign como Sup. Demo: 200, controlVersion +1 y evento ASSIGNED con actor y target', async () => {
      const { conversationId, controlVersion } = await inbound();

      const res = await assign(owner, conversationId, laura, controlVersion).expect(200);

      const summary = ConversationSummarySchema.parse(res.body);
      expect(summary).toMatchObject({
        id: conversationId,
        aiActive: false,
        controlVersion: controlVersion + 1,
        assignedAgent: { id: laura, displayName: 'Laura' },
      });
      const events = await prisma.conversationEvent.findMany({ where: { conversationId } });
      expect(events).toEqual([
        expect.objectContaining({ type: 'ASSIGNED', actorMemberId: owner, targetMemberId: laura }),
      ]);
    });

    it('repetir assign con el controlVersion anterior responde 409 CONTROL_CHANGED', async () => {
      const { conversationId, controlVersion } = await inbound();
      await assign(owner, conversationId, laura, controlVersion).expect(200);

      const res = await assign(owner, conversationId, mateo, controlVersion).expect(409);

      expect(res.body).toEqual({ reason: 'CONTROL_CHANGED' });
      expect(await version(conversationId)).toBe(controlVersion + 1);
    });

    it('con la conversación asignada, un inbound devuelve aiAllowed false y el nuevo controlVersion', async () => {
      const from = phone();
      const first = await inbound(from);
      await assign(owner, first.conversationId, laura, first.controlVersion).expect(200);

      const next = await inbound(from, 'sigo aquí');

      expect(next).toMatchObject({
        conversationId: first.conversationId,
        aiAllowed: false,
        controlVersion: first.controlVersion + 1,
      });
    });

    it('un outbound de IA con el controlVersion previo a la asignación responde 409 y no crea mensaje', async () => {
      const { conversationId, controlVersion } = await inbound();
      await assign(owner, conversationId, laura, controlVersion).expect(200);
      const before = await prisma.message.count({ where: { conversationId } });

      const res = await outbound({
        conversationId,
        controlVersion,
        idempotencyKey: `ai-${randomUUID()}`,
        text: 'Respuesta tardía de la IA',
      }).expect(409);

      expect(res.body).toEqual({ sendAllowed: false, reason: 'CONTROL_CHANGED' });
      expect(await prisma.message.count({ where: { conversationId } })).toBe(before);
    });

    it('release devuelve la conversación a la IA y el siguiente inbound devuelve aiAllowed true', async () => {
      const from = phone();
      const first = await inbound(from);
      await assign(owner, first.conversationId, laura, first.controlVersion).expect(200);

      const res = await command(
        laura,
        first.conversationId,
        'release',
        first.controlVersion + 1,
      ).expect(200);

      expect(res.body).toMatchObject({ aiActive: true, assignedAgent: null });
      expect(await inbound(from)).toMatchObject({ aiAllowed: true });
    });

    it('close conserva assignedAgentId y reopen lo deja OPEN sin agente', async () => {
      const { conversationId, controlVersion } = await inbound();
      await assign(owner, conversationId, laura, controlVersion).expect(200);

      const closed = await command(laura, conversationId, 'close', controlVersion + 1).expect(200);
      expect(closed.body).toMatchObject({
        status: 'CLOSED',
        assignedAgent: { id: laura },
        aiActive: false,
      });

      const reopened = await command(laura, conversationId, 'reopen', controlVersion + 2).expect(
        200,
      );
      expect(reopened.body).toMatchObject({ status: 'OPEN', assignedAgent: null, aiActive: true });
      expect(await version(conversationId)).toBe(controlVersion + 3);
    });

    it('un inbound sobre una conversación CLOSED la reabre: misma id, REOPENED sin actor y aiAllowed true', async () => {
      const from = phone();
      const first = await inbound(from);
      await command(owner, first.conversationId, 'close', first.controlVersion).expect(200);

      const again = await inbound(from, 'quiero retomar');

      expect(again).toMatchObject({
        conversationId: first.conversationId,
        aiAllowed: true,
        controlVersion: first.controlVersion + 2,
      });
      const events = await prisma.conversationEvent.findMany({
        where: { conversationId: first.conversationId },
        orderBy: { sequence: 'asc' },
      });
      expect(events.map((e) => [e.type, e.actorMemberId])).toEqual([
        ['CLOSED', owner],
        ['REOPENED', null],
      ]);
      expect(
        await prisma.conversation.count({
          where: { contact: { identities: { some: { externalId: from } } } },
        }),
      ).toBe(1);
    });

    it('close sobre una conversación ya CLOSED responde 409 INVALID_STATE', async () => {
      const { conversationId, controlVersion } = await inbound();
      await command(owner, conversationId, 'close', controlVersion).expect(200);

      const res = await command(owner, conversationId, 'close', controlVersion + 1).expect(409);

      expect(res.body).toEqual({ reason: 'INVALID_STATE' });
    });

    it('cada comando encola conversation.changed con reason assignment', async () => {
      const { conversationId, controlVersion } = await inbound();
      await assign(owner, conversationId, laura, controlVersion).expect(200);

      const rows = await prisma.outboxEvent.findMany({
        where: { payload: { path: ['conversationId'], equals: conversationId } },
      });

      expect(rows.map((r) => (r.payload as { reason: string }).reason).sort()).toEqual([
        'assignment',
        'message',
      ]);
    });

    it('responde 400 sin controlVersion y 404 si el miembro destino no existe', async () => {
      const { conversationId, controlVersion } = await inbound();

      await post(owner, `/api/v1/conversations/${conversationId}/close`, {}).expect(400);
      await assign(owner, conversationId, randomUUID(), controlVersion).expect(404);
      await assign(owner, conversationId, foreignMember, controlVersion).expect(404);
    });
  });

  describe('permisos', () => {
    it('Laura (AGENT): toma una de la IA, no asigna a Mateo, no toma la de Mateo y no ve la bandeja all', async () => {
      const mine = await inbound();
      await assign(laura, mine.conversationId, laura, mine.controlVersion).expect(200);

      const free = await inbound();
      await assign(laura, free.conversationId, mateo, free.controlVersion).expect(403);

      const matteos = await inbound();
      await assign(owner, matteos.conversationId, mateo, matteos.controlVersion).expect(200);
      await assign(laura, matteos.conversationId, laura, matteos.controlVersion + 1).expect(404);

      await get(laura, '/api/v1/conversations').query({ inbox: 'all' }).expect(403);
      await get(owner, '/api/v1/conversations').query({ inbox: 'all' }).expect(200);
    });

    it('Laura no puede liberar, cerrar ni reabrir las conversaciones de otro', async () => {
      const { conversationId, controlVersion } = await inbound();
      await assign(owner, conversationId, mateo, controlVersion).expect(200);

      await command(laura, conversationId, 'release', controlVersion + 1).expect(404);
      await command(laura, conversationId, 'close', controlVersion + 1).expect(404);
      await command(laura, conversationId, 'reopen', controlVersion + 1).expect(404);
    });

    it('Laura ve 403 al cerrar una conversación de la IA que no es suya', async () => {
      const { conversationId, controlVersion } = await inbound();

      await command(laura, conversationId, 'close', controlVersion).expect(403);
      expect(await version(conversationId)).toBe(controlVersion);
    });

    it('Laura recibe 404 en timeline y messages de una conversación asignada a Mateo', async () => {
      const { conversationId, controlVersion } = await inbound();
      await assign(owner, conversationId, mateo, controlVersion).expect(200);

      await get(laura, `/api/v1/conversations/${conversationId}/timeline`).expect(404);
      await get(laura, `/api/v1/conversations/${conversationId}/messages`).expect(404);
      await get(owner, `/api/v1/conversations/${conversationId}/timeline`).expect(200);
    });
  });

  describe('bandejas', () => {
    it('ai solo trae abiertas sin asignar, mine las del actor y closed solo cerradas', async () => {
      const aiOnly = await inbound();
      const lauras = await inbound();
      const matteos = await inbound();
      const closedLaura = await inbound();
      const closedFree = await inbound();
      await assign(owner, lauras.conversationId, laura, lauras.controlVersion).expect(200);
      await assign(owner, matteos.conversationId, mateo, matteos.controlVersion).expect(200);
      await assign(owner, closedLaura.conversationId, laura, closedLaura.controlVersion).expect(
        200,
      );
      await command(
        laura,
        closedLaura.conversationId,
        'close',
        closedLaura.controlVersion + 1,
      ).expect(200);
      await command(owner, closedFree.conversationId, 'close', closedFree.controlVersion).expect(
        200,
      );

      const ai = await inboxIds(laura, 'ai');
      expect(ai).toContain(aiOnly.conversationId);
      for (const id of [lauras, matteos, closedLaura, closedFree].map((c) => c.conversationId)) {
        expect(ai).not.toContain(id);
      }

      const mine = await inboxIds(laura, 'mine');
      expect(mine).toContain(lauras.conversationId);
      for (const id of [aiOnly, matteos, closedLaura].map((c) => c.conversationId)) {
        expect(mine).not.toContain(id);
      }

      // Un AGENT solo ve en "Cerradas" las que tienen su assignedAgentId.
      const lauraClosed = await inboxIds(laura, 'closed');
      expect(lauraClosed).toContain(closedLaura.conversationId);
      expect(lauraClosed).not.toContain(closedFree.conversationId);

      // OWNER/ADMIN ven todas las cerradas y todas las abiertas.
      const ownerClosed = await inboxIds(owner, 'closed');
      expect(ownerClosed).toEqual(
        expect.arrayContaining([closedLaura.conversationId, closedFree.conversationId]),
      );
      const all = await inboxIds(owner, 'all');
      expect(all).toEqual(
        expect.arrayContaining([aiOnly, lauras, matteos].map((c) => c.conversationId)),
      );
      expect(all).not.toContain(closedLaura.conversationId);
    });

    it('la bandeja por defecto es ai', async () => {
      const assigned = await inbound();
      await assign(owner, assigned.conversationId, laura, assigned.controlVersion).expect(200);

      const res = await get(owner, '/api/v1/conversations').query({ limit: 100 }).expect(200);

      const ids = ListConversationsResponseSchema.parse(res.body).items.map((i) => i.id);
      expect(ids).not.toContain(assigned.conversationId);
    });

    it('responde 400 ante una bandeja desconocida', async () => {
      await get(owner, '/api/v1/conversations').query({ inbox: 'otra' }).expect(400);
    });
  });

  describe('GET /conversations/:id', () => {
    it('devuelve el resumen con agente y controlVersion, y 404 si el AGENT no puede verla', async () => {
      const { conversationId, controlVersion } = await inbound();
      await assign(owner, conversationId, mateo, controlVersion).expect(200);

      const res = await get(owner, `/api/v1/conversations/${conversationId}`).expect(200);
      expect(ConversationSummarySchema.parse(res.body)).toMatchObject({
        id: conversationId,
        assignedAgent: { id: mateo, displayName: 'Mateo' },
        controlVersion: controlVersion + 1,
      });

      await get(laura, `/api/v1/conversations/${conversationId}`).expect(404);
      await get(mateo, `/api/v1/conversations/${conversationId}`).expect(200);
      await get(owner, `/api/v1/conversations/${randomUUID()}`).expect(404);
    });
  });

  describe('GET /conversations/:id/timeline', () => {
    it('intercala mensajes y eventos por sequence y pagina con before cruzando un evento', async () => {
      const from = phone();
      const first = await inbound(from, 'uno'); // seq 1
      await assign(owner, first.conversationId, laura, first.controlVersion).expect(200); // seq 2
      await inbound(from, 'dos'); // seq 3
      await command(laura, first.conversationId, 'close', first.controlVersion + 1).expect(200); // seq 4
      await inbound(from, 'tres'); // reabre: REOPENED seq 5, mensaje seq 6
      const id = first.conversationId;

      const all = ListTimelineResponseSchema.parse(
        (await get(owner, `/api/v1/conversations/${id}/timeline`).expect(200)).body,
      );
      expect(all.items.map((i) => `${i.kind}:${i.sequence}`)).toEqual([
        'message:1',
        'event:2',
        'message:3',
        'event:4',
        'event:5',
        'message:6',
      ]);
      const assigned = all.items[1]!;
      expect(assigned).toMatchObject({
        kind: 'event',
        type: 'ASSIGNED',
        actor: { displayName: 'Sup. Demo' },
        target: { displayName: 'Laura' },
      });
      expect(all.items[4]).toMatchObject({ type: 'REOPENED', actor: null, target: null });

      const latest = ListTimelineResponseSchema.parse(
        (await get(owner, `/api/v1/conversations/${id}/timeline`).query({ limit: 2 }).expect(200))
          .body,
      );
      expect(latest.items.map((i) => i.sequence)).toEqual([5, 6]);
      expect(latest.prevCursor).toBe(5);

      const older = ListTimelineResponseSchema.parse(
        (
          await get(owner, `/api/v1/conversations/${id}/timeline`)
            .query({ limit: 2, before: latest.prevCursor })
            .expect(200)
        ).body,
      );
      expect(older.items.map((i) => i.sequence)).toEqual([3, 4]);
      expect(older.prevCursor).toBe(3);

      const oldest = ListTimelineResponseSchema.parse(
        (
          await get(owner, `/api/v1/conversations/${id}/timeline`)
            .query({ limit: 2, before: older.prevCursor })
            .expect(200)
        ).body,
      );
      expect(oldest.items.map((i) => i.sequence)).toEqual([1, 2]);
      expect(oldest.prevCursor).toBeNull();
    });

    it('/messages sigue devolviendo solo mensajes', async () => {
      const first = await inbound();
      await assign(owner, first.conversationId, laura, first.controlVersion).expect(200);

      const res = await get(owner, `/api/v1/conversations/${first.conversationId}/messages`).expect(
        200,
      );

      expect(res.body.items.map((m: { sequence: number }) => m.sequence)).toEqual([1]);
    });
  });

  describe('búsqueda (q)', () => {
    /** Inbound de un contacto nuevo con nombre propio; un token único aísla cada ejecución. */
    const inboundNamed = async (displayName: string, from = phone()) =>
      (
        await http()
          .post('/api/v1/integrations/messages/inbound')
          .set('Authorization', `Bearer ${E2E_DEMO_KEY}`)
          .send({
            externalMessageId: randomUUID(),
            from: { externalId: from, displayName },
            text: 'Hola',
            sentAt: new Date().toISOString(),
          })
          .expect(201)
      ).body as { conversationId: string; controlVersion: number };

    const search = async (actor: string, inbox: Inbox, q: string) => {
      const res = await get(actor, '/api/v1/conversations')
        .query({ inbox, q, limit: 100 })
        .expect(200);
      return ListConversationsResponseSchema.parse(res.body).items;
    };

    it('busca por nombre parcial sin distinguir mayúsculas', async () => {
      const token = randomUUID().slice(0, 8);
      const juana = await inboundNamed(`Juana ${token}`);
      await inboundNamed(`Pedro ${token}`);

      const items = await search(owner, 'all', `UANA ${token}`);
      const ids = items.map((item) => item.id);

      expect(ids).toContain(juana.conversationId);
      expect(items.every((item) => item.contact.displayName?.toLowerCase().includes('juana'))).toBe(
        true,
      );
    });

    it('busca por teléfono con espacios', async () => {
      const from = phone();
      const conversation = await inboundNamed('Sin nombre útil', from);
      const digits = `${from.slice(3, 6)} ${from.slice(6)}`;

      const items = await search(owner, 'all', digits);

      expect(items.map((item) => item.id)).toContain(conversation.conversationId);
      expect(items.every((item) => item.contact.externalId.includes(from.slice(3)))).toBe(true);
    });

    it('un término sin coincidencias devuelve una lista vacía', async () => {
      expect(await search(owner, 'all', `nadie-${randomUUID()}`)).toEqual([]);
    });

    it('q de 1 carácter responde 400', async () => {
      await get(owner, '/api/v1/conversations').query({ inbox: 'all', q: 'a' }).expect(400);
    });

    it('respeta la bandeja: una conversación asignada no aparece en ai', async () => {
      const token = randomUUID().slice(0, 8);
      const conversation = await inboundNamed(`Bandeja ${token}`);
      await assign(owner, conversation.conversationId, laura, conversation.controlVersion).expect(
        200,
      );

      expect(await search(owner, 'ai', token)).toEqual([]);
      expect((await search(owner, 'all', token)).map((item) => item.id)).toEqual([
        conversation.conversationId,
      ]);
    });

    it('Mateo nunca encuentra conversaciones asignadas a Laura', async () => {
      const token = randomUUID().slice(0, 8);
      const conversation = await inboundNamed(`Privada ${token}`);
      await assign(owner, conversation.conversationId, laura, conversation.controlVersion).expect(
        200,
      );
      await command(
        laura,
        conversation.conversationId,
        'close',
        await version(conversation.conversationId),
      ).expect(200);

      for (const inbox of ['ai', 'mine', 'closed'] as const) {
        expect(await search(mateo, inbox, token)).toEqual([]);
      }
      expect((await search(laura, 'closed', token)).map((item) => item.id)).toEqual([
        conversation.conversationId,
      ]);
    });

    it('createdAt aparece en la lista y en el detalle', async () => {
      const token = randomUUID().slice(0, 8);
      const conversation = await inboundNamed(`Fecha ${token}`);

      const [item] = await search(owner, 'ai', token);
      const detail = await get(
        owner,
        `/api/v1/conversations/${conversation.conversationId}`,
      ).expect(200);

      expect(item?.createdAt).toEqual(expect.any(String));
      expect(ConversationSummarySchema.parse(detail.body).createdAt).toBe(item?.createdAt);
    });
  });

  it('documenta los endpoints nuevos en Swagger', async () => {
    const res = await http().get('/api/docs-json').expect(200);

    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/members',
        '/api/v1/conversations/{id}/timeline',
        '/api/v1/conversations/{id}/assign',
        '/api/v1/conversations/{id}/release',
        '/api/v1/conversations/{id}/close',
        '/api/v1/conversations/{id}/reopen',
      ]),
    );
  });
});
