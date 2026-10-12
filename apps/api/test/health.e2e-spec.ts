import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { HealthResponseSchema } from '@omnidesk/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DATABASE_HEALTH_PORT } from '../src/modules/health/application/ports/database-health.port';
import { parseEnv } from '../src/shared/config/env';

// Requiere DATABASE_URL apuntando al Postgres de Docker Compose.
const env = parseEnv({
  ...process.env,
  LOG_LEVEL: 'warn',
  CORS_ORIGINS: 'http://localhost:8080,http://localhost:5173',
});

async function createApp(databaseUp?: boolean): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(env)] });
  if (databaseUp !== undefined) {
    builder = builder
      .overrideProvider(DATABASE_HEALTH_PORT)
      .useValue({ ping: async () => databaseUp });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app, env);
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
