import { DynamicModule, Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { DemoModule } from './modules/demo/demo.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { MembersModule } from './modules/members/members.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { TeamModule } from './modules/team/team.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { ConfigModule } from './shared/config/config.module';
import type { Env } from './shared/config/env';
import { PrismaModule } from './shared/infrastructure/prisma/prisma.module';
import { LoggingModule } from './shared/logging/logging.module';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        LoggingModule,
        PrismaModule,
        HealthModule,
        IdentityModule,
        DemoModule,
        TenancyModule,
        MembersModule,
        TeamModule,
        ConversationsModule,
        AttachmentsModule,
        IntegrationsModule,
        MessagingModule,
        RealtimeModule,
      ],
      // Valida con zod todo cuerpo y query tipados con DTOs de nestjs-zod (400 si no cumplen).
      providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
    };
  }
}
