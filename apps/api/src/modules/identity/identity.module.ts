import { Module } from '@nestjs/common';
import { CreateSessionUseCase } from './application/create-session.use-case';
import { DevLoginUseCase } from './application/dev-login.use-case';
import { GetMeUseCase } from './application/get-me.use-case';
import { GoogleLoginUseCase } from './application/google-login.use-case';
import { MEMBERSHIP_REPOSITORY } from './application/ports/membership.repository';
import { SESSION_REPOSITORY } from './application/ports/session.repository';
import { USER_REPOSITORY } from './application/ports/user.repository';
import { ResolveActorUseCase } from './application/resolve-actor.use-case';
import { ResolveSessionUseCase } from './application/resolve-session.use-case';
import { RevokeSessionUseCase } from './application/revoke-session.use-case';
import { SetActiveTenantUseCase } from './application/set-active-tenant.use-case';
import { AuthController } from './infrastructure/http/auth.controller';
import { GoogleAuthController } from './infrastructure/http/google-auth.controller';
import { MeController } from './infrastructure/http/me.controller';
import { SessionGuard, UserSessionGuard } from './infrastructure/http/session.guard';
import { PrismaMembershipRepository } from './infrastructure/prisma-membership.repository';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';

/**
 * Usuarios, sesiones y login (SPEC 07). Exporta los guards de sesión para el resto de módulos de la
 * web y los repositorios de usuario y sesión (alta de empresa, invitaciones, quitar miembros).
 */
@Module({
  controllers: [AuthController, GoogleAuthController, MeController],
  providers: [
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: MEMBERSHIP_REPOSITORY, useClass: PrismaMembershipRepository },
    CreateSessionUseCase,
    ResolveSessionUseCase,
    RevokeSessionUseCase,
    ResolveActorUseCase,
    GetMeUseCase,
    SetActiveTenantUseCase,
    DevLoginUseCase,
    GoogleLoginUseCase,
    UserSessionGuard,
    SessionGuard,
  ],
  exports: [
    SESSION_REPOSITORY,
    USER_REPOSITORY,
    MEMBERSHIP_REPOSITORY,
    ResolveSessionUseCase,
    ResolveActorUseCase,
    CreateSessionUseCase,
    UserSessionGuard,
    SessionGuard,
  ],
})
export class IdentityModule {}
