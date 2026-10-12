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
          redact: [
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
