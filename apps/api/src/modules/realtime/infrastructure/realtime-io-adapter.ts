import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Env } from '../../../shared/config/env';

/** Aplica a Socket.IO el mismo CORS que al resto del API (`CORS_ORIGINS`). */
export class RealtimeIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly env: Env,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: object) {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.env.CORS_ORIGINS, credentials: true },
    });
  }
}
