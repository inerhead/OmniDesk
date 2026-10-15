import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OutboxDispatcher } from '../src/modules/realtime/infrastructure/outbox-dispatcher';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../src/shared/application/transaction-runner.port';
import { PrismaDb } from '../src/shared/infrastructure/prisma/prisma-transaction-runner';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { TenantPrisma } from '../src/shared/infrastructure/prisma/tenant-prisma';
import { currentTenantId } from '../src/shared/infrastructure/prisma/tenant-scope';
import { sessionFor } from './support/session';
import { testAppDatabaseUrl, testEnv } from './support/test-env';

/** Las 12 tablas con `tenant_id` que aísla Row Level Security (SPEC 12). */
const TENANT_TABLES = [
  'channels',
  'integration_credentials',
  'contacts',
  'contact_identities',
  'conversations',
  'messages',
  'message_attachments',
  'tenant_members',
  'conversation_events',
  'outbox_events',
  'invitations',
  'deletion_log',
] as const;

describe('Row Level Security (integración)', () => {
  let app: NestExpressApplication;
  let db: PrismaService;
  let tenantA: { tenantId: string; userId: string; conversationId: string };
  let tenantB: { tenantId: string; userId: string; conversationId: string };

  /** Una fila en cada una de las 12 tablas, creada con el rol dueño. */
  const seedTenant = async () => {
    const tenant = await db.tenant.create({
      data: { name: 'RLS', slug: `rls-${randomUUID()}` },
    });
    const tenantId = tenant.id;
    const user = await db.user.create({
      data: { email: `${randomUUID()}@e2e.local`, displayName: 'RLS' },
    });
    const member = await db.tenantMember.create({
      data: { tenantId, userId: user.id, email: user.email, displayName: 'RLS', role: 'OWNER' },
    });
    const channel = await db.channel.create({
      data: {
        tenantId,
        name: 'Ventas',
        type: 'WHATSAPP',
        provider: 'SIMULATED',
        externalId: `rls-${randomUUID()}`,
      },
    });
    await db.integrationCredential.create({
      data: { tenantId, channelId: channel.id, keyHash: randomUUID() },
    });
    const contact = await db.contact.create({ data: { tenantId, displayName: 'Cliente' } });
    await db.contactIdentity.create({
      data: {
        tenantId,
        contactId: contact.id,
        channelId: channel.id,
        externalId: `+57${Math.floor(Math.random() * 1e10)}`,
      },
    });
    const conversation = await db.conversation.create({
      data: {
        tenantId,
        channelId: channel.id,
        contactId: contact.id,
        lastMessageAt: new Date(),
        lastMessagePreview: 'Hola',
        lastSequence: 2,
      },
    });
    const message = await db.message.create({
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
    await db.messageAttachment.create({
      data: {
        tenantId,
        messageId: message.id,
        kind: 'IMAGE',
        mimeType: 'image/jpeg',
        status: 'PENDING',
      },
    });
    await db.conversationEvent.create({
      data: { tenantId, conversationId: conversation.id, sequence: 2, type: 'CLOSED' },
    });
    await db.outboxEvent.create({
      data: { tenantId, type: 'conversation.changed', payload: {}, publishedAt: new Date() },
    });
    await db.invitation.create({
      data: {
        tenantId,
        email: `${randomUUID()}@e2e.local`,
        role: 'AGENT',
        tokenHash: randomUUID(),
        invitedById: member.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await db.deletionLog.create({
      data: { tenantId, kind: 'contact', conversationsDeleted: 0, messagesDeleted: 0 },
    });
    return { tenantId, userId: user.id, conversationId: conversation.id };
  };

  /** Conexión directa con el rol de aplicación, como la del API. */
  const withAppConnection = async <T>(work: (client: Client) => Promise<T>): Promise<T> => {
    const client = new Client({ connectionString: testAppDatabaseUrl() });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  };

  /** Ejecuta `work` en una transacción con `app.tenant_id` fijado, y la deshace al final. */
  const asTenant = <T>(client: Client, tenantId: string, work: () => Promise<T>) =>
    (async () => {
      await client.query('BEGIN');
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        return await work();
      } finally {
        await client.query('ROLLBACK');
      }
    })();

  beforeAll(async () => {
    const env = testEnv();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app, env);
    await app.init();
    // Este archivo no necesita el dispatcher: deja el Outbox como está.
    await app.get(OutboxDispatcher).onModuleDestroy();
    db = app.get(PrismaService);
    tenantA = await seedTenant();
    tenantB = await seedTenant();
  });
  afterAll(async () => {
    // Que el dispatcher de otros archivos no procese los eventos con payload vacío de esta prueba.
    await db.outboxEvent.deleteMany({
      where: { tenantId: { in: [tenantA.tenantId, tenantB.tenantId] } },
    });
    await app.close();
  });

  it('RLS está habilitado y forzado en las 12 tablas', async () => {
    const { rows } = await withAppConnection((client) =>
      client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
         WHERE relname = ANY($1::text[]) AND relkind = 'r'`,
        [TENANT_TABLES],
      ),
    );
    expect(rows.map((row) => row.relname).sort()).toEqual([...TENANT_TABLES].sort());
    for (const row of rows) {
      expect(row, row.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    }
  });

  it('omnidesk_app no tiene BYPASSRLS ni es dueño de ninguna tabla', async () => {
    await withAppConnection(async (client) => {
      const roles = await client.query<{
        rolname: string;
        rolbypassrls: boolean;
        rolsuper: boolean;
      }>(
        `SELECT rolname, rolbypassrls, rolsuper FROM pg_roles
         WHERE rolname IN ('omnidesk_app', 'omnidesk_app_login')`,
      );
      expect(roles.rows).toHaveLength(2);
      for (const role of roles.rows) {
        expect(role, role.rolname).toMatchObject({ rolbypassrls: false, rolsuper: false });
      }
      const owned = await client.query(
        `SELECT tablename FROM pg_tables
         WHERE schemaname = 'public' AND tableowner IN ('omnidesk_app', 'omnidesk_app_login')`,
      );
      expect(owned.rows).toEqual([]);
    });
  });

  it('sin app.tenant_id, el rol de aplicación no ve ninguna fila', async () => {
    await withAppConnection(async (client) => {
      for (const table of TENANT_TABLES) {
        const { rows } = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM "${table}"`,
        );
        expect(rows[0]?.count, table).toBe('0');
      }
      // Tampoco con la variable ya usada y vuelta a '' en la misma conexión (pool).
      await asTenant(client, tenantA.tenantId, async () => undefined);
      const { rows } = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM conversations',
      );
      expect(rows[0]?.count).toBe('0');
    });
  });

  it('con app.tenant_id = A, ninguna de las 12 tablas devuelve filas de B', async () => {
    await withAppConnection((client) =>
      asTenant(client, tenantA.tenantId, async () => {
        for (const table of TENANT_TABLES) {
          const { rows } = await client.query<{ own: string; foreign: string }>(
            `SELECT count(*) FILTER (WHERE tenant_id = $1)::text AS own,
                    count(*) FILTER (WHERE tenant_id <> $1)::text AS foreign
             FROM "${table}"`,
            [tenantA.tenantId],
          );
          expect(rows[0]?.foreign, table).toBe('0');
          expect(Number(rows[0]?.own), table).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('un INSERT con tenant_id de otra empresa falla', async () => {
    await withAppConnection((client) =>
      asTenant(client, tenantA.tenantId, async () => {
        await expect(
          client.query(
            `INSERT INTO deletion_log (id, tenant_id, kind, conversations_deleted, messages_deleted)
             VALUES ($1, $2, 'contact', 0, 0)`,
            [randomUUID(), tenantB.tenantId],
          ),
        ).rejects.toThrow(/row-level security/);
      }),
    );
  });

  it('un acceso que olvida filtrar por tenantId sigue sin ver filas de otra empresa', async () => {
    const prisma = app.get(PrismaDb);
    const tx = app.get<TransactionRunner>(TRANSACTION_RUNNER);
    const tenantPrisma = app.get(TenantPrisma);

    // Consultas sueltas, como las de un read model, sin `where: { tenantId }` a propósito.
    const loose = await tenantPrisma.run(tenantA.tenantId, () =>
      prisma.client.conversation.findMany({ select: { tenantId: true } }),
    );
    expect(loose.length).toBeGreaterThan(0);
    expect(new Set(loose.map((row) => row.tenantId))).toEqual(new Set([tenantA.tenantId]));

    // Dentro de una transacción del TransactionRunner.
    const inTx = await tenantPrisma.run(tenantA.tenantId, () =>
      tx.run(() => prisma.client.message.findMany({ select: { tenantId: true } })),
    );
    expect(new Set(inTx.map((row) => row.tenantId))).toEqual(new Set([tenantA.tenantId]));

    // Y con SQL a mano.
    const raw = await tenantPrisma.run(
      tenantA.tenantId,
      () => prisma.client.$queryRaw<Array<{ tenant_id: string }>>`SELECT tenant_id FROM contacts`,
    );
    expect(new Set(raw.map((row) => row.tenant_id))).toEqual(new Set([tenantA.tenantId]));

    // Fuera de una empresa (camino de sistema) se ven las dos.
    const system = await prisma.client.conversation.count({
      where: { tenantId: { in: [tenantA.tenantId, tenantB.tenantId] } },
    });
    expect(system).toBe(2);
  });

  it('una petición con sesión accede a la base en nombre de su empresa', async () => {
    const prisma = app.get(PrismaDb);
    const scopes: Array<string | undefined> = [];
    const original = Object.getOwnPropertyDescriptor(PrismaDb.prototype, 'client')!.get!;
    const spy = vi.spyOn(prisma, 'client', 'get').mockImplementation(function (this: PrismaDb) {
      scopes.push(currentTenantId());
      return original.call(this);
    });
    try {
      const cookie = await sessionFor(app, tenantA.userId, tenantA.tenantId);
      scopes.length = 0; // La sesión y la membresía se resuelven antes, con el rol dueño.
      await request(app.getHttpServer())
        .get(`/api/v1/conversations/${tenantA.conversationId}`)
        .set('Cookie', cookie)
        .expect(200);
    } finally {
      spy.mockRestore();
    }
    // El guard resuelve la sesión fuera del contexto; el handler, dentro.
    expect(scopes).toContain(tenantA.tenantId);
    expect(scopes.filter((scope) => scope !== undefined && scope !== tenantA.tenantId)).toEqual([]);
  });

  it('una petición con sesión solo alcanza su empresa aunque pida un id ajeno', async () => {
    const cookie = await sessionFor(app, tenantA.userId, tenantA.tenantId);
    await request(app.getHttpServer())
      .get(`/api/v1/conversations/${tenantB.conversationId}`)
      .set('Cookie', cookie)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/conversations/${tenantA.conversationId}`)
      .set('Cookie', cookie)
      .expect(200);
  });
});
