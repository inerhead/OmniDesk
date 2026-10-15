import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OutboxDispatcher } from '../src/modules/realtime/infrastructure/outbox-dispatcher';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { testEnv } from './support/test-env';

const METRICS_TOKEN = 'e2e-metrics-token-0123456789abcdef';

async function createApp(overrides: Record<string, string>): Promise<NestExpressApplication> {
  const env = testEnv(overrides);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app, env);
  await app.init();
  await app.get(OutboxDispatcher).onModuleDestroy();
  return app;
}

describe('Métricas Prometheus (e2e)', () => {
  describe('con METRICS_TOKEN', () => {
    let app: NestExpressApplication;
    beforeAll(async () => {
      app = await createApp({ METRICS_TOKEN });
    });
    afterAll(() => app.close());

    it('sin cabecera o con un token incorrecto responde 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/metrics').expect(401);
      await request(app.getHttpServer())
        .get('/api/v1/metrics')
        .set('Authorization', `Bearer ${METRICS_TOKEN}-otro`)
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/v1/metrics')
        .set('Authorization', METRICS_TOKEN)
        .expect(401);
    });

    it('con el token devuelve texto Prometheus con las métricas por defecto prefijadas', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/metrics')
        .set('Authorization', `Bearer ${METRICS_TOKEN}`)
        .expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/plain/);
      expect(res.text).toContain('# TYPE omnidesk_process_cpu_user_seconds_total counter');
      expect(res.text).toContain('omnidesk_nodejs_eventloop_lag_seconds');
    });

    it('los gauges del Outbox se calculan al leer: pendientes por tipo y antigüedad', async () => {
      const db = app.get(PrismaService);
      const tenant = await db.tenant.create({
        data: { approval: 'APPROVED', name: 'Métricas', slug: `metricas-${Date.now()}` },
      });
      await db.outboxEvent.create({
        data: {
          tenantId: tenant.id,
          type: 'tenant.status_changed',
          payload: {},
          createdAt: new Date(Date.now() - 120_000),
        },
      });
      try {
        const { text } = await request(app.getHttpServer())
          .get('/api/v1/metrics')
          .set('Authorization', `Bearer ${METRICS_TOKEN}`)
          .expect(200);
        expect(text).toMatch(
          /omnidesk_outbox_pending_events\{type="tenant.status_changed"\} [1-9]/,
        );
        const age = Number(/^omnidesk_outbox_oldest_pending_age_seconds (\S+)$/m.exec(text)?.[1]);
        expect(age).toBeGreaterThanOrEqual(120);
      } finally {
        await db.outboxEvent.deleteMany({ where: { tenantId: tenant.id } });
      }
    });

    it('la latencia HTTP usa la ruta de plantilla: dos ids, una sola serie', async () => {
      const ids = ['0199c0de-0000-7000-8000-0000000000a1', '0199c0de-0000-7000-8000-0000000000a2'];
      for (const id of ids) await request(app.getHttpServer()).get(`/api/v1/conversations/${id}`);
      await request(app.getHttpServer()).get('/api/v1/no-existe/123').expect(404);

      const { text } = await request(app.getHttpServer())
        .get('/api/v1/metrics')
        .set('Authorization', `Bearer ${METRICS_TOKEN}`)
        .expect(200);
      const series = text
        .split('\n')
        .filter((line) => line.startsWith('omnidesk_http_request_duration_seconds_count{'));
      const conversation = series.filter((line) =>
        line.includes('route="/api/v1/conversations/:id"'),
      );
      expect(conversation).toHaveLength(1);
      expect(conversation[0]).toMatch(/ 2$/);
      expect(series.some((line) => line.includes('route="unmatched"'))).toBe(true);
      // Ninguna serie lleva un uuid, un email ni un teléfono.
      expect(text).not.toMatch(/[0-9a-f]{8}-|@|\+[0-9]{8,}/);
    });
  });

  describe('sin METRICS_TOKEN', () => {
    let app: NestExpressApplication;
    beforeAll(async () => {
      app = await createApp({ METRICS_TOKEN: '' });
    });
    afterAll(() => app.close());

    it('el endpoint no existe (404), ni siquiera con un token', async () => {
      await request(app.getHttpServer()).get('/api/v1/metrics').expect(404);
      await request(app.getHttpServer())
        .get('/api/v1/metrics')
        .set('Authorization', `Bearer ${METRICS_TOKEN}`)
        .expect(404);
    });
  });
});
