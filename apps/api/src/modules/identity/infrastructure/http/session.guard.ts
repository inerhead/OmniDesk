import {
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
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

const ALLOW_INACTIVE_TENANT = 'omnidesk:allow-inactive-tenant';

/**
 * Rutas que un OWNER usa con su empresa inactiva: ver la empresa y reactivarla (SPEC 16). Al resto,
 * `SessionGuard` responde `403 TENANT_INACTIVE`.
 */
export const AllowInactiveTenant = () => SetMetadata(ALLOW_INACTIVE_TENANT, true);

/**
 * Sesión con empresa activa: deja además `request.actor` y `request.tenant`.
 * `401 UNAUTHENTICATED` sin sesión; `403 NO_ACTIVE_TENANT` sin empresa activa (o si ya no es miembro);
 * `403 TENANT_PENDING` / `TENANT_SUSPENDED` si está en revisión o suspendida (SPEC 18), en todas las
 * rutas; `403 TENANT_INACTIVE` si está inactiva, salvo un OWNER en una ruta `@AllowInactiveTenant()`.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly userSession: UserSessionGuard,
    private readonly resolveActor: ResolveActorUseCase,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.userSession.canActivate(context);
    const request = context.switchToHttp().getRequest<ContextualRequest>();
    const session = request.session!;
    const resolution = await this.resolveActor.execute(session);
    if (resolution.kind === 'no-active-tenant') {
      throw apiError(HttpStatus.FORBIDDEN, 'NO_ACTIVE_TENANT', 'Elige o crea una empresa');
    }
    if (resolution.kind === 'pending') {
      throw apiError(HttpStatus.FORBIDDEN, 'TENANT_PENDING', 'La empresa está en revisión');
    }
    if (resolution.kind === 'suspended') {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'TENANT_SUSPENDED',
        'La empresa está suspendida por la plataforma',
      );
    }
    if (resolution.kind === 'inactive') {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_INACTIVE_TENANT, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed || resolution.actor.role !== 'OWNER') {
        throw apiError(HttpStatus.FORBIDDEN, 'TENANT_INACTIVE', 'La empresa está inactiva');
      }
    }
    request.actor = resolution.actor;
    request.tenant = { tenantId: resolution.actor.tenantId };
    return true;
  }
}
