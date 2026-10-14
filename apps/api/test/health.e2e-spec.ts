import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { HealthResponseSchema } from '@omnidesk/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DATABASE_HEALTH_PORT } from '../src/modules/health/application/ports/database-health.port';
import type { Env } from '../src/shared/config/env';
import { testEnv } from './support/test-env';

// Requiere DATABASE_URL apuntando al Postgres de Docker Compose (se usa la base `_e2e`).
const env = testEnv();

async function createApp(databaseUp?: boolean, appEnv: Env = env): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(appEnv)] });
  if (databaseUp !== undefined) {
    builder = builder
      .overrideProvider(DATABASE_HEALTH_PORT)
      .useValue({ ping: async () => databaseUp });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    rawBody: true,
  });
  configureApp(app, appEnv);
  await app.init();
  return app;
}

describe('GET /api/v1/health (base de datos real)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 con un cuerpo que cumple el contrato', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    const body = HealthResponseSchema.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.checks.database).toBe('up');
  });

  it('devuelve el x-request-id recibido', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'abc-123');

    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('genera un x-request-id cuando no se envía', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('permite CORS a un origen de la lista blanca', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('no permite CORS a un origen desconocido', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('documenta el endpoint en Swagger con el esquema del contrato', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs-json').expect(200);

    const operation = res.body.paths['/api/v1/health'].get;
    expect(operation.responses['200']).toBeDefined();
    expect(operation.responses['503']).toBeDefined();
    expect(JSON.stringify(res.body)).toContain('"timestamp"');
  });
});

describe('GET /api/v1/health (base de datos abajo)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createApp(false);
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 503 con la base de datos down', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(503);

    const body = HealthResponseSchema.parse(res.body);
    expect(body.status).toBe('error');
    expect(body.checks.database).toBe('down');
  });
});

describe('Producción (NODE_ENV=production)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createApp(
      true,
      testEnv({
        NODE_ENV: 'production',
        DEMO_MODE: 'false',
        GOOGLE_CLIENT_ID: 'e2e-client-id',
        GOOGLE_CLIENT_SECRET: 'e2e-client-secret',
        SESSION_COOKIE_SECURE: 'true',
        APP_VERSION: 'v0.1.0',
        ATTACHMENT_STORAGE_DRIVER: 's3',
        S3_ENDPOINT: 'http://localhost:9050',
        S3_ACCESS_KEY_ID: 'omnidesk',
        S3_SECRET_ACCESS_KEY: 'omnidesk-dev-secret',
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('no publica Swagger', async () => {
    await request(app.getHttpServer()).get('/api/docs').expect(404);
    await request(app.getHttpServer()).get('/api/docs-json').expect(404);
  });

  it('el health muestra APP_VERSION', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(HealthResponseSchema.parse(res.body).version).toBe('v0.1.0');
  });
});
