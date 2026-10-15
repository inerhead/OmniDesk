import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { httpMetricsMiddleware } from './modules/observability/infrastructure/http/http-metrics.middleware';
import { PromMetrics } from './modules/observability/infrastructure/prom-metrics';
import { RealtimeIoAdapter } from './modules/realtime/infrastructure/realtime-io-adapter';
import { APP_VERSION } from './shared/config/app-version';
import type { Env } from './shared/config/env';
import { REQUEST_ID_HEADER } from './shared/logging/request-id';

/** Configuración HTTP común a `main.ts` y a las pruebas e2e. */
export function configureApp(app: NestExpressApplication, env: Env): void {
  app.useLogger(app.get(Logger));
  // Número de proxies delante (Caddy; Nginx + Caddy en el VPS): IP real y `https` de X-Forwarded-*.
  app.set('trust proxy', env.TRUST_PROXY);
  // Antes que las rutas: mide también las peticiones que no llegan a ningún handler (SPEC 11).
  app.use(httpMetricsMiddleware(app.get(PromMetrics)));
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
  });
  app.useWebSocketAdapter(new RealtimeIoAdapter(app, env));
  app.enableShutdownHooks();
  if (env.NODE_ENV !== 'production') setupSwagger(app);
}

/** Swagger en /api/docs y el JSON en /api/docs-json. No se publica con NODE_ENV=production. */
function setupSwagger(app: NestExpressApplication): void {
  const config = new DocumentBuilder()
    .setTitle('OmniDesk API')
    .setVersion(app.get<string>(APP_VERSION))
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      description: 'API key del canal (integraciones)',
    })
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(document), {
    jsonDocumentUrl: 'api/docs-json',
  });
}
