import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ENV, type Env } from '../../config/env';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF (defensa en profundidad junto a `SameSite=Lax`): en las rutas de la web autenticadas por
 * cookie, los métodos que modifican datos exigen un `Origin` de `CORS_ORIGINS`. Las integraciones
 * (Bearer) no lo usan.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;
    const origin = request.header('origin');
    if (!origin || !this.env.CORS_ORIGINS.includes(origin)) {
      throw new ForbiddenException('Origen no permitido');
    }
    return true;
  }
}
