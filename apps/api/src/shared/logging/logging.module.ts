import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ENV, type Env } from '../config/env';
import { resolveRequestId } from './request-id';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          genReqId: resolveRequestId,
          // Nunca se registran credenciales: API keys de canal, firma HMAC y cookies de sesión.
          serializers: {
            req: (req: Record<string, unknown>) => ({
              ...req,
              ...(typeof req.url === 'string' &&
                req.url.includes('/integrations/whatsapp/') && { url: req.url.split('?')[0] }),
            }),
          },
          redact: [
            'req.query',
            'req.body',
            'req.headers["x-hub-signature-256"]',
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-omnidesk-signature"]',
            'res.headers["set-cookie"]',
          ],
        },
      }),
    }),
  ],
})
export class LoggingModule {}
