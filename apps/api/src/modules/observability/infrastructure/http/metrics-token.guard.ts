import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ENV, type Env } from '../../../../shared/config/env';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** `Authorization: Bearer <METRICS_TOKEN>`; si no coincide, `401`. */
@Injectable()
export class MetricsTokenGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(@Inject(ENV) env: Env) {
    // El controlador solo se registra con token: aquí siempre existe.
    this.expected = digest(env.METRICS_TOKEN ?? '');
  }

  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest<Request>().headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    // Se comparan los sha256: misma longitud y tiempo constante.
    if (scheme !== 'Bearer' || !token || !timingSafeEqual(digest(token), this.expected)) {
      throw new UnauthorizedException('Token de métricas ausente o inválido');
    }
    return true;
  }
}
