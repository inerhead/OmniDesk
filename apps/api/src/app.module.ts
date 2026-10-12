import { DynamicModule, Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { ConfigModule } from './shared/config/config.module';
import type { Env } from './shared/config/env';
import { PrismaModule } from './shared/infrastructure/prisma/prisma.module';
import { LoggingModule } from './shared/logging/logging.module';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(env), LoggingModule, PrismaModule, HealthModule],
    };
  }
}
