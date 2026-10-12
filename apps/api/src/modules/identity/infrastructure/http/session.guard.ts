import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Response } from 'express';
import { ENV, type Env } from '../../../../shared/config/env';
import { apiError } from '../../../../shared/infrastructure/http/api-error';
import type { ContextualRequest } from '../../../../shared/infrastructure/http/request-context.decorators';
import { ResolveActorUseCase } from '../../application/resolve-actor.use-case';
import { ResolveSessionUseCase } from '../../application/resolve-session.use-case';
import { readRequestSessionToken, setSessionCookie } from './session-cookie';

/** Valida la cookie de sesión y deja `request.session`. `401 UNAUTHENTICATED` si no vale. */
@Injectable()
export class UserSessionGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly resolveSession: ResolveSessionUseCase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<ContextualRequest>();
    const token = readRequestSessionToken(request);
    const resolved = await this.resolveSession.execute(token);
    if (!resolved || !token) {
      throw apiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Inicia sesión para continuar');
    }
    // Expiración deslizante: la cookie acompaña a la sesión.
    if (resolved.renewed) setSessionCookie(http.getResponse<Response>(), this.env, token);

    request.session = {
      sessionId: resolved.session.id,
      userId: resolved.session.userId,
      activeTenantId: resolved.session.activeTenantId,
    };
    return true;
  }
}

/**
 * Sesión con empresa activa: deja además `request.actor` y `request.tenant`.
 * `401 UNAUTHENTICATED` sin sesión; `403 NO_ACTIVE_TENANT` sin empresa activa (o si ya no es miembro).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly userSession: UserSessionGuard,
    private readonly resolveActor: ResolveActorUseCase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.userSession.canActivate(context);
    const request = context.switchToHttp().getRequest<ContextualRequest>();
    const session = request.session!;
    const resolution = await this.resolveActor.execute(session);
    if (resolution.kind !== 'ok') {
      throw apiError(HttpStatus.FORBIDDEN, 'NO_ACTIVE_TENANT', 'Elige o crea una empresa');
    }
    request.actor = resolution.actor;
    request.tenant = { tenantId: resolution.actor.tenantId };
    return true;
  }
}
