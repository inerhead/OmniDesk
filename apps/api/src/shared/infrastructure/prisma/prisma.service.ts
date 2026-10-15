import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { ENV, type Env } from '../../config/env';

/**
 * Cliente con el rol dueño (`DATABASE_URL`), que no pasa por Row Level Security. Solo para los
 * caminos de sistema (SPEC 12): resolver la sesión y la credencial, el dispatcher del Outbox, los
 * jobs, la semilla demo, el alta de empresas y la aceptación de invitaciones.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(ENV) env: Env) {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (error) {
      // El API arranca igual: el health check reporta la base de datos como `down`.
      this.logger.warn(`No se pudo conectar a la base de datos al iniciar: ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/** Cliente con el rol de aplicación (`DATABASE_APP_URL`): sin BYPASSRLS ni tablas propias. */
@Injectable()
export class AppPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppPrismaService.name);

  constructor(@Inject(ENV) env: Env) {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_APP_URL }) });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (error) {
      this.logger.warn(`No se pudo conectar con el rol de aplicación: ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
